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
import { loadPlugins } from "./plugin-loader.js";
import { SchedulerStore, computeNextFireAt } from "@jarvis/scheduler";
import { loadConfig, JARVIS_DIR, KNOWLEDGE_DB_PATH } from "./config.js";
import { createWorkerRegistry } from "./worker-registry.js";
import { AgentQueue } from "./agent-queue.js";
import { Logger } from "./logger.js";
import { StatusWriter } from "./status-writer.js";
import type { AgentTrigger } from "@jarvis/agent-framework";

async function main() {
  const config = loadConfig();
  const logger = new Logger(config.log_level);

  logger.info("Jarvis daemon starting...");

  // Ensure ~/.jarvis exists
  if (!fs.existsSync(JARVIS_DIR)) {
    logger.error(`${JARVIS_DIR} does not exist. Run: npx tsx scripts/init-jarvis.ts`);
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

  // Collect all agent definitions (built-in + plugins) for scheduling and trigger polling
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

  // ─── Agent Queue (replaces sequential `running` guard) ────────────────────
  const agentQueue = new AgentQueue(config.max_concurrent, deps, logger);

  logger.info(`Concurrency: max_concurrent=${config.max_concurrent}`);

  // ─── Schedule check (every poll_interval_ms, default 60s) ─────────────────

  setInterval(async () => {
    const now = new Date();
    const due = scheduler.getDueSchedules(now);

    for (const schedule of due) {
      const agentId = (schedule.input as { agent_id: string }).agent_id;
      const cronTrigger: AgentTrigger = { kind: "schedule", cron: schedule.cron_expression! };

      agentQueue.enqueue(agentId, cronTrigger);

      // Update next fire time
      scheduler.markFired(schedule.schedule_id);
      const nextFire = computeNextFireAt(schedule, now);
      scheduler.updateNextFireAt(schedule.schedule_id, nextFire);
    }

    if (due.length > 0) {
      await agentQueue.processQueue();
    }
  }, config.poll_interval_ms);

  // ─── Manual trigger check (every trigger_poll_ms, default 10s) ────────────

  setInterval(async () => {
    let enqueued = false;

    for (const def of allAgentDefs) {
      const triggerPath = join(JARVIS_DIR, `trigger-${def.agent_id}.json`);
      if (!fs.existsSync(triggerPath)) continue;

      logger.info(`Manual trigger detected: ${def.agent_id}`);

      // Consume the trigger file
      try { fs.unlinkSync(triggerPath); } catch { /* race condition is fine */ }

      agentQueue.enqueue(def.agent_id, { kind: "manual" });
      enqueued = true;
    }

    if (enqueued) {
      await agentQueue.processQueue();
    }
  }, config.trigger_poll_ms);

  // ─── Keep alive ───────────────────────────────────────────────────────────

  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    statusWriter.stop();
    knowledgeStore.close();
    entityGraph.close();
    decisionLog.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down (SIGTERM)...");
    statusWriter.stop();
    knowledgeStore.close();
    entityGraph.close();
    decisionLog.close();
    process.exit(0);
  });
}

main().catch(e => {
  console.error("Daemon fatal error:", e);
  process.exit(1);
});
