import type { DatabaseSync } from "node:sqlite";
import type { AgentDefinition, AgentTrigger, AgentRun, AgentRunStatus } from "@jarvis/agent-framework";
import { AgentRuntime, SqliteKnowledgeStore, LessonCapture } from "@jarvis/agent-framework";
import { SqliteEntityGraph } from "@jarvis/agent-framework";
import { SqliteDecisionLog } from "@jarvis/agent-framework";
import { buildPlanWithInference } from "./planner-real.js";
import { buildPlanWithCritic } from "./planner-critic.js";
import { buildPlanMultiViewpoint } from "./planner-multi.js";
import { requestApproval, waitForApproval } from "./approval-bridge.js";
import { buildEnvelope, type WorkerRegistry } from "./worker-registry.js";
import { writeTelegramQueue } from "./notify.js";
import { RunStore } from "./run-store.js";
import { isReadOnlyAction } from "./action-classifier.js";
import { classifyDisagreement, shouldBlockExecution, shouldFlagForReview, DEFAULT_DISAGREEMENT_POLICY } from "./disagreement-policy.js";
import { isActionPermitted, type PluginPermission } from "./plugin-loader.js";
import type { ChannelStore } from "./channel-store.js";
import type { RagPipeline } from "./rag-pipeline.js";
import type { Logger } from "./logger.js";
import type { StatusWriter } from "./status-writer.js";

/** Outbound actions that are skipped in preview mode. Excludes document.generate_report
 *  since that's typically the main deliverable and should still execute in preview. */
const OUTBOUND_ACTIONS = new Set(['email.send', 'social.post', 'crm.move_stage']);

// ─── Failure classification (#70) ──────────────────────────────────────────
// Classify step failures so the daemon can decide retry strategy and operators
// can filter by failure class in the dashboard.
// ────────────────────────────────────────────────────────────────────────────

type FailureClass = "transient" | "permanent" | "timeout" | "permission" | "unknown";

function classifyFailure(error: unknown, jobResult?: { error?: { code?: string; retryable?: boolean } }): FailureClass {
  if (jobResult?.error?.code === "EXECUTION_TIMEOUT") return "timeout";
  if (jobResult?.error?.code === "FILESYSTEM_POLICY_VIOLATION") return "permission";
  if (jobResult?.error?.retryable) return "transient";
  if (jobResult?.error?.code === "INVALID_INPUT") return "permanent";
  if (error instanceof Error && error.message.includes("ECONNREFUSED")) return "transient";
  return "unknown";
}

export type OrchestratorDeps = {
  runtime: AgentRuntime;
  registry: WorkerRegistry;
  knowledgeStore: SqliteKnowledgeStore;
  entityGraph: SqliteEntityGraph;
  decisionLog: SqliteDecisionLog;
  lessonCapture: LessonCapture;
  logger: Logger;
  statusWriter?: StatusWriter;
  ragPipeline?: RagPipeline;
  runtimeDb?: DatabaseSync;
  channelStore?: ChannelStore;
};

/**
 * Stamp terminal status on the local run object.
 * AgentRuntime no longer caches run state — the orchestrator owns the object
 * and RunStore provides durable persistence.
 */
function finalizeRun(run: AgentRun, error?: string): void {
  const now = new Date().toISOString();
  run.status = (error ? "failed" : "completed") as AgentRunStatus;
  run.error = error;
  run.updated_at = now;
  run.completed_at = now;
}

/**
 * Run a single agent: plan → execute steps → evaluate → learn.
 * Blocks until the agent completes (or hits an unresolved approval timeout).
 */
