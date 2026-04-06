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
import { SchedulerStore, computeNextFireAt } from "@jarvis/scheduler";
import { loadConfig, JARVIS_DIR, KNOWLEDGE_DB_PATH } from "./config.js";
import { openRuntimeDb } from "./runtime-db.js";
import { createWorkerRegistry } from "./worker-registry.js";
import { AgentQueue } from "./agent-queue.js";
import { Logger } from "./logger.js";
import { StatusWriter } from "./status-writer.js";
import type { AgentTrigger } from "@jarvis/agent-framework";
import { randomUUID } from "node:crypto";
import { discoverModels, syncModelRegistry } from "@jarvis/inference";

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

  // Collect all agent definitions (built-in + plugins)
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

  logger.info(`Jarvis daemon started: ${allAgentDefs.length} agents (${pluginManifests.length} plugins), ${scheduleCount} schedules`);

  // Status writer — writes daemon heartbeat to runtime.db
  const statusWriter = new StatusWriter(allAgentDefs.length, scheduleCount, logger, runtimeDb);
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

  // Orchestrator deps
  const deps = { runtime, registry, knowledgeStore, entityGraph, decisionLog, lessonCapture, logger, statusWriter, runtimeDb };

  // Agent Queue
  const agentQueue = new AgentQueue(config.max_concurrent, deps, logger);
  logger.info(`Concurrency: max_concurrent=${config.max_concurrent}`);

  // ─── Phase 2: Run ──────────────────────────────────────────────────────────

  // Single unified polling loop — checks both scheduled agents and queued commands
  const pollInterval = setInterval(async () => {
    if (agentQueue.isDraining) return;

    // Check scheduled agents
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
          agentQueue.enqueue(cmd.target_agent_id, { kind: "manual" });

          // Mark command completed (agent execution is async via queue)
          runtimeDb.prepare(
            "UPDATE agent_commands SET status = 'completed', completed_at = ? WHERE command_id = ?",
          ).run(new Date().toISOString(), cmd.command_id);
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

  // ─── Phase 3: Drain ────────────────────────────────────────────────────────

  async function shutdown(signal: string) {
    logger.info(`Shutting down (${signal})...`);

    // Stop polling
    clearInterval(pollInterval);

    // Drain: wait for running agents to complete (30s timeout)
    await agentQueue.drain(30_000);

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
