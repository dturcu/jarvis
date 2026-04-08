/**
 * Smoke tests for the Jarvis runtime lifecycle.
 *
 * These tests exercise the core control plane: database init, migration,
 * health checks, config validation, run store, approval bridge, and
 * daemon heartbeat — all against temp SQLite databases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, RunStore, validateConfig, type JarvisRuntimeConfig } from "@jarvis/runtime";
import { requestApproval, resolveApproval, listApprovals } from "@jarvis/runtime";
import { StatusWriter } from "@jarvis/runtime";
import { Logger } from "@jarvis/runtime";

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return { db, path: dbPath };
}

function cleanup(db: DatabaseSync, dbPath: string) {
  try { db.close(); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
}

describe("Smoke: Database Lifecycle", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("creates all 19 runtime tables", () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'",
    ).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name).sort();
    expect(names).toEqual([
      "agent_commands", "agent_memory", "approvals", "artifact_deliveries",
      "audit_log", "canonical_aliases", "channel_messages", "channel_threads",
      "daemon_heartbeats", "decision_entity_links", "delivery_attempts",
      "model_benchmarks", "model_registry",
      "notifications", "plugin_installs", "run_events",
      "runs", "schedules", "settings",
    ]);
  });

  it("migration is idempotent", () => {
    runMigrations(db); // second time
    runMigrations(db); // third time
    const rows = db.prepare("SELECT COUNT(*) as n FROM schema_migrations").get() as { n: number };
    expect(rows.n).toBe(8);
  });
});

describe("Smoke: Run Store", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("tracks a run through its lifecycle", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");

    // startRun transitions: queued -> planning
    expect(store.getStatus(runId)).toBe("planning");

    store.transition(runId, "test-agent", "executing", "step_started");
    expect(store.getStatus(runId)).toBe("executing");

    store.transition(runId, "test-agent", "completed", "run_completed");
    expect(store.getStatus(runId)).toBe("completed");
  });

  it("records events for replay", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");
    store.emitEvent(runId, "test-agent", "step_started", { step_no: 1, action: "test.action" });
    store.emitEvent(runId, "test-agent", "step_completed", { step_no: 1, action: "test.action" });

    const events = store.getRunEvents(runId);
    expect(events.length).toBeGreaterThanOrEqual(3); // run_started + 2 manual
    expect(events.some(e => e.event_type === "step_started")).toBe(true);
    expect(events.some(e => e.event_type === "step_completed")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");
    // startRun transitions to planning; go to executing then completed
    store.transition(runId, "test-agent", "executing", "step_started");
    store.transition(runId, "test-agent", "completed", "run_completed");

    // completed -> executing is not allowed
    expect(() =>
      store.transition(runId, "test-agent", "executing", "step_started"),
    ).toThrow();
  });
});

describe("Smoke: Approval Bridge", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("creates, lists, and resolves approvals", () => {
    const approvalId = requestApproval(db, {
      agent_id: "test-agent",
      run_id: "run-1",
      action: "email.send",
      severity: "critical",
      payload: "Send email to client",
    });

    expect(approvalId).toBeTruthy();

    const pending = listApprovals(db, "pending");
    expect(pending.length).toBe(1);
    expect(pending[0].action).toBe("email.send");

    resolveApproval(db, approvalId, "approved", "admin", "Looks good");

    const afterResolve = listApprovals(db, "pending");
    expect(afterResolve.length).toBe(0);

    const all = listApprovals(db);
    expect(all.length).toBe(1);
    expect(all[0].status).toBe("approved");
  });
});

describe("Smoke: Daemon Heartbeat", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("writes and reads heartbeat data", () => {
    const logger = new Logger("warn", { logToFile: false, alertOnError: false });
    const writer = new StatusWriter(5, 3, logger, db);

    // Manual flush
    (writer as unknown as { flush: () => void }).flush();

    const row = db.prepare(
      "SELECT pid, status, details_json FROM daemon_heartbeats LIMIT 1",
    ).get() as { pid: number; status: string; details_json: string } | undefined;

    expect(row).toBeTruthy();
    expect(row!.pid).toBe(process.pid);
    expect(row!.status).toBe("idle");

    const details = JSON.parse(row!.details_json);
    expect(details.agents_registered).toBe(5);
    expect(details.schedules_active).toBe(3);
  });
});

describe("Smoke: Config Validation", () => {
  it("validates a correct config", () => {
    const config: JarvisRuntimeConfig = {
      lmstudio_url: "http://localhost:1234",
      default_model: "auto",
      adapter_mode: "mock",
      poll_interval_ms: 60000,
      trigger_poll_ms: 10000,
      max_concurrent: 2,
      log_level: "info",
      appliance_mode: false,
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid poll interval", () => {
    const config = {
      lmstudio_url: "http://localhost:1234",
      default_model: "auto",
      adapter_mode: "mock",
      poll_interval_ms: 100, // too low
      trigger_poll_ms: 10000,
      max_concurrent: 2,
      log_level: "info",
    } as unknown as JarvisRuntimeConfig;

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("Smoke: Agent Commands", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("inserts, claims, and completes commands", () => {
    const id = "cmd-" + Date.now();
    db.prepare(
      "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by) VALUES (?, ?, ?, 'queued', 0, ?, ?)",
    ).run(id, "run_agent", "test-agent", new Date().toISOString(), "test");

    // Read queued
    const queued = db.prepare("SELECT * FROM agent_commands WHERE status='queued'").all();
    expect(queued.length).toBe(1);

    // Claim
    db.prepare("UPDATE agent_commands SET status='claimed', claimed_at=? WHERE command_id=?").run(new Date().toISOString(), id);

    // Complete
    db.prepare("UPDATE agent_commands SET status='completed', completed_at=? WHERE command_id=?").run(new Date().toISOString(), id);

    const final = db.prepare("SELECT status FROM agent_commands WHERE command_id=?").get(id) as { status: string };
    expect(final.status).toBe("completed");
  });

  it("enforces idempotency key uniqueness", () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
    ).run("cmd-1", "run_agent", "agent-a", now, "test", "unique-key-1");

    expect(() =>
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
      ).run("cmd-2", "run_agent", "agent-a", now, "test", "unique-key-1"),
    ).toThrow();
  });
});

describe("Smoke: Notifications", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("inserts and reads notifications", () => {
    db.prepare(
      "INSERT INTO notifications (notification_id, channel, kind, payload_json, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    ).run("notif-1", "telegram", "agent_complete", JSON.stringify({ message: "Test done" }), new Date().toISOString());

    const pending = db.prepare("SELECT * FROM notifications WHERE status='pending'").all();
    expect(pending.length).toBe(1);
  });
});

describe("Smoke: Logger", () => {
  it("creates child loggers with context", () => {
    const logger = new Logger("debug", { logToFile: false, alertOnError: false });
    const child = logger.withContext({ run_id: "r1", agent_id: "test" });
    const grandchild = child.withContext({ step_no: 3, action: "email.send" });

    // Should not throw
    grandchild.info("test message", { extra: "data" });
    grandchild.debug("debug");
    grandchild.warn("warning");
  });
});
