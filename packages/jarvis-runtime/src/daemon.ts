import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  AgentRuntime,
  SqliteMemoryStore,
  SqliteKnowledgeStore,
  LessonCapture,
  VectorStore,
  SparseStore,
  EmbeddingPipeline,
  HybridRetriever,
} from "@jarvis/agent-framework";
import { SqliteEntityGraph } from "@jarvis/agent-framework";
import { SqliteDecisionLog } from "@jarvis/agent-framework";
import { ALL_AGENTS } from "@jarvis/agents";
import { loadPlugins } from "./plugin-loader.js";
import { computeNextFireAt } from "@jarvis/scheduler";
import { loadConfig, JARVIS_DIR, KNOWLEDGE_DB_PATH } from "./config.js";
import { createDbScheduleTrigger, createExternalTriggerSource, type ScheduleTriggerSource } from "./schedule-trigger.js";
import { RagPipeline } from "./rag-pipeline.js";
import { openRuntimeDb } from "./runtime-db.js";
import { createWorkerRegistry } from "./worker-registry.js";
import { AgentQueue } from "./agent-queue.js";
import { DbSchedulerStore } from "./db-scheduler.js";
import { Logger } from "./logger.js";
import { StatusWriter } from "./status-writer.js";
import type { AgentTrigger } from "@jarvis/agent-framework";
import { discoverModels, syncModelRegistry } from "@jarvis/inference";
import { RunStore } from "./run-store.js";
import { ChannelStore } from "./channel-store.js";
import { WorkerHealthMonitor } from "./worker-health.js";
import { WORKER_EXECUTION_POLICIES } from "./execution-policy.js";
import { setWorkerHealthProvider } from "./health.js";
import { resolveApproval } from "./approval-bridge.js";
import { createNotificationDispatcher } from "./notify.js";
import { sendSessionMessage } from "@jarvis/shared";

