import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  AgentRuntime,
  AgentMemoryStore,
  SqliteKnowledgeStore,
  LessonCapture,
} from "@jarvis/agent-framework";
import { SqliteEntityGraph } from "@jarvis/agent-framework";
import { SqliteDecisionLog } from "@jarvis/agent-framework";
import { ALL_AGENTS } from "@jarvis/agents";
import { loadPlugins } from "./plugin-loader.js";
import { computeNextFireAt } from "@jarvis/scheduler";
import { loadConfig, JARVIS_DIR, KNOWLEDGE_DB_PATH } from "./config.js";
import { openRuntimeDb } from "./runtime-db.js";
import { createWorkerRegistry } from "./worker-registry.js";
import { AgentQueue } from "./agent-queue.js";
import { DbSchedulerStore } from "./db-scheduler.js";
import { Logger } from "./logger.js";
import { StatusWriter } from "./status-writer.js";
import type { AgentTrigger } from "@jarvis/agent-framework";
import { discoverModels, syncModelRegistry } from "@jarvis/inference";
import { RunStore } from "./run-store.js";
import { resolveApproval } from "./approval-bridge.js";

// ─── Restart Policy ──────────────────────────────────────────────────────────
// On daemon shutdown (SIGINT/SIGTERM), active runs are transitioned as follows:
//   queued            → cancelled   (never started, safe to discard)
//   planning          → failed      (partial work may exist, needs re-run)
//   executing         → failed      (partial work may exist, needs re-run)
//   awaiting_approval → failed      (pending approvals expired first)
// On restart, the daemon does NOT auto-retry failed runs. Operators must
// re-trigger them via command or schedule. Claimed commands are released
// back to 'queued' so they will be picked up on next startup.
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // ─── Phase 1: Init ──────────────────────────────────────────────────────────
  const config = loadConfig();
  const logger = new Logger(config.log_level);

  logger.info("Jarvis daemon starting...");

  // Ensure ~/.jarvis exists
  if (!fs.existsSync(JARVIS_DIR)) {
    logger.error(`${JARVIS_DIR} does not exist. Run: npx tsx scripts/init-jarvis.ts`);
    process.exit(1);
  }

  // Open runtime database (creates + migrates if needed)
  let runtimeDb: DatabaseSync;
  try {
    runtimeDb = openRuntimeDb();
    logger.info("Runtime database opened");
  } catch (e) {
    logger.error(`Failed to open runtime database: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // Initialize stores
  const knowledgeStore = new SqliteKnowledgeStore(KNOWLEDGE_DB_PATH);
  const entityGraph = new SqliteEntityGraph(KNOWLEDGE_DB_PATH);
  const decisionLog = new SqliteDecisionLog(KNOWLEDGE_DB_PATH);
  const memory = new AgentMemoryStore();
  const runtime = new AgentRuntime(memory);
  const lessonCapture = new LessonCapture(knowledgeStore);
  const registry = createWorkerRegistry(config, logger, runtimeDb);

  // DB-backed scheduler — persists across restarts
  const scheduler = new DbSchedulerStore(runtimeDb);

  // Register all built-in agents
  for (const def of ALL_AGENTS) {
    runtime.registerAgent(def);
    logger.info(`  Registered agent: ${def.agent_id} (${def.label})`);
  }

  // Register plugin agents
  const pluginManifests = loadPlugins(logger);
  for (const manifest of pluginManifests) {
    try {
      runtime.registerAgent(manifest.agent);
      logger.info(`  Registered plugin agent: ${manifest.agent.agent_id} (${manifest.name} v${manifest.version})`);
    } catch (e) {
      logger.error(`  Failed to register plugin ${manifest.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Collect all agent definitions (built-in + plugins)
  const allAgentDefs = [...ALL_AGENTS, ...pluginManifests.map(m => m.agent)];

  // Seed schedules from agent triggers (only inserts if not already in DB)
  let scheduleCount = 0;
  for (const def of allAgentDefs) {
    for (const trigger of def.triggers) {
      if (trigger.kind === "schedule") {
        const nextFire = computeNextFireAt(
          { cron_expression: trigger.cron, interval_seconds: undefined } as Parameters<typeof computeNextFireAt>[0],
          new Date(),
        );
        const inserted = scheduler.seedSchedule({
          job_type: `agent.${def.agent_id}`,
          input: { agent_id: def.agent_id },
          cron_expression: trigger.cron,
          next_fire_at: nextFire,
          enabled: true,
          scope_group: "agents",
          label: def.label,
        });
        if (inserted) {
          logger.info(`  Schedule (new): ${def.agent_id} @ ${trigger.cron}`);
        }
        scheduleCount++;
      }
    }
  }

  const totalSchedules = scheduler.count();
  logger.info(`Schedules: ${totalSchedules} in DB (${scheduleCount} from agent definitions)`);

  // Discover local models and populate registry
  try {
    const discovery = await discoverModels(config.lmstudio_url);
    if (discovery.discovered.length > 0) {
      const sync = syncModelRegistry(runtimeDb, discovery.discovered);
      logger.info(`Model discovery: ${discovery.discovered.length} models (${sync.added} new, ${sync.updated} updated)`);
    }
    for (const err of discovery.errors) {
      logger.warn(`Model discovery: ${err}`);
    }
  } catch (e) {
    logger.warn(`Model discovery failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  logger.info(`Jarvis daemon started: ${allAgentDefs.length} agents (${pluginManifests.length} plugins), ${totalSchedules} schedules`);

  // Status writer — writes daemon heartbeat to runtime.db
  const statusWriter = new StatusWriter(allAgentDefs.length, totalSchedules, logger, runtimeDb);
  statusWriter.start();

  // Recover stale command claims from previous crash
  try {
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min
    const result = runtimeDb.prepare(
      "UPDATE agent_commands SET status = 'queued', claimed_at = NULL WHERE status = 'claimed' AND claimed_at < ?",
    ).run(staleThreshold);
    const changes = (result as { changes: number }).changes;
    if (changes > 0) {
      logger.info(`Recovered ${changes} stale command claim(s)`);
    }
  } catch (e) {
    logger.warn(`Failed to recover stale claims: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Recover runs stuck in awaiting_approval with no pending approvals
  try {
    const stuckRuns = runtimeDb.prepare(`
      SELECT r.run_id, r.agent_id FROM runs r
      WHERE r.status = 'awaiting_approval'
      AND NOT EXISTS (
        SELECT 1 FROM approvals a WHERE a.run_id = r.run_id AND a.status = 'pending'
      )
    `).all() as Array<{ run_id: string; agent_id: string }>;

    if (stuckRuns.length > 0) {
      const runStore = new RunStore(runtimeDb);
      for (const run of stuckRuns) {
        runStore.transition(run.run_id, run.agent_id, "failed", "run_failed", {
          details: { reason: "restart_recovery", original_status: "awaiting_approval" },
        });
        logger.info(`Restart recovery: failed stuck run ${run.run_id} (was awaiting_approval with no pending approvals)`);
      }
      logger.info(`Restart recovery: resolved ${stuckRuns.length} stuck awaiting_approval run(s)`);
    }
  } catch (e) {
    logger.warn(`Restart recovery (stuck runs): ${e instanceof Error ? e.message : String(e)}`);
  }

  // Orchestrator deps
  const deps = { runtime, registry, knowledgeStore, entityGraph, decisionLog, lessonCapture, logger, statusWriter, runtimeDb };

  // Agent Queue
  const agentQueue = new AgentQueue(config.max_concurrent, deps, logger);
  logger.info(`Concurrency: max_concurrent=${config.max_concurrent}`);

  // ─── Phase 2: Run ──────────────────────────────────────────────────────────

  // Single unified polling loop — checks both scheduled agents and queued commands
  const pollInterval = setInterval(async () => {
    if (agentQueue.isDraining) return;

    // Check scheduled agents (from DB-backed scheduler)
    const now = new Date();
    const due = scheduler.getDueSchedules(now);
    for (const schedule of due) {
      const agentId = (schedule.input as { agent_id: string }).agent_id;
      const cronTrigger: AgentTrigger = { kind: "schedule", cron: schedule.cron_expression! };
      agentQueue.enqueue(agentId, cronTrigger);
      scheduler.markFired(schedule.schedule_id);
      const nextFire = computeNextFireAt(schedule, now);
      scheduler.updateNextFireAt(schedule.schedule_id, nextFire);
    }

    // Check queued commands in runtime.db
    try {
      const commands = runtimeDb.prepare(
        "SELECT command_id, command_type, target_agent_id, payload_json FROM agent_commands WHERE status = 'queued' ORDER BY priority DESC, created_at ASC LIMIT 10",
      ).all() as Array<{ command_id: string; command_type: string; target_agent_id: string; payload_json: string | null }>;

      for (const cmd of commands) {
        // Claim the command
        const claimResult = runtimeDb.prepare(
          "UPDATE agent_commands SET status = 'claimed', claimed_at = ? WHERE command_id = ? AND status = 'queued'",
        ).run(new Date().toISOString(), cmd.command_id);

        if ((claimResult as { changes: number }).changes === 0) continue; // Already claimed by another

        if (cmd.command_type === "run_agent" && cmd.target_agent_id) {
          logger.info(`Command ${cmd.command_id}: run_agent ${cmd.target_agent_id}`);

          // Parse command payload (carries retry_of, etc.) for the orchestrator
          let commandPayload: Record<string, unknown> | undefined;
          if (cmd.payload_json) {
            try { commandPayload = JSON.parse(cmd.payload_json) as Record<string, unknown>; } catch { /* ignore malformed */ }
          }

          // Enqueue the agent with command_id + payload for atomic linkage.
          // The orchestrator receives command_id via trigger and links it to the run directly.
          // RunStore.completeCommand() marks the command completed/failed when the run ends.
          agentQueue.enqueue(cmd.target_agent_id, { kind: "manual" }, 0, cmd.command_id, commandPayload);
        } else {
          logger.warn(`Unknown command type: ${cmd.command_type}`);
          runtimeDb.prepare(
            "UPDATE agent_commands SET status = 'failed', completed_at = ? WHERE command_id = ?",
          ).run(new Date().toISOString(), cmd.command_id);
        }
      }
    } catch (e) {
      logger.error(`Command poll error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Process any enqueued agents
    if (due.length > 0 || !agentQueue.isDraining) {
      await agentQueue.processQueue();
    }
  }, Math.min(config.poll_interval_ms, config.trigger_poll_ms));

  // ─── Periodic model re-discovery (every 5 min) ─────────────────────────────
  const modelRediscoveryInterval = setInterval(async () => {
    try {
      const discovery = await discoverModels(config.lmstudio_url);
      if (discovery.discovered.length > 0) {
        const sync = syncModelRegistry(runtimeDb, discovery.discovered);
        if (sync.added > 0 || sync.updated > 0) {
          logger.info(`Model re-discovery: ${sync.added} new, ${sync.updated} updated`);
        }
      }
    } catch {
      // Model runtime may be temporarily down — don't log noise on every 5min tick
    }
  }, 5 * 60 * 1000);

  // ─── Phase 3: Drain ────────────────────────────────────────────────────────

  async function shutdown(signal: string) {
    logger.info(`Shutting down (${signal})...`);

    // Stop polling
    clearInterval(pollInterval);
    clearInterval(modelRediscoveryInterval);

    // Drain: wait for running agents to complete (30s timeout)
    await agentQueue.drain(30_000);

    // Transition any non-terminal runs via RunStore (validates state machine + emits run_events)
    try {
      const runStore = new RunStore(runtimeDb);
      const activeRuns = runtimeDb.prepare(
        "SELECT run_id, agent_id, status FROM runs WHERE status NOT IN ('completed','failed','cancelled')",
      ).all() as Array<{ run_id: string; agent_id: string; status: string }>;

      for (const run of activeRuns) {
        try {
          if (run.status === "awaiting_approval") {
            // Expire pending approvals before transitioning the run
            const pendingApprovals = runtimeDb.prepare(
              "SELECT approval_id FROM approvals WHERE run_id = ? AND status = 'pending'",
            ).all(run.run_id) as Array<{ approval_id: string }>;
            for (const approval of pendingApprovals) {
              resolveApproval(runtimeDb, approval.approval_id, "expired", `daemon-${process.pid}`, "daemon_shutdown");
            }
            runStore.transition(run.run_id, run.agent_id, "failed", "daemon_shutdown", {
              details: { reason: "daemon_shutdown", signal },
            });
          } else if (run.status === "executing" || run.status === "planning") {
            runStore.transition(run.run_id, run.agent_id, "failed", "daemon_shutdown", {
              details: { reason: "daemon_shutdown", signal },
            });
          } else if (run.status === "queued") {
            runStore.transition(run.run_id, run.agent_id, "cancelled", "daemon_shutdown", {
              details: { reason: "daemon_shutdown", signal },
            });
          }
        } catch (e) {
          logger.warn(`Failed to transition run ${run.run_id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (activeRuns.length > 0) {
        logger.warn(`Transitioned ${activeRuns.length} in-flight run(s) on shutdown`);
      }

      // Record shutdown in audit_log
      runtimeDb.prepare(`
        INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
        VALUES (?, 'daemon', ?, 'daemon.shutdown', 'daemon', ?, ?, ?)
      `).run(
        randomUUID(),
        `daemon-${process.pid}`,
        `daemon-${process.pid}`,
        JSON.stringify({ signal, runs_affected: activeRuns.length, pid: process.pid }),
        new Date().toISOString(),
      );
    } catch (e) {
      logger.warn(`Shutdown transition error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Release any claimed commands back to queued
    try {
      const staleCmds = runtimeDb.prepare(
        "UPDATE agent_commands SET status = 'queued', claimed_at = NULL WHERE status = 'claimed'",
      ).run();
      const changes = (staleCmds as { changes: number }).changes;
      if (changes > 0) {
        logger.warn(`Released ${changes} claimed command(s) back to queue on shutdown`);
      }
    } catch { /* best-effort */ }

    // Stop heartbeat writer
    statusWriter.stop();

    // Close databases
    try { runtimeDb.close(); } catch { /* best-effort */ }
    knowledgeStore.close();
    entityGraph.close();
    decisionLog.close();

    logger.info("Daemon stopped cleanly");
    process.exit(0);
  }

  process.on("SIGINT", () => { shutdown("SIGINT"); });
  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
}

main().catch(e => {
  console.error("Daemon fatal error:", e);
  process.exit(1);
});
