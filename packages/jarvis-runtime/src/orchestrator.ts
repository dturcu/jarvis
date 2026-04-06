import type { DatabaseSync } from "node:sqlite";
import type { AgentDefinition, AgentTrigger, AgentRun } from "@jarvis/agent-framework";
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
import { isActionPermitted, type PluginPermission } from "./plugin-loader.js";
import type { RagPipeline } from "./rag-pipeline.js";
import type { Logger } from "./logger.js";
import type { StatusWriter } from "./status-writer.js";

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
};

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

  // command_id is carried directly on the trigger by AgentQueue (atomic linkage)
  const commandId = (trigger as { command_id?: string }).command_id;

  // Load plugin permissions if this is a plugin agent
  const pluginPermissions = loadPluginPermissions(agentId, runtimeDb);

  // 1. Start run
  const run = runtime.startRun(agentId, trigger);
  const durableRunId = runStore?.startRun(agentId, trigger.kind, commandId, run.goal);

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

      // Disagreement-aware escalation: if planners disagree substantially,
      // request human approval before proceeding with the selected plan
      if (result.disagreement.disagreement && runtimeDb) {
        log.warn(`Planner disagreement: ${result.disagreement.reason}`);
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
          runtime.completeRun(run.run_id, "Plan rejected due to planner disagreement");
          return run;
        }

        if (decision === "timeout") {
          log.warn("Disagreement escalation timeout — aborting run");
          runStore?.transition(run.run_id, agentId, "failed", "run_failed", {
            details: { reason: "disagreement_timeout" },
          });
          runStore?.completeCommand(run.run_id, "failed");
          statusWriter?.completeRun("disagreement_timeout");
          runtime.completeRun(run.run_id, "Disagreement approval timeout");
          return run;
        }

        run.status = "executing";
        run.updated_at = new Date().toISOString();
        log.info("Disagreement escalation approved — proceeding with selected plan");
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
      runtime.completeRun(run.run_id, "Empty plan — no steps generated");
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
          statusWriter?.completeRun("cancelled");
          runtime.completeRun(run.run_id, "Cancelled by operator");
          return runtime.getRun(run.run_id)!;
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
        stepLog.warn(`Action blocked by plugin permissions: ${step.action}`);
        runStore?.emitEvent(run.run_id, agentId, "step_failed", {
          step_no: step.step, action: step.action,
          details: { error: "permission_denied", reason: `Plugin lacks permission for ${step.action}` },
        });
        decisionLog.logDecision({
          agent_id: agentId, run_id: run.run_id, step: step.step,
          action: step.action, reasoning: step.reasoning, outcome: "permission_denied",
        });
        continue; // Skip this step
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
          statusWriter?.completeRun("approval_timeout");
          runtime.completeRun(run.run_id, "Approval timeout");
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

        const outcome = result.status === "completed" ? "completed" : `failed: ${result.error?.message ?? result.summary}`;
        decisionLog.logDecision({
          agent_id: agentId, run_id: run.run_id, step: step.step,
          action: step.action, reasoning: step.reasoning, outcome,
        });

        if (result.status === "failed") {
          runStore?.emitEvent(run.run_id, agentId, "step_failed", {
            step_no: step.step, action: step.action,
            details: { error: result.error?.message, retryable: result.error?.retryable },
          });

          // Retry once if retryable
          if (result.error?.retryable) {
            stepLog.info("Failed (retryable) — retrying");
            const retry = await registry.executeJob({ ...envelope, attempt: 2 });
            if (retry.status === "failed") {
              stepLog.warn("Retry also failed");
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
          });
        }

        run.current_step = step.step;
        run.updated_at = new Date().toISOString();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        stepLog.error(`Threw: ${errMsg}`);
        runStore?.emitEvent(run.run_id, agentId, "step_failed", {
          step_no: step.step, action: step.action,
          details: { error: errMsg },
        });
        decisionLog.logDecision({
          agent_id: agentId, run_id: run.run_id, step: step.step,
          action: step.action, reasoning: step.reasoning, outcome: `error: ${errMsg}`,
        });
      }
    }

    // 5. Complete run — check durable status first to handle external cancellation
    const finalStatus = runStore?.getStatus(run.run_id);
    if (finalStatus === "cancelled") {
      log.info("Run was cancelled externally during final step — respecting cancellation");
      statusWriter?.completeRun("cancelled");
      runtime.completeRun(run.run_id, "Cancelled by operator");
      return runtime.getRun(run.run_id)!;
    }
    runStore?.transition(run.run_id, agentId, "completed", "run_completed", {
      details: { steps_completed: run.current_step, total_steps: plan.steps.length },
    });
    runStore?.completeCommand(run.run_id, "completed");
    statusWriter?.completeRun("completed");
    runtime.completeRun(run.run_id);
    log.info(`Completed (${run.current_step} steps)`);

    // 6. Capture lessons
    const decisions = decisionLog.getDecisions(agentId, run.run_id);
    lessonCapture.captureFromRun(runtime.getRun(run.run_id)!, decisions);

    // 7. Notify via Telegram queue
    const summary = `${def.label}: completed ${run.current_step}/${plan.steps.length} steps. Goal: ${run.goal}`;
    writeTelegramQueue(agentId, summary, runtimeDb);

    // 8. Post-hoc review notification for trusted_with_review agents
    if (def.maturity === "trusted_with_review") {
      writeTelegramQueue(agentId, `[REVIEW] ${def.label} completed autonomously. Run: ${run.run_id}. Review output and decisions.`, runtimeDb);
    }

    return runtime.getRun(run.run_id)!;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log.error(`Run failed: ${errMsg}`);
    runStore?.transition(run.run_id, agentId, "failed", "run_failed", {
      details: { error: errMsg },
    });
    runStore?.completeCommand(run.run_id, "failed");
    statusWriter?.completeRun(`error: ${errMsg}`);
    runtime.completeRun(run.run_id, errMsg);
    return runtime.getRun(run.run_id)!;
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
 */
function loadPluginPermissions(agentId: string, runtimeDb?: DatabaseSync): PluginPermission[] | null {
  if (!runtimeDb) return null;

  // Plugin agents typically have IDs starting with "plugin-"
  const pluginId = agentId.startsWith("plugin-") ? agentId.slice(7) : agentId;

  try {
    const row = runtimeDb.prepare(
      "SELECT manifest_json FROM plugin_installs WHERE plugin_id = ? AND status = 'active'",
    ).get(pluginId) as { manifest_json: string } | undefined;

    if (!row?.manifest_json) return null;

    const manifest = JSON.parse(row.manifest_json) as { permissions?: string[] };
    return (manifest.permissions as PluginPermission[]) ?? null;
  } catch {
    return null;
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