export async function runAgent(
  agentId: string,
  trigger: AgentTrigger,
  deps: OrchestratorDeps,
): Promise<AgentRun> {
  const { runtime, registry, knowledgeStore, entityGraph, decisionLog, lessonCapture, logger, statusWriter, ragPipeline, runtimeDb } = deps;

  const def = runtime.getDefinition(agentId);
  if (!def) throw new Error(`Agent not registered: ${agentId}`);

  // Initialize durable run tracking if runtime DB is available
  const runStore = runtimeDb ? new RunStore(runtimeDb) : null;

  // command_id, command_payload, and owner are carried directly on the trigger by AgentQueue (atomic linkage)
  const commandId = (trigger as { command_id?: string }).command_id;
  const commandPayload = (trigger as { command_payload?: Record<string, unknown> }).command_payload;
  const owner = (trigger as { owner?: string }).owner;

  // Load plugin permissions if this is a plugin agent
  const pluginPermissions = loadPluginPermissions(agentId, runtimeDb);

  // 1. Start run — use the same run_id for both in-memory and durable state
  const run = runtime.startRun(agentId, trigger);
  runStore?.startRun(agentId, trigger.kind, commandId, run.goal, run.run_id, owner);

  // Log retry relationship in the audit trail so retry runs are linked to originals
  if (commandPayload?.retry_of && runStore) {
    runStore.emitEvent(run.run_id, agentId, "run_started", {
      details: { retry_of: commandPayload.retry_of as string },
    });
  }

  // Create a context-aware logger for this run
  const log = logger.withContext({ run_id: run.run_id, agent_id: agentId });
  log.info(`Starting agent (trigger: ${trigger.kind})`);

  // Notify status writer that an agent run started (steps TBD until plan completes)
  statusWriter?.setCurrentRun(agentId, 0);

  try {
    // 2. Gather context (including RAG-augmented chunks if pipeline is available)
    const context = await gatherContext(def, knowledgeStore, entityGraph, ragPipeline, logger);

    // 3. Build plan via inference (dispatch based on planner_mode)
    const plannerParams = {
      agent_id: agentId,
      run_id: run.run_id,
      goal: run.goal,
      system_prompt: def.system_prompt,
      context,
      capabilities: def.capabilities,
      max_steps: def.max_steps_per_run,
      deps: { chat: registry.chat.bind(registry), logger },
    };

    const plannerMode = def.planner_mode ?? "single";
    let plan;

    if (plannerMode === "critic") {
      const result = await buildPlanWithCritic(plannerParams);
      plan = result.plan;
      log.info(`Critic assessment: ${result.critique.overall_assessment}`, {
        issues: result.critique.issues.length,
        risks: result.critique.risks.length,
      });
      runStore?.emitEvent(run.run_id, agentId, "plan_critique", {
        details: {
          assessment: result.critique.overall_assessment,
          issues: result.critique.issues,
          risks: result.critique.risks,
        },
      });
    } else if (plannerMode === "multi") {
      const result = await buildPlanMultiViewpoint({
        ...plannerParams,
        run_critic: true,
      });
      plan = result.plan;
      log.info(`Multi-viewpoint: ${result.candidates.length} plans, selected #${result.selected_index} (score ${result.scores[0]?.total ?? "N/A"})`);
      runStore?.emitEvent(run.run_id, agentId, "plan_multi_viewpoint", {
        details: {
          candidate_count: result.candidates.length,
          selected_index: result.selected_index,
          scores: result.scores.map(s => ({ index: s.plan_index, total: s.total })),
          disagreement: result.disagreement,
        },
      });

      // Disagreement-aware escalation with severity classification
      const disagreementSeverity = classifyDisagreement(result.disagreement, DEFAULT_DISAGREEMENT_POLICY);

      // Emit disagreement classification event for operator visibility
      if (result.disagreement.disagreement) {
        runStore?.emitEvent(run.run_id, agentId, "disagreement_classified", {
          details: {
            severity: disagreementSeverity,
            reason: result.disagreement.reason,
            unique_actions: result.disagreement.details.unique_actions,
            step_count_range: result.disagreement.details.step_count_range,
            planner_mode: plannerMode,
            candidate_count: result.candidates.length,
            selected_score: result.scores[0]?.total,
            blocked: shouldBlockExecution(disagreementSeverity),
            flagged_for_review: shouldFlagForReview(disagreementSeverity),
          },
        });
      }

      if (shouldBlockExecution(disagreementSeverity) && runtimeDb) {
        log.warn(`Planner disagreement (${disagreementSeverity}): ${result.disagreement.reason}`);
        const approvalPayload = [
          `Multi-viewpoint planners disagreed: ${result.disagreement.reason}`,
          `Unique actions: ${result.disagreement.details.unique_actions.join(", ")}`,
          `Step count range: ${result.disagreement.details.step_count_range.join("-")}`,
          `\nSelected plan (score ${result.scores[0]?.total ?? "N/A"}):`,
          ...result.plan.steps.map(s => `  ${s.step}. [${s.action}] ${s.reasoning}`),
          `\nAlternative plans:`,
          ...result.candidates
            .filter((_, i) => i !== result.selected_index)
            .map((c, i) => `  Plan ${i + 1}: ${c.steps.map(s => s.action).join(" → ")}`),
        ].join("\n");

        runStore?.transition(run.run_id, agentId, "awaiting_approval", "approval_requested", {
          details: { reason: result.disagreement.reason },
        });

        const approvalId = requestApproval(runtimeDb, {
          agent_id: agentId,
          run_id: run.run_id,
          action: "plan_disagreement",
          severity: "warning",
          payload: approvalPayload,
        });

        run.status = "awaiting_approval";
        run.updated_at = new Date().toISOString();
        statusWriter?.setAwaitingApproval(0, "plan_disagreement");

        const decision = await waitForApproval(runtimeDb, approvalId, 4 * 60 * 60 * 1000);

        runStore?.emitEvent(run.run_id, agentId, "disagreement_resolved", {
          details: { decision },
        });

        if (decision === "rejected") {
          log.info("Disagreement escalation rejected — aborting run");
          runStore?.transition(run.run_id, agentId, "cancelled", "run_cancelled", {
            details: { reason: "disagreement_rejected" },
          });
          runStore?.completeCommand(run.run_id, "failed");
          statusWriter?.completeRun("disagreement_rejected");
          finalizeRun(run, "Plan rejected due to planner disagreement");
          return run;
        }

        if (decision === "timeout") {
          log.warn("Disagreement escalation timeout — aborting run");
          runStore?.transition(run.run_id, agentId, "failed", "run_failed", {
            details: { reason: "disagreement_timeout" },
          });
          runStore?.completeCommand(run.run_id, "failed");
          writeTelegramQueue(agentId, `\u23F0 Approval expired for plan_disagreement. Run ${run.run_id} failed due to timeout.`, runtimeDb);
          statusWriter?.completeRun("disagreement_timeout");
          finalizeRun(run, "Disagreement approval timeout");
          return run;
        }

        run.status = "executing";
        run.updated_at = new Date().toISOString();
        log.info("Disagreement escalation approved — proceeding with selected plan");
      } else if (shouldFlagForReview(disagreementSeverity)) {
        // Moderate disagreement: proceed but flag for post-hoc review
        log.info(`Planner disagreement (${disagreementSeverity}): flagged for review, proceeding`);
        writeTelegramQueue(agentId, `[REVIEW] Planner disagreement (${disagreementSeverity}): ${result.disagreement.reason}. Run proceeding — review output.`, runtimeDb);
      }
    } else {
      // Default: single planner
      plan = await buildPlanWithInference(plannerParams);
    }

    run.plan = plan;
    run.total_steps = plan.steps.length;
    run.status = "executing";
    run.updated_at = new Date().toISOString();

    // Update durable run metadata
    runStore?.updateRunMeta(run.run_id, { goal: run.goal, total_steps: plan.steps.length });

    // Emit plan_built event
    runStore?.emitEvent(run.run_id, agentId, "plan_built", {
      details: { steps: plan.steps.length, goal: run.goal, planner_mode: plannerMode },
    });

    // Log model selection for observability
    runStore?.emitEvent(run.run_id, agentId, "model_selected", {
      details: { source: "planner", planner_mode: plannerMode },
    });

    if (plan.steps.length === 0) {
      log.warn("Produced empty plan");
      runStore?.transition(run.run_id, agentId, "completed", "run_completed", {
        details: { reason: "empty_plan" },
      });
      runStore?.completeCommand(run.run_id, "completed");
      statusWriter?.completeRun("empty_plan");
      finalizeRun(run, "Empty plan — no steps generated");
      return run;
    }

    // Update status writer with actual step count after planning
    statusWriter?.updateTotalSteps(plan.steps.length);

    log.info(`Plan: ${plan.steps.length} steps`);

    // 4. Execute steps sequentially
    for (const step of plan.steps) {
      // ── Check for external cancellation before each step ──
      // An operator may cancel the run via the dashboard while it's executing.
      // We check the durable status from the DB to detect this.
      if (runStore) {
        const durableStatus = runStore.getStatus(run.run_id);
        if (durableStatus === "cancelled") {
          log.info("Run cancelled externally — stopping execution");
          runStore.completeCommand(run.run_id, "cancelled");
          statusWriter?.completeRun("cancelled");
          finalizeRun(run, "Cancelled by operator");
          return run;
        }
      }

      const stepLog = log.withContext({ step_no: step.step, action: step.action });
      stepLog.info(`Step ${step.step}/${plan.steps.length}: ${step.action}`, { reasoning: step.reasoning.slice(0, 100) });

      // Emit step_started event
      runStore?.emitEvent(run.run_id, agentId, "step_started", {
        step_no: step.step, action: step.action,
      });

      // Update status writer with current step progress
      statusWriter?.updateStep(step.step, step.action);

      // ── Plugin permission check ──
      // Enforce permissions at runtime for plugin agents
      if (pluginPermissions && !isActionPermitted(step.action, pluginPermissions)) {
        const actionPrefix = step.action.split('.')[0];
        const reason = `Action '${step.action}' requires 'execute_${actionPrefix}' permission. Granted permissions: ${pluginPermissions?.join(', ') || 'none'}.`;
        stepLog.warn(`Action blocked by plugin permissions: ${step.action}`);
        runStore?.emitEvent(run.run_id, agentId, "step_failed", {
          step_no: step.step, action: step.action,
          details: { error: "permission_denied", reason },
        });
        decisionLog.logDecision({
          agent_id: agentId, run_id: run.run_id, step: step.step,
          action: step.action, reasoning: step.reasoning, outcome: "permission_denied",
        });
        continue; // Skip this step
      }

      // ── Preview mode: skip outbound actions BEFORE approval gate ──
      // This prevents preview runs from blocking on approval waits for actions
      // that would be skipped anyway.
      if (commandPayload?.preview === true && OUTBOUND_ACTIONS.has(step.action)) {
        stepLog.info(`Preview mode: would have executed ${step.action} — skipping`);
        runStore?.emitEvent(run.run_id, agentId, "step_completed", {
          step_no: step.step, action: step.action,
          details: { preview: true, skipped: true },
        });
        decisionLog.logDecision({
          agent_id: agentId, run_id: run.run_id, step: step.step,
          action: step.action, reasoning: step.reasoning, outcome: "preview_skipped",
        });
        run.current_step = step.step;
        run.updated_at = new Date().toISOString();
        continue;
      }

      // ── Maturity-based approval gates ──
      const gate = resolveApprovalGate(def, step.action);

      if (gate && runtimeDb) {
        stepLog.info(`Approval required (${gate.severity}, ${gate.source})`);

        // Emit approval_requested event
        runStore?.transition(run.run_id, agentId, "awaiting_approval", "approval_requested", {
          step_no: step.step, action: step.action,
          details: { severity: gate.severity, source: gate.source },
        });

        const approvalId = requestApproval(runtimeDb, {
          agent_id: agentId,
          run_id: run.run_id,
          action: step.action,
          severity: gate.severity,
          payload: `Step ${step.step}: ${step.action}\n\nReasoning: ${step.reasoning}\n\nInput: ${JSON.stringify(step.input).slice(0, 500)}`,
        });

        run.status = "awaiting_approval";
        run.updated_at = new Date().toISOString();
        statusWriter?.setAwaitingApproval(step.step, step.action);

        const decision = await waitForApproval(runtimeDb, approvalId, 4 * 60 * 60 * 1000); // 4h timeout

        // Emit approval_resolved event
        runStore?.emitEvent(run.run_id, agentId, "approval_resolved", {
          step_no: step.step, action: step.action,
          details: { decision },
        });

        if (decision === "rejected") {
          stepLog.info("Rejected — skipping");
          decisionLog.logDecision({
            agent_id: agentId, run_id: run.run_id, step: step.step,
            action: step.action, reasoning: step.reasoning, outcome: "rejected",
          });
          continue;
        }

        if (decision === "timeout") {
          stepLog.warn("Approval timeout — aborting run");
          runStore?.transition(run.run_id, agentId, "failed", "run_failed", {
            step_no: step.step, action: step.action,
            details: { reason: "approval_timeout" },
          });
          runStore?.completeCommand(run.run_id, "failed");
          decisionLog.logDecision({
            agent_id: agentId, run_id: run.run_id, step: step.step,
            action: step.action, reasoning: step.reasoning, outcome: "approval_timeout",
          });
          writeTelegramQueue(agentId, `\u23F0 Approval expired for ${step.action} (step ${step.step}). Run ${run.run_id} failed due to timeout.`, runtimeDb);
          statusWriter?.completeRun("approval_timeout");
          finalizeRun(run, "Approval timeout");
          return run;
        }

        run.status = "executing";
        run.updated_at = new Date().toISOString();
        runStore?.transition(run.run_id, agentId, "executing", "step_started", {
          step_no: step.step, action: step.action,
        });
        stepLog.info("Approved — executing");
      }

      // Execute the job
      const envelope = buildEnvelope(step.action, {
        ...step.input,
        _agent_id: agentId,
        _run_id: run.run_id,
      });

      try {
        const result = await registry.executeJob(envelope);

        // Attach provenance to any artifacts produced by this step
        if (result.artifacts) {
          for (const artifact of result.artifacts) {
            if (!artifact.provenance) {
              artifact.provenance = {
                source_agent_id: agentId,
                source_run_id: run.run_id,
                step_no: step.step,
                action: step.action,
              };
            }
          }
        }

        const outcome = result.status === "completed" ? "completed" : `failed: ${result.error?.message ?? result.summary}`;
        decisionLog.logDecision({
          agent_id: agentId, run_id: run.run_id, step: step.step,
          action: step.action, reasoning: step.reasoning, outcome,
        });

        if (result.status === "failed") {
          const failureClass = classifyFailure(null, result);
          runStore?.emitEvent(run.run_id, agentId, "step_failed", {
            step_no: step.step, action: step.action,
            details: { error: result.error?.message, error_code: result.error?.code, retryable: result.error?.retryable, failure_class: failureClass },
          });

          // Retry once if retryable
          if (result.error?.retryable) {
            stepLog.info("Failed (retryable) — retrying");
            const retry = await registry.executeJob({ ...envelope, attempt: 2 });
            if (retry.status === "failed") {
              stepLog.warn("Retry also failed");
              const retryFailureClass = classifyFailure(null, retry);
              runStore?.emitEvent(run.run_id, agentId, "step_failed", {
                step_no: step.step, action: step.action,
                details: {
                  error: retry.error?.message,
                  error_code: retry.error?.code,
                  attempt: 2,
                  retryable: false,
                  failure_class: retryFailureClass,
                },
              });
            } else {
              runStore?.emitEvent(run.run_id, agentId, "step_completed", {
                step_no: step.step, action: step.action,
                details: { retry: true },
              });
            }
          } else {
            stepLog.warn(`Failed: ${result.error?.message}`);
          }
        } else {
          runStore?.emitEvent(run.run_id, agentId, "step_completed", {
            step_no: step.step, action: step.action,
            details: result.artifacts?.length ? { artifacts: result.artifacts } : undefined,
          });
        }

        run.current_step = step.step;
        run.updated_at = new Date().toISOString();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const caughtFailureClass = classifyFailure(e);
        stepLog.error(`Threw: ${errMsg}`);
        runStore?.emitEvent(run.run_id, agentId, "step_failed", {
          step_no: step.step, action: step.action,
          details: { error: errMsg, failure_class: caughtFailureClass },
        });
        decisionLog.logDecision({
          agent_id: agentId, run_id: run.run_id, step: step.step,
          action: step.action, reasoning: step.reasoning, outcome: `error: ${errMsg}`,
        });
      }

      // ── Post-step cancellation check ──
      // Detect cancellation that occurred during step execution
      if (runStore) {
        const postStepStatus = runStore.getStatus(run.run_id);
        if (postStepStatus === "cancelled") {
          log.info("Run cancelled during step execution — stopping after step completion");
          runStore.emitEvent(run.run_id, agentId, "run_cancelled", {
            step_no: step.step, action: step.action,
            details: { reason: "operator_cancel", cancelled_after_step: step.step },
          });
          runStore.completeCommand(run.run_id, "cancelled");
          statusWriter?.completeRun("cancelled");
          finalizeRun(run, "Cancelled by operator after step " + step.step);
          return run;
        }
      }
    }

    // 5. Complete run — check durable status first to handle external cancellation
    const finalStatus = runStore?.getStatus(run.run_id);
    if (finalStatus === "cancelled") {
      log.info("Run was cancelled externally during final step — respecting cancellation");
      runStore?.completeCommand(run.run_id, "cancelled");
      statusWriter?.completeRun("cancelled");
      finalizeRun(run, "Cancelled by operator");
      return run;
    }
    runStore?.transition(run.run_id, agentId, "completed", "run_completed", {
      details: { steps_completed: run.current_step, total_steps: plan.steps.length },
    });
    runStore?.completeCommand(run.run_id, "completed");
    statusWriter?.completeRun("completed");
    finalizeRun(run);
    runtime.clearRunMemory(run.run_id);
    log.info(`Completed (${run.current_step} steps)`);

    // 6. Capture lessons
    const decisions = decisionLog.getDecisions(agentId, run.run_id);
    lessonCapture.captureFromRun(run, decisions);

    // 7. Notify via Telegram queue
    const summary = `${def.label}: completed ${run.current_step}/${plan.steps.length} steps. Goal: ${run.goal}`;
    writeTelegramQueue(agentId, summary, runtimeDb);

    // 7b. Record artifact delivery linking run to originating channel thread
    if (deps.channelStore && commandId) {
      try {
        const threadId = deps.channelStore.getThreadByCommandId(commandId);
        if (threadId) {
          const thread = deps.channelStore.getThread(threadId);
          deps.channelStore.recordDelivery({
            runId: run.run_id,
            threadId,
            channel: thread?.channel ?? "dashboard",
            artifactType: "notification",
            contentPreview: summary,
          });
        }
      } catch { /* best-effort */ }
    }

    // 8. Post-hoc review notification for trusted_with_review agents
    if (def.maturity === "trusted_with_review") {
      writeTelegramQueue(agentId, `[REVIEW] ${def.label} completed autonomously. Run: ${run.run_id}. Review output and decisions.`, runtimeDb);
    }

    return run;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log.error(`Run failed: ${errMsg}`);
    runStore?.transition(run.run_id, agentId, "failed", "run_failed", {
      details: { error: errMsg },
    });
    runStore?.completeCommand(run.run_id, "failed");
    statusWriter?.completeRun(`error: ${errMsg}`);
    finalizeRun(run, errMsg);
    return run;
  }
}

