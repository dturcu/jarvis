import type { AgentDefinition, AgentTrigger, AgentRun } from "@jarvis/agent-framework";
import { AgentRuntime, SqliteKnowledgeStore, LessonCapture } from "@jarvis/agent-framework";
import { SqliteEntityGraph } from "@jarvis/agent-framework";
import { SqliteDecisionLog } from "@jarvis/agent-framework";
import { getJarvisState } from "@jarvis/shared";
import type { WorkerCallback } from "@jarvis/shared";
import { buildPlanWithInference } from "./planner-real.js";
import { requestApproval, waitForApproval } from "./approval-bridge.js";
import { buildEnvelope, type WorkerRegistry } from "./worker-registry.js";
import { writeTelegramQueue } from "./notify.js";
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
};

/** Claim info from JarvisState, passed by AgentQueue */
export type ClaimInfo = {
  jobId: string;
  claimId: string;
  workerId: string;
  leaseSeconds: number;
};

/**
 * Run a single agent: plan → execute steps → evaluate → learn.
 * Blocks until the agent completes (or hits an unresolved approval timeout).
 *
 * When claimInfo is provided, the orchestrator heartbeats JarvisState during
 * execution and reports completion/failure via handleWorkerCallback.
 */
export async function runAgent(
  agentId: string,
  trigger: AgentTrigger,
  deps: OrchestratorDeps,
  claimInfo?: ClaimInfo,
): Promise<AgentRun> {
  const { runtime, registry, knowledgeStore, entityGraph, decisionLog, lessonCapture, logger, statusWriter, ragPipeline } = deps;

  const def = runtime.getDefinition(agentId);
  if (!def) throw new Error(`Agent not registered: ${agentId}`);

  logger.info(`Starting agent: ${agentId} (trigger: ${trigger.kind})`);

  // 1. Start run
  const run = runtime.startRun(agentId, trigger);

  // Notify status writer that an agent run started (steps TBD until plan completes)
  statusWriter?.setCurrentRun(agentId, 0);

  // Start heartbeat timer to keep the JarvisState lease alive
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (claimInfo) {
    heartbeatTimer = setInterval(() => {
      try {
        getJarvisState().heartbeatJob({
          worker_id: claimInfo.workerId,
          job_id: claimInfo.jobId,
          claim_id: claimInfo.claimId,
          lease_seconds: claimInfo.leaseSeconds,
          summary: `Agent ${agentId}: step ${run.current_step}/${run.total_steps} — ${run.status}`,
        });
      } catch (e) {
        logger.warn(`Heartbeat failed for job ${claimInfo.jobId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 30_000); // heartbeat every 30s
  }

  try {
    // 2. Gather context (including RAG-augmented chunks if pipeline is available)
    const context = await gatherContext(def, knowledgeStore, entityGraph, ragPipeline, logger);

    // 3. Build plan via inference
    const plan = await buildPlanWithInference({
      agent_id: agentId,
      run_id: run.run_id,
      goal: run.goal,
      system_prompt: def.system_prompt,
      context,
      capabilities: def.capabilities,
      max_steps: def.max_steps_per_run,
      deps: { chat: registry.chat.bind(registry), logger },
    });

    run.plan = plan;
    run.total_steps = plan.steps.length;
    run.status = "executing";
    run.updated_at = new Date().toISOString();

    if (plan.steps.length === 0) {
      logger.warn(`Agent ${agentId} produced empty plan`);
      statusWriter?.completeRun(agentId, "empty_plan");
      runtime.completeRun(run.run_id, "Empty plan — no steps generated");
      reportCompletion(claimInfo, agentId, run, "completed", "Empty plan — no steps generated", logger);
      return run;
    }

    // Update status writer with actual step count after planning
    statusWriter?.updateTotalSteps(agentId, plan.steps.length);

    logger.info(`Agent ${agentId} plan: ${plan.steps.length} steps`);

    // 4. Execute steps sequentially
    for (const step of plan.steps) {
      logger.info(`  Step ${step.step}/${plan.steps.length}: ${step.action}`, { reasoning: step.reasoning.slice(0, 100) });

      // Update status writer with current step progress
      statusWriter?.updateStep(agentId, step.step, step.action);

      // Check approval gate
      const gate = def.approval_gates.find(g => g.action === step.action);
      if (gate) {
        logger.info(`  Approval required for ${step.action} (${gate.severity})`);
        const approvalId = requestApproval({
          agent_id: agentId,
          run_id: run.run_id,
          action: step.action,
          severity: gate.severity,
          payload: `Step ${step.step}: ${step.action}\n\nReasoning: ${step.reasoning}\n\nInput: ${JSON.stringify(step.input).slice(0, 500)}`,
        });

        run.status = "awaiting_approval";
        run.updated_at = new Date().toISOString();
        statusWriter?.setAwaitingApproval(agentId, step.step, step.action);

        // Heartbeat with awaiting_approval status
        if (claimInfo) {
          try {
            getJarvisState().heartbeatJob({
              worker_id: claimInfo.workerId,
              job_id: claimInfo.jobId,
              claim_id: claimInfo.claimId,
              status: "awaiting_approval",
              lease_seconds: 14400, // 4h lease while waiting for approval
              summary: `Awaiting approval: ${step.action}`,
            });
          } catch { /* best effort */ }
        }

        const decision = await waitForApproval(approvalId, 4 * 60 * 60 * 1000); // 4h timeout

        if (decision === "rejected") {
          logger.info(`  Step ${step.step} rejected — skipping`);
          decisionLog.logDecision({
            agent_id: agentId, run_id: run.run_id, step: step.step,
            action: step.action, reasoning: step.reasoning, outcome: "rejected",
          });
          continue;
        }

        if (decision === "timeout") {
          logger.warn(`  Approval timeout for step ${step.step} — aborting run`);
          decisionLog.logDecision({
            agent_id: agentId, run_id: run.run_id, step: step.step,
            action: step.action, reasoning: step.reasoning, outcome: "approval_timeout",
          });
          statusWriter?.completeRun(agentId, "approval_timeout");
          runtime.completeRun(run.run_id, "Approval timeout");
          reportCompletion(claimInfo, agentId, run, "failed", "Approval timeout", logger);
          return run;
        }

        run.status = "executing";
        run.updated_at = new Date().toISOString();
        logger.info(`  Step ${step.step} approved — executing`);

        // Restore normal lease after approval
        if (claimInfo) {
          try {
            getJarvisState().heartbeatJob({
              worker_id: claimInfo.workerId,
              job_id: claimInfo.jobId,
              claim_id: claimInfo.claimId,
              lease_seconds: claimInfo.leaseSeconds,
              summary: `Executing step ${step.step}: ${step.action}`,
            });
          } catch { /* best effort */ }
        }
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
          // Retry once if retryable
          if (result.error?.retryable) {
            logger.info(`  Step ${step.step} failed (retryable) — retrying`);
            const retry = await registry.executeJob({ ...envelope, attempt: 2 });
            if (retry.status === "failed") {
              logger.warn(`  Step ${step.step} retry also failed`);
            }
          } else {
            logger.warn(`  Step ${step.step} failed: ${result.error?.message}`);
          }
        }

        run.current_step = step.step;
        run.updated_at = new Date().toISOString();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`  Step ${step.step} threw: ${errMsg}`);
        decisionLog.logDecision({
          agent_id: agentId, run_id: run.run_id, step: step.step,
          action: step.action, reasoning: step.reasoning, outcome: `error: ${errMsg}`,
        });
      }
    }

    // 5. Complete run
    // CRITICAL PATH: These durable state writes (JarvisState callback + runtime completion)
    // record the authoritative outcome. If they fail, the job's lease will expire and
    // requeueExpiredJobs() will recover it on restart.
    statusWriter?.completeRun(agentId, "completed");
    runtime.completeRun(run.run_id);
    logger.info(`Agent ${agentId} completed (${run.current_step} steps)`);

    // Report completion to JarvisState
    reportCompletion(claimInfo, agentId, run, "completed", `Completed ${run.current_step}/${run.total_steps} steps`, logger);

    // 6. Capture lessons
    const decisions = decisionLog.getDecisions(agentId, run.run_id);
    lessonCapture.captureFromRun(runtime.getRun(run.run_id)!, decisions);

    // 7. Notify via Telegram queue
    const summary = `${def.label}: completed ${run.current_step}/${plan.steps.length} steps. Goal: ${run.goal}`;
    writeTelegramQueue(agentId, summary);

    return runtime.getRun(run.run_id)!;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.error(`Agent ${agentId} run failed: ${errMsg}`);
    statusWriter?.completeRun(agentId, `error: ${errMsg}`);
    runtime.completeRun(run.run_id, errMsg);
    reportCompletion(claimInfo, agentId, run, "failed", errMsg, logger);
    return runtime.getRun(run.run_id)!;
  } finally {
    // Always clear the heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
}

/** Report run completion/failure to JarvisState via handleWorkerCallback */
function reportCompletion(
  claimInfo: ClaimInfo | undefined,
  agentId: string,
  run: AgentRun,
  status: "completed" | "failed",
  summary: string,
  logger: Logger,
): void {
  if (!claimInfo) return;
  try {
    const callback: WorkerCallback = {
      contract_version: "jarvis.v1",
      job_id: claimInfo.jobId,
      job_type: "agent.start",
      attempt: 1,
      status,
      summary,
      worker_id: claimInfo.workerId,
      claim_id: claimInfo.claimId,
      structured_output: {
        run_id: run.run_id,
        agent_id: agentId,
        steps_completed: run.current_step,
        total_steps: run.total_steps,
        plan: run.plan,
      },
      metrics: {
        started_at: run.started_at,
        finished_at: new Date().toISOString(),
      },
    };
    if (status === "failed") {
      callback.error = {
        code: "AGENT_RUN_FAILED",
        message: summary,
        retryable: true,
      };
    }
    getJarvisState().handleWorkerCallback(callback);
  } catch (e) {
    logger.error(`Failed to report completion for job ${claimInfo.jobId}: ${e instanceof Error ? e.message : String(e)}`);
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