// ─── DB Integrity (#65) ─────────────────────────────────────────────────────
// Verify SQLite pragmas that the runtime depends on. Log warnings instead of
// aborting — the daemon can still operate, but data-safety is reduced.
// ─────────────────────────────────────────────────────────────────────────────
function verifyDbIntegrity(db: DatabaseSync, name: string, logger: Logger): void {
  try {
    const journalMode = (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string })?.journal_mode;
    if (journalMode !== "wal") {
      logger.warn(`DB integrity [${name}]: journal_mode is '${journalMode}', expected 'wal'`);
    }
  } catch (e) {
    logger.warn(`DB integrity [${name}]: failed to check journal_mode: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const fk = (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number })?.foreign_keys;
    if (fk !== 1) {
      logger.warn(`DB integrity [${name}]: foreign_keys is ${fk}, expected 1`);
    }
  } catch (e) {
    logger.warn(`DB integrity [${name}]: failed to check foreign_keys: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const timeout = (db.prepare("PRAGMA busy_timeout").get() as { busy_timeout: number })?.busy_timeout;
    if (!timeout || timeout <= 0) {
      logger.warn(`DB integrity [${name}]: busy_timeout is ${timeout}, expected > 0`);
    }
  } catch (e) {
    logger.warn(`DB integrity [${name}]: failed to check busy_timeout: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Dead-letter helpers (#67) ───────────────────────────────────────────────
// Commands stuck in 'queued' longer than a threshold are likely dead-letters.
// The polling loop emits warnings; operators can investigate via the dashboard.
// ─────────────────────────────────────────────────────────────────────────────
function getStaleCommands(
  db: DatabaseSync,
  maxAgeMs: number,
): Array<{ command_id: string; target_agent_id: string; created_at: string }> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  return db.prepare(
    "SELECT command_id, target_agent_id, created_at FROM agent_commands WHERE status = 'queued' AND created_at < ? ORDER BY created_at ASC LIMIT 50",
  ).all(cutoff) as Array<{ command_id: string; target_agent_id: string; created_at: string }>;
}

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

  // Verify DB pragmas (#65)
  verifyDbIntegrity(runtimeDb, "runtime.db", logger);

  // Initialize stores
  const knowledgeStore = new SqliteKnowledgeStore(KNOWLEDGE_DB_PATH);
  const entityGraph = new SqliteEntityGraph(KNOWLEDGE_DB_PATH);
  const decisionLog = new SqliteDecisionLog(KNOWLEDGE_DB_PATH);
  // Use durable SQLite-backed memory — survives daemon restarts.
  // The in-memory AgentMemoryStore is no longer used; all agent memory
  // is persisted in the knowledge DB alongside the rest of the knowledge plane.
  const memory = new SqliteMemoryStore(KNOWLEDGE_DB_PATH);
  const runtime = new AgentRuntime(memory);
  const lessonCapture = new LessonCapture(knowledgeStore);

  // ─── Retrieval stores ────────────────────────────────────────────────────
  // VectorStore and SparseStore self-create their tables on construction.
  const vectorStore = new VectorStore(KNOWLEDGE_DB_PATH);
  const sparseStore = new SparseStore(KNOWLEDGE_DB_PATH);

  // Embedding model selection: check the model registry for a model tagged
  // "embedding", fall back to well-known defaults for each runtime.
  const EMBEDDING_DEFAULTS: Record<string, { url: string; model: string }> = {
    lmstudio: { url: config.lmstudio_url ?? "http://localhost:1234", model: "nomic-embed-text" },
    ollama:   { url: "http://localhost:11434", model: "nomic-embed-text" },
  };
  let embeddingBaseUrl = EMBEDDING_DEFAULTS.lmstudio.url;
  let embeddingModel = EMBEDDING_DEFAULTS.lmstudio.model;
  try {
    const { loadRegisteredModels } = await import("@jarvis/inference");
    const models = loadRegisteredModels(runtimeDb);
    const embeddingCapable = models.find(m =>
      m.tags?.includes("embedding") && m.enabled,
    );
    if (embeddingCapable) {
      embeddingBaseUrl = EMBEDDING_DEFAULTS[embeddingCapable.runtime]?.url ?? embeddingBaseUrl;
      embeddingModel = embeddingCapable.model_id;
      logger.info(`Embedding model: ${embeddingModel} (${embeddingCapable.runtime}, from registry)`);
    } else {
      logger.info(`Embedding model: ${embeddingModel} (default — no embedding-tagged model in registry)`);
    }
  } catch {
    logger.info(`Embedding model: ${embeddingModel} (default — registry unavailable)`);
  }

  const embedFn: import("@jarvis/agent-framework").EmbedFn = async (params) => {
    const { embedTexts } = await import("@jarvis/inference");
    return embedTexts(params);
  };
  const hybridRetriever = new HybridRetriever({
    vectorStore,
    sparseStore,
    embeddingBaseUrl,
    embeddingModel,
    embedFn,
  });
  logger.info("Retrieval stores initialized (vector + sparse + hybrid)");

  // Worker health monitor — tracks per-worker execution outcomes
  const healthMonitor = new WorkerHealthMonitor(WORKER_EXECUTION_POLICIES);
  setWorkerHealthProvider(() => healthMonitor.getHealthReport());

  const registry = createWorkerRegistry(config, logger, runtimeDb, healthMonitor, {
    hybridRetriever,
  });

  // ─── Embedding + RAG pipeline ────────────────────────────────────────────
  // Created after registry (needs worker for embedding calls).
  // EmbeddingPipeline is attached to the knowledge store so new documents
  // are automatically chunked and embedded on ingestion.
  const embeddingPipeline = new EmbeddingPipeline({
    vectorStore,
    sparseStore,
    embeddingBaseUrl,
    embeddingModel,
    embedFn,
  });
  knowledgeStore.setEmbeddingPipeline(embeddingPipeline);
  const ragPipeline = new RagPipeline(vectorStore, registry, logger, sparseStore);
  logger.info("Embedding pipeline + RAG pipeline initialized");

  // DB-backed scheduler — persists across restarts
  const scheduler = new DbSchedulerStore(runtimeDb);

  // ─── Schedule trigger source ────────────────────────────────────────────────
  // Select based on JARVIS_SCHEDULE_SOURCE env var (default: "db").
  // "db"       — daemon polls DbSchedulerStore for due schedules (legacy/standalone).
  // "external" — OpenClaw TaskFlow fires schedules; daemon skips schedule polling.
  const scheduleSourceEnv = (process.env.JARVIS_SCHEDULE_SOURCE ?? "db").toLowerCase();
  let scheduleTrigger: ScheduleTriggerSource;
  if (scheduleSourceEnv === "external") {
    scheduleTrigger = createExternalTriggerSource();
    logger.info("Schedule source: external (OpenClaw TaskFlow manages schedule evaluation)");
  } else {
    scheduleTrigger = createDbScheduleTrigger(scheduler, computeNextFireAt);
    if (scheduleSourceEnv !== "db") {
      logger.warn(`Unknown JARVIS_SCHEDULE_SOURCE="${scheduleSourceEnv}", defaulting to "db"`);
    }
    logger.info("Schedule source: db (daemon polls DbSchedulerStore)");
  }

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
  // Maturity enforcement: experimental agents are seeded as disabled
  let scheduleCount = 0;
  for (const def of allAgentDefs) {
    for (const trigger of def.triggers) {
      if (trigger.kind === "schedule") {
        const isExperimental = def.maturity === "experimental" || def.pack === "experimental";
        const nextFire = computeNextFireAt(
          { cron_expression: trigger.cron, interval_seconds: undefined } as Parameters<typeof computeNextFireAt>[0],
          new Date(),
        );
        const inserted = scheduler.seedSchedule({
          job_type: `agent.${def.agent_id}`,
          input: { agent_id: def.agent_id },
          cron_expression: trigger.cron,
          next_fire_at: nextFire,
          enabled: !isExperimental,
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

  // ─── Safe mode check ──────────────────────────────────────────────────────
  // Check system health before starting autonomous execution.
  // If critical issues detected, start in safe mode (no autonomous execution).
  let safeMode = false;
  let safeModeReason: string | null = null;

  try {
    // Check runtime DB tables (core 4 + channel 3)
    const tableCheck = runtimeDb.prepare(
      "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name IN ('runs','approvals','agent_commands','daemon_heartbeats','channel_threads','channel_messages','artifact_deliveries')",
    ).get() as { n: number };
    if (tableCheck.n < 7) {
      safeMode = true;
      safeModeReason = `Missing required tables (found ${tableCheck.n}/7)`;
    }

    // Check config validity
    if (!safeMode) {
      const configValid = config.lmstudio_url && config.adapter_mode;
      if (!configValid) {
        safeMode = true;
        safeModeReason = "Invalid configuration (missing lmstudio_url or adapter_mode)";
      }
    }
  } catch (e) {
    safeMode = true;
    safeModeReason = `Health check failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (safeMode) {
    logger.warn(`SAFE MODE: ${safeModeReason}`);
    logger.warn("Autonomous execution disabled. Dashboard and health endpoints still available.");
    logger.warn("Fix the issue and Jarvis will exit safe mode automatically.");
  }

  // Record safe mode status in heartbeat
  statusWriter.setSafeMode(safeMode, safeModeReason);

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
        // Also complete the linked command so it doesn't stay stuck in 'claimed'
        runStore.completeCommand(run.run_id, "failed");
        logger.info(`Restart recovery: failed stuck run ${run.run_id} (was awaiting_approval with no pending approvals)`);
      }
      logger.info(`Restart recovery: resolved ${stuckRuns.length} stuck awaiting_approval run(s)`);
    }
  } catch (e) {
    logger.warn(`Restart recovery (stuck runs): ${e instanceof Error ? e.message : String(e)}`);
  }

  // Channel store for durable channel tracking
  let channelStore: ChannelStore | undefined;
  try {
    channelStore = new ChannelStore(runtimeDb);
    logger.info("Channel store initialized");
  } catch (e) {
    logger.warn(`Channel store init failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Notification dispatcher — routes through session or legacy Telegram DB queue
  const telegramMode = (process.env.JARVIS_TELEGRAM_MODE ?? "session").toLowerCase();
  const notifier = createNotificationDispatcher({
    channel: telegramMode === "session" ? "session" : "telegram",
    sessionSend: telegramMode === "session"
      ? async (text) => { await sendSessionMessage({ sessionKey: process.env.JARVIS_TELEGRAM_SESSION_KEY ?? "telegram:main", message: text }); }
      : undefined,
  });

  // Orchestrator deps
  const deps = { runtime, registry, knowledgeStore, entityGraph, decisionLog, lessonCapture, logger, statusWriter, runtimeDb, channelStore, ragPipeline, notifier };

  // Agent Queue
  const agentQueue = new AgentQueue(config.max_concurrent, deps, logger);
  logger.info(`Concurrency: max_concurrent=${config.max_concurrent}`);

  // ─── Phase 2: Run ──────────────────────────────────────────────────────────

  // Track active intervals so shutdown can clean them all up
  const activeIntervals: ReturnType<typeof setInterval>[] = [];

  /**
   * Start the autonomous polling intervals (schedule, command, model rediscovery).
   * Extracted into a function so it can be called on normal startup or deferred
   * until safe mode conditions clear.
   */
  function startPollingIntervals(): void {
    logger.info("Starting polling intervals (autonomous execution enabled)");

    // Single unified polling loop — checks both scheduled agents and queued commands
    const pollInterval = setInterval(async () => {
      if (agentQueue.isDraining) return;

      // Check scheduled agents (via pluggable trigger source)
      const now = new Date();
      const due = scheduleTrigger.getDueSchedules(now);
      for (const schedule of due) {
        const cronTrigger: AgentTrigger = { kind: "schedule", cron: schedule.cron_expression };
        // Pass "scheduler" as owner so scheduled runs have attribution in audit trail
        agentQueue.enqueue(schedule.agent_id, cronTrigger, 0, undefined, undefined, "scheduler");
        scheduleTrigger.markFired(schedule.schedule_id, now);
      }

      // Check queued commands in runtime.db
      try {
        const commands = runtimeDb.prepare(
          "SELECT command_id, command_type, target_agent_id, payload_json, created_by FROM agent_commands WHERE status = 'queued' ORDER BY priority DESC, created_at ASC LIMIT 10",
        ).all() as Array<{ command_id: string; command_type: string; target_agent_id: string; payload_json: string | null; created_by: string | null }>;

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
            // If enqueue is a no-op (agent already running/queued), revert the claim.
            // Pass created_by as owner so run ownership is tracked
            const owner = cmd.created_by ?? undefined;
            const enqueued = agentQueue.enqueue(cmd.target_agent_id, { kind: "manual" }, 0, cmd.command_id, commandPayload, owner);
            if (!enqueued) {
              runtimeDb.prepare(
                "UPDATE agent_commands SET status = 'queued', claimed_at = NULL WHERE command_id = ?",
              ).run(cmd.command_id);
              logger.debug(`Reverted claim for command ${cmd.command_id} — agent ${cmd.target_agent_id} already running/queued`);
            }
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

      // Dead-letter check (#67): warn about commands stuck in 'queued' > 1 hour
      try {
        const staleCommands = getStaleCommands(runtimeDb, 60 * 60 * 1000);
        for (const cmd of staleCommands) {
          logger.warn(`Dead-letter: command ${cmd.command_id} for agent ${cmd.target_agent_id} has been queued since ${cmd.created_at}`);
        }
      } catch (e) {
        logger.warn(`Dead-letter check error: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Process any enqueued agents
      if (due.length > 0 || !agentQueue.isDraining) {
        await agentQueue.processQueue();
      }
    }, Math.min(config.poll_interval_ms, config.trigger_poll_ms));
    activeIntervals.push(pollInterval);

    // ─── Periodic model re-discovery (every 5 min) ───────────────────────────
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
    activeIntervals.push(modelRediscoveryInterval);

    // ─── Daily maintenance: compact old events, archive old content, vacuum ──
    const maintenanceInterval = setInterval(() => {
      try {
        const runStore = new RunStore(runtimeDb);
        const eventsCompacted = runStore.compactOldEvents(90);
        if (eventsCompacted > 0) logger.info(`Maintenance: compacted ${eventsCompacted} old run events`);

        const cs = new ChannelStore(runtimeDb);
        const contentArchived = cs.archiveOldContent(30);
        if (contentArchived > 0) logger.info(`Maintenance: archived ${contentArchived} old message contents`);

        // Vacuum to reclaim space
        runtimeDb.exec("PRAGMA incremental_vacuum(100)");
      } catch (e) {
        logger.warn(`Maintenance error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 24 * 60 * 60 * 1000); // Every 24 hours
    activeIntervals.push(maintenanceInterval);
  }

  // ─── Conditional interval startup ──────────────────────────────────────────
  if (!safeMode) {
    startPollingIntervals();
  } else {
    logger.info("Safe mode: skipping schedule, command, and model polling intervals");

    // ─── Periodic safe mode re-check (every 60s) ────────────────────────────
    // When conditions clear, automatically exit safe mode and start polling.
    const safeModeCheckInterval = setInterval(() => {
      try {
        const tableCheck = runtimeDb.prepare(
          "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name IN ('runs','approvals','agent_commands','daemon_heartbeats')",
        ).get() as { n: number };
        // Re-read config from disk so operator edits are observed without restart
        const latestConfig = loadConfig();
        const configValid = latestConfig.lmstudio_url && latestConfig.adapter_mode;

        if (tableCheck.n >= 4 && configValid) {
          logger.info("Safe mode conditions cleared — resuming normal operation");
          safeMode = false;
          safeModeReason = null;
          statusWriter.setSafeMode(false, null);
          clearInterval(safeModeCheckInterval);
          const idx = activeIntervals.indexOf(safeModeCheckInterval);
          if (idx >= 0) activeIntervals.splice(idx, 1);

          // Start the polling intervals that were skipped
          startPollingIntervals();
        }
      } catch {
        // Still broken — stay in safe mode
      }
    }, 60_000);
    activeIntervals.push(safeModeCheckInterval);
  }

  // ─── Phase 3: Drain ────────────────────────────────────────────────────────

  async function shutdown(signal: string) {
    logger.info(`Shutting down (${signal})...`);

    // Stop all active intervals (polling, model rediscovery, safe mode re-check)
    for (const interval of activeIntervals) {
      clearInterval(interval);
    }
    activeIntervals.length = 0;

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