// ─── Maturity-based approval gate resolution ─────────────────────────────────

type ResolvedGate = {
  severity: "info" | "warning" | "critical";
  source: "explicit" | "maturity_experimental" | "maturity_high_stakes";
};

/**
 * Resolve the approval gate for a step action based on:
 * 1. Explicit approval_gates defined on the agent
 * 2. Maturity-level enforcement:
 *    - experimental: every action requires approval (including read-only)
 *    - high_stakes_manual_gate: every mutating action requires approval
 *    - trusted_with_review / operational: explicit gates only (post-hoc for trusted)
 */
function resolveApprovalGate(def: AgentDefinition, action: string): ResolvedGate | null {
  // 1. Explicit gate always takes precedence
  const explicit = def.approval_gates.find(g => g.action === action);
  if (explicit) {
    return { severity: explicit.severity, source: "explicit" };
  }

  // 2. Maturity-level enforcement
  const maturity = def.maturity;

  if (maturity === "experimental") {
    // Experimental agents: every action requires approval (human-in-the-loop for all)
    return { severity: "warning", source: "maturity_experimental" };
  }

  if (maturity === "high_stakes_manual_gate") {
    // High-stakes: every mutating action requires approval; read-only is exempt
    if (!isReadOnlyAction(action)) {
      return { severity: "warning", source: "maturity_high_stakes" };
    }
  }

  // operational / trusted_with_review: explicit gates only
  return null;
}

