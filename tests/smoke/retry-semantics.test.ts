/**
 * Smoke tests for retry semantics: linked runs, safety indicators,
 * and idempotency key protection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, RunStore } from "@jarvis/runtime";

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-retry-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

describe("Retry: creates linked run from failed original", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("retry creates new command with retry_of in payload", () => {
    const store = new RunStore(db);

    // Create an original run and fail it
    const originalRunId = store.startRun("test-agent", "manual");
    store.transition(originalRunId, "test-agent", "executing", "step_started");
    store.transition(originalRunId, "test-agent", "failed", "run_failed", {
      details: { error: "simulated failure" },
    });
    expect(store.getStatus(originalRunId)).toBe("failed");

    // Insert a retry command with retry_of (mimics what the dashboard API does)
    const retryCommandId = randomUUID();
    db.prepare(`
      INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key)
      VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?, 'dashboard', ?)
    `).run(
      retryCommandId,
      "test-agent",
      JSON.stringify({ retry_of: originalRunId }),
      new Date().toISOString(),
      `retry-${originalRunId}-${Date.now()}`,
    );

    // Verify command exists with correct payload
    const cmd = db.prepare("SELECT * FROM agent_commands WHERE command_id = ?").get(retryCommandId) as {
      command_id: string; payload_json: string; status: string;
    };
    expect(cmd).toBeTruthy();
    expect(cmd.status).toBe("queued");
    const payload = JSON.parse(cmd.payload_json);
    expect(payload.retry_of).toBe(originalRunId);
  });

  it("getRunByCommandId links retry run to command", () => {
    const store = new RunStore(db);

    // Create a run with a commandId (simulates orchestrator linking)
    const commandId = randomUUID();
    const runId = store.startRun("test-agent", "manual", commandId);

    // getRunByCommandId should find this run
    const found = store.getRunByCommandId(commandId);
    expect(found).not.toBeNull();
    expect(found!.run_id).toBe(runId);
    expect(found!.agent_id).toBe("test-agent");
    expect(found!.status).toBe("planning"); // startRun transitions to planning

    // Non-existent command_id returns null
    const notFound = store.getRunByCommandId("nonexistent-command-id");
    expect(notFound).toBeNull();
  });

  it("idempotency_key prevents duplicate retries", () => {
    const originalRunId = randomUUID();
    const idempotencyKey = `retry-${originalRunId}-fixed`;
    const now = new Date().toISOString();

    // Insert first retry command
    db.prepare(`
      INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key)
      VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?, 'dashboard', ?)
    `).run(randomUUID(), "test-agent", JSON.stringify({ retry_of: originalRunId }), now, idempotencyKey);

    // Insert second retry with same idempotency_key should throw
    expect(() =>
      db.prepare(`
        INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key)
        VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?, 'dashboard', ?)
      `).run(randomUUID(), "test-agent", JSON.stringify({ retry_of: originalRunId }), now, idempotencyKey),
    ).toThrow();

    // Verify only one command exists with that key
    const cmds = db.prepare(
      "SELECT * FROM agent_commands WHERE idempotency_key = ?",
    ).all(idempotencyKey) as Array<Record<string, unknown>>;
    expect(cmds.length).toBe(1);
  });

  it("retry_of event is emitted when orchestrator logs retry relationship", () => {
    const store = new RunStore(db);

    // Create a run then emit a retry_of event (mimics what orchestrator does)
    const retryRunId = store.startRun("test-agent", "manual", randomUUID());
    const originalRunId = randomUUID();

    store.emitEvent(retryRunId, "test-agent", "run_started", {
      details: { retry_of: originalRunId },
    });

    // Verify the event is recorded in the audit trail
    const events = store.getRunEvents(retryRunId);
    const retryEvent = events.find(
      e => e.event_type === "run_started" && e.payload_json && JSON.parse(e.payload_json).retry_of,
    );
    expect(retryEvent).toBeTruthy();
    expect(JSON.parse(retryEvent!.payload_json!).retry_of).toBe(originalRunId);
  });

  it("retry safety check detects outbound actions from step events", () => {
    const store = new RunStore(db);

    // Create a run with outbound step events
    const runId = store.startRun("bd-pipeline", "manual");
    store.transition(runId, "bd-pipeline", "executing", "step_started");

    // Emit step_completed events - one outbound (email.send), one read-only
    store.emitEvent(runId, "bd-pipeline", "step_completed", {
      step_no: 1, action: "crm.search",
    });
    store.emitEvent(runId, "bd-pipeline", "step_completed", {
      step_no: 2, action: "email.send",
    });

    store.transition(runId, "bd-pipeline", "failed", "run_failed", {
      details: { error: "step 3 failed" },
    });

    // Check for outbound actions (mimics what the API endpoint does)
    const outboundActions = ["email.send", "social.post", "crm.move_stage", "document.generate_report"];
    const completedSteps = db.prepare(
      "SELECT action FROM run_events WHERE run_id = ? AND event_type = 'step_completed' AND action IS NOT NULL",
    ).all(runId) as Array<{ action: string }>;

    const hadOutbound = completedSteps.some(s => outboundActions.includes(s.action));
    expect(hadOutbound).toBe(true);

    // A run with only read-only actions should be safe
    const safeRunId = store.startRun("evidence-auditor", "manual");
    store.transition(safeRunId, "evidence-auditor", "executing", "step_started");
    store.emitEvent(safeRunId, "evidence-auditor", "step_completed", {
      step_no: 1, action: "filesystem.scan",
    });
    store.transition(safeRunId, "evidence-auditor", "failed", "run_failed", {
      details: { error: "scan incomplete" },
    });

    const safeSteps = db.prepare(
      "SELECT action FROM run_events WHERE run_id = ? AND event_type = 'step_completed' AND action IS NOT NULL",
    ).all(safeRunId) as Array<{ action: string }>;
    const safeHadOutbound = safeSteps.some(s => outboundActions.includes(s.action));
    expect(safeHadOutbound).toBe(false);
  });
});
