import fs from "node:fs";
import { join } from "node:path";
import {
  AgentRuntime,
  AgentMemoryStore,
  SqliteKnowledgeStore,
  LessonCapture,
} from "@jarvis/agent-framework";
import { SqliteEntityGraph } from "@jarvis/agent-framework";
import { SqliteDecisionLog } from "@jarvis/agent-framework";
import { ALL_AGENTS } from "@jarvis/agents";
import { configureJarvisStatePersistence, getJarvisState } from "@jarvis/shared";
import { loadPlugins } from "./plugin-loader.js";
import { SchedulerStore, computeNextFireAt } from "@jarvis/scheduler";
import { loadConfig, JARVIS_DIR, KNOWLEDGE_DB_PATH, RUNTIME_DB_PATH } from "./config.js";
import { createWorkerRegistry } from "./worker-registry.js";
import { AgentQueue } from "./agent-queue.js";
import { Logger } from "./logger.js";
import { StatusWriter } from "./status-writer.js";
import type { AgentTrigger } from "@jarvis/agent-framework";

// ─── RT-206: Restart Policy ──────────────────────────────────────────────────
//
// JarvisState job status lifecycle and restart behavior:
//
//   queued              -> eligible for claim (normal scheduling path)
//   running + expired   -> requeued by requeueExpiredJobs() during lease-expiry
//        lease             sweep (runs every 60s while daemon is alive)
//   running + valid     -> if daemon PID is dead, requeued on next daemon startup
//        lease + dead      via requeueExpiredJobs() on startup
//        PID
//   awaiting_approval   -> kept as-is; approval can still resolve independently
//                          via JarvisState.resolveApproval() regardless of daemon
//   completed           -> terminal, no action
//   failed              -> terminal, no action
//   cancelled           -> terminal, no action
//
// On graceful shutdown (SIGINT/SIGTERM):
//   1. Release still-running agents' claims so they are requeued on restart
//   2. Record a daemon_shutdown dispatch for audit
//   3. Close JarvisState and knowledge DBs
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();
  const logger = new Logger(config.log_level);

  logger.info("Jarvis daemon starting...");

  // Ensure ~/.jarvis exists
  if (!fs.existsSync(JARVIS_DIR)) {
    logger.error(`${JARVIS_DIR} does not exist. Run: npx tsx scripts/init-jarvis.ts`);
    process.exit(1);
  }

  // ─── Initialize JarvisState (durable control plane) ───────────────────────
  configureJarvisStatePersistence({ databasePath: RUNTIME_DB_PATH });
  const jarvisState = getJarvisState();
  logger.info(`Runtime DB: ${RUNTIME_DB_PATH}`);

  // Requeue any jobs left in "running" state from a previous crash
  const requeued = jarvisState.requeueExpiredJobs();
  if (requeued > 0) {
    logger.info(`Recovered ${requeued} stalled jobs from previous run`);
  }

  // Initialize stores
  const knowledgeStore = new SqliteKnowledgeStore(KNOWLEDGE_DB_PATH);
  const entityGraph = new SqliteEntityGraph(KNOWLEDGE_DB_PATH);
  const decisionLog = new SqliteDecisionLog(KNOWLEDGE_DB_PATH);
  const memory = new AgentMemoryStore();
  const runtime = new AgentRuntime(memory);
  const lessonCapture = new LessonCapture(knowledgeStore);
  const registry = createWorkerRegistry(config, logger);
  const scheduler = new SchedulerStore();

  // Register all built-in agents
  for (const def of ALL_AGENTS) {
    runtime.registerAgent(def);
    logger.info(`  Registered agent: ${def.agent_id} (${def.label})`);
  }

  // Register plugin agents
  const pluginManifests = loadPlugins();
  for (const manifest of pluginManifests) {
    try {
      runtime.registerAgent(manifest.agent);
      logger.info(`  Registered plugin agent: ${manifest.agent.agent_id} (${manifest.name} v${manifest.version})`);
    } catch (e) {
      logger.error(`  Failed to register plugin ${manifest.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Collect all agent definitions (built-in + plugins) for scheduling
  const allAgentDefs = [...ALL_AGENTS, ...pluginManifests.map(m => m.agent)];

  // Seed schedules from agent triggers
  let scheduleCount = 0;
  for (const def of allAgentDefs) {
    for (const trigger of def.triggers) {
      if (trigger.kind === "schedule") {
        const nextFire = computeNextFireAt(
          { cron_expression: trigger.cron, interval_seconds: undefined } as Parameters<typeof computeNextFireAt>[0],
          new Date(),
        );
        scheduler.createSchedule({
          job_type: `agent.${def.agent_id}`,
          input: { agent_id: def.agent_id },
          cron_expression: trigger.cron,
          next_fire_at: nextFire,
          enabled: true,
          scope_group: "agents",
          label: def.label,
        });
        scheduleCount++;
        logger.info(`  Schedule: ${def.agent_id} @ ${trigger.cron}`);
      }
    }
  }

  logger.info(`Jarvis daemon started: ${allAgentDefs.length} agents (${pluginManifests.length} plugins), ${scheduleCount} schedules`);

  // Status writer — writes daemon state to ~/.jarvis/daemon-status.json every 10s
  const statusWriter = new StatusWriter(allAgentDefs.length, scheduleCount, logger);
  statusWriter.start();

  // Orchestrator deps
  const deps = { runtime, registry, knowledgeStore, entityGraph, decisionLog, lessonCapture, logger, statusWriter };

  // ─── Agent Queue (claims from JarvisState durable jobs) ───────────────────
  const agentQueue = new AgentQueue(config.max_concurrent, deps, logger);

  logger.info(`Concurrency: max_concurrent=${config.max_concurrent}`);

  // ─── Schedule check (every poll_interval_ms, default 60s) ─────────────────
  // Scheduled agents submit jobs to JarvisState, then the queue claims them.
  setInterval(async () => {
    const now = new Date();
    const due = scheduler.getDueSchedules(now);

    for (const schedule of due) {
      const agentId = (schedule.input as { agent_id: string }).agent_id;

      // Submit to JarvisState instead of directly enqueuing
      jarvisState.submitJob({
        type: "agent.start",
        input: {
          agent_id: agentId,
          trigger_kind: "schedule",
          cron: schedule.cron_expression,
        },
      });

      // Update next fire time
      scheduler.markFired(schedule.schedule_id);
      const nextFire = computeNextFireAt(schedule, now);
      scheduler.updateNextFireAt(schedule.schedule_id, nextFire);
    }

    // Process queue — claim and execute available jobs
    if (due.length > 0) {
      await agentQueue.processQueue();
    }
  }, config.poll_interval_ms);

  // ─── Manual trigger check (every trigger_poll_ms, default 10s) ────────────
  // Legacy: still poll for trigger files for backward compatibility during migration.
  // Also poll JarvisState for queued agent.start jobs submitted by dashboard/telegram/webhooks.
  setInterval(async () => {
    let hasWork = false;

    // Legacy trigger-file check (will be removed after dashboard/telegram are migrated)
    for (const def of allAgentDefs) {
      const triggerPath = join(JARVIS_DIR, `trigger-${def.agent_id}.json`);
      if (!fs.existsSync(triggerPath)) continue;

      logger.info(`Manual trigger detected (legacy file): ${def.agent_id}`);

      // Consume the trigger file
      try { fs.unlinkSync(triggerPath); } catch { /* race condition is fine */ }

      // Submit to JarvisState instead of directly enqueuing
      jarvisState.submitJob({
        type: "agent.start",
        input: {
          agent_id: def.agent_id,
          trigger_kind: "manual",
        },
      });
      hasWork = true;
    }

    // Always try to process queue (picks up jobs from any source)
    await agentQueue.processQueue();
  }, config.trigger_poll_ms);

  // ─── Lease expiry requeue (every 60s) ─────────────────────────────────────
  setInterval(() => {
    const requeued = jarvisState.requeueExpiredJobs();
    if (requeued > 0) {
      logger.info(`Requeued ${requeued} expired jobs`);
    }
  }, 60_000);

  // ─── Graceful shutdown ─────────────────────────────────────────────────────

  async function gracefulShutdown(signal: string) {
    logger.info(`Shutting down (${signal})...`);

    // Release running agents' claims so they're requeued on restart
    await agentQueue.shutdown();

    // Record shutdown audit dispatch
    try {
      jarvisState.createDispatch({
        kind: "dispatch_notify_completion",
        text: `Daemon shutdown (${signal}, pid=${process.pid}, running=${agentQueue.getRunningAgentIds().join(",") || "none"})`,
        requireApproval: false,
      });
    } catch { /* best effort */ }

    statusWriter.stop();
    jarvisState.close();
    knowledgeStore.close();
    entityGraph.close();
    decisionLog.close();
    process.exit(0);
  }

  process.on("SIGINT", () => { gracefulShutdown("SIGINT"); });
  process.on("SIGTERM", () => { gracefulShutdown("SIGTERM"); });
}

main().catch(e => {
  console.error("Daemon fatal error:", e);
  process.exit(1);
});