// ─── Plugin permission loading ───────────────────────────────────────────────

/**
 * Load plugin permissions for an agent from the plugin_installs table.
 * Returns null for built-in agents (no permission restrictions).
 * Returns empty array on error — fail closed (deny all actions).
 */
function loadPluginPermissions(agentId: string, runtimeDb?: DatabaseSync): PluginPermission[] | null {
  if (!runtimeDb) return null;

  // Plugin agents typically have IDs starting with "plugin-"
  const pluginId = agentId.startsWith("plugin-") ? agentId.slice(7) : agentId;

  try {
    const row = runtimeDb.prepare(
      "SELECT manifest_json FROM plugin_installs WHERE plugin_id = ? AND status = 'active'",
    ).get(pluginId) as { manifest_json: string } | undefined;

    // No plugin install record found. Only core agents (not prefixed with
    // "plugin-") are allowed unrestricted access. Plugin-prefixed agents
    // without a DB row fail closed — the row may have been deleted or never
    // recorded, and granting unrestricted access would bypass sandboxing.
    if (!row?.manifest_json) {
      return agentId.startsWith("plugin-") ? [] : null;
    }

    const manifest = JSON.parse(row.manifest_json) as { permissions?: string[] };
    // Plugin found but no permissions declared → deny all (fail closed)
    return (manifest.permissions as PluginPermission[]) ?? [];
  } catch {
    // Parse error on a known plugin → fail closed, deny all actions.
    // Returning null would mean "unrestricted" which is unsafe for plugins.
    return [];
  }
}

/** Gather context from knowledge store + entity graph + RAG pipeline for the planner */
async function gatherContext(
  def: AgentDefinition,
  knowledge: SqliteKnowledgeStore,
  entityGraph: SqliteEntityGraph,
  ragPipeline?: RagPipeline,
  logger?: Logger,
): Promise<string> {
  const lines: string[] = [];

  // Search knowledge collections
  for (const col of def.knowledge_collections) {
    try {
      const docs = knowledge.listCollection(col as Parameters<SqliteKnowledgeStore["listCollection"]>[0]);
      if (docs.length > 0) {
        lines.push(`\n## Knowledge: ${col} (${docs.length} docs)`);
        for (const doc of docs.slice(0, 5)) {
          lines.push(`- ${doc.title}: ${doc.content.slice(0, 200)}`);
        }
      }
    } catch { /* collection may not exist */ }
  }

  // Entity graph summary
  try {
    const entities = entityGraph.entitiesSeenBy(def.agent_id);
    if (entities.length > 0) {
      lines.push(`\n## Known Entities (${entities.length})`);
      for (const e of entities.slice(0, 10)) {
        lines.push(`- [${e.entity_type}] ${e.name}${e.canonical_key ? ` (${e.canonical_key})` : ""}`);
      }
    }
  } catch { /* entity graph may be empty */ }

  // RAG-augmented context: embed the agent's description and retrieve relevant chunks
  if (ragPipeline) {
    try {
      const ragResults = await ragPipeline.query(def.description, 5);
      if (ragResults.length > 0) {
        lines.push(`\n## Relevant Knowledge (RAG, ${ragResults.length} chunks)`);
        for (const r of ragResults) {
          lines.push(`- [score=${r.score.toFixed(3)}] ${r.text.slice(0, 300)}`);
        }
      }
    } catch (e) {
      logger?.debug(`RAG query failed for ${def.agent_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  lines.push(`\nToday: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);

  return lines.join("\n");
}
