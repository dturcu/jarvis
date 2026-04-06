/**
 * Cancel semantics tests for Jarvis orchestrator.
 *
 * Validates that external cancellation (via RunStore) is detected
 * both before and after step execution, that proper events are emitted,
 * and that cancelled runs cannot transition to completed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, RunStore } from "@jarvis/runtime";

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-cancel-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

describe("Cancel: orchestrator observes external cancellation", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
    store = new RunStore(db);
  });

  afterEach(() => cleanup(db, dbPath));

  it("pre-step check: cancelled run does not start next step", () => {
    // 1. Create a run and advance to executing
    const runId = store.startRun("test-agent", "manual", undefined, "Test cancel pre-step");
    store.transition(runId, "test-agent", "executing", "step_started", {
      step_no: 1, action: "web.search",
    });

    // 2. Cancel it via RunStore.transition (simulates external operator cancel)
    store.transition(runId, "test-agent", "cancelled", "run_cancelled", {
      details: { reason: "operator_cancel" },
    });

    // 3. Verify status is cancelled
    expect(store.getStatus(runId)).toBe("cancelled");

    // 4. Verify the state machine prevents transition to completed (would throw)
    expect(() =>
      store.transition(runId, "test-agent", "completed", "run_completed"),
    ).toThrow(/Invalid run transition.*cancelled.*completed/);
  });

  it("cancel during executing produces proper events", () => {
    // 1. Create a run, advance to executing
    const runId = store.startRun("test-agent", "manual", undefined, "Test cancel events");
    store.transition(runId, "test-agent", "executing", "step_started", {
      step_no: 1, action: "web.search",
    });
    store.emitEvent(runId, "test-agent", "step_completed", {
      step_no: 1, action: "web.search",
    });

    // 2. Cancel it
    store.transition(runId, "test-agent", "cancelled", "run_cancelled", {
      step_no: 1, action: "web.search",
      details: { reason: "operator_cancel", cancelled_after_step: 1 },
    });

    // 3. Verify run_events contain run_cancelled event
    const events = store.getRunEvents(runId);
    const cancelEvent = events.find(e => e.event_type === "run_cancelled");
    expect(cancelEvent).toBeTruthy();
    expect(cancelEvent!.agent_id).toBe("test-agent");

    const payload = JSON.parse(cancelEvent!.payload_json!);
    expect(payload.reason).toBe("operator_cancel");
    expect(payload.cancelled_after_step).toBe(1);

    // 4. Verify the run record reflects cancellation
    const run = store.getRun(runId);
    expect(run).toBeTruthy();
    expect(run!.status).toBe("cancelled");
    expect(run!.completed_at).toBeTruthy();
  });

  it("cancelled run cannot later transition to completed", () => {
    // 1. Create a run, cancel it
    const runId = store.startRun("test-agent", "manual", undefined, "Test terminal cancel");
    store.transition(runId, "test-agent", "executing", "step_started");
    store.transition(runId, "test-agent", "cancelled", "run_cancelled", {
      details: { reason: "operator_cancel" },
    });

    // 2. Attempt RunStore.transition to completed — expect throw
    expect(() =>
      store.transition(runId, "test-agent", "completed", "run_completed"),
    ).toThrow(/Invalid run transition/);

    // 3. Also verify cannot transition to executing or failed
    expect(() =>
      store.transition(runId, "test-agent", "executing", "step_started"),
    ).toThrow(/Invalid run transition/);

    expect(() =>
      store.transition(runId, "test-agent", "failed", "run_failed"),
    ).toThrow(/Invalid run transition/);

    // 4. Status should remain cancelled
    expect(store.getStatus(runId)).toBe("cancelled");
  });

  it("cancel from awaiting_approval state produces proper transition", () => {
    // 1. Create a run, advance to awaiting_approval
    const runId = store.startRun("test-agent", "manual", undefined, "Test cancel from approval");
    store.transition(runId, "test-agent", "executing", "step_started", {
      step_no: 1, action: "email.send",
    });
    store.transition(runId, "test-agent", "awaiting_approval", "approval_requested", {
      step_no: 1, action: "email.send",
      details: { severity: "critical" },
    });

    // 2. Cancel from awaiting_approval
    store.transition(runId, "test-agent", "cancelled", "run_cancelled", {
      details: { reason: "operator_cancel" },
    });

    // 3. Verify terminal
    expect(store.getStatus(runId)).toBe("cancelled");
    expect(() =>
      store.transition(runId, "test-agent", "executing", "step_started"),
    ).toThrow(/Invalid run transition/);
  });

  it("getStatus returns cancelled for externally cancelled run", () => {
    // This simulates what the orchestrator's post-step check does:
    // read status from DB after step execution to detect external cancellation
    const runId = store.startRun("test-agent", "manual", undefined, "Test getStatus cancel");
    store.transition(runId, "test-agent", "executing", "step_started");

    // Simulate external cancellation (e.g., operator sets status directly)
    store.transition(runId, "test-agent", "cancelled", "run_cancelled", {
      details: { reason: "operator_cancel" },
    });

    // The orchestrator's post-step check reads status — should see cancelled
    const status = store.getStatus(runId);
    expect(status).toBe("cancelled");
  });

  it("event trail captures full cancel lifecycle", () => {
    const runId = store.startRun("test-agent", "manual", undefined, "Test event trail");
    store.transition(runId, "test-agent", "executing", "step_started", {
      step_no: 1, action: "web.search",
    });
    store.emitEvent(runId, "test-agent", "step_completed", {
      step_no: 1, action: "web.search",
    });
    store.transition(runId, "test-agent", "cancelled", "run_cancelled", {
      step_no: 1, action: "web.search",
      details: { reason: "operator_cancel", cancelled_after_step: 1 },
    });

    const events = store.getRunEvents(runId);
    const eventTypes = events.map(e => e.event_type);

    expect(eventTypes).toEqual([
      "run_started",      // from startRun
      "step_started",     // transition to executing
      "step_completed",   // emitEvent
      "run_cancelled",    // transition to cancelled
    ]);
  });

  it("completeCommand accepts 'cancelled' status", () => {
    // 1. Insert a command into agent_commands
    const commandId = `cmd-cancel-test-${Date.now()}`;
    db.prepare(`
      INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at)
      VALUES (?, 'run_agent', 'test-agent', 'claimed', 0, ?)
    `).run(commandId, new Date().toISOString());

    // 2. Start a run linked to that command
    const runId = store.startRun("test-agent", "manual", commandId, "Test completeCommand cancelled");
    store.transition(runId, "test-agent", "executing", "step_started", {
      step_no: 1, action: "web.search",
    });

    // 3. Cancel the run
    store.transition(runId, "test-agent", "cancelled", "run_cancelled", {
      details: { reason: "operator_cancel" },
    });

    // 4. Call completeCommand with 'cancelled' — this should not throw
    store.completeCommand(runId, "cancelled");

    // 5. Verify command status is 'cancelled'
    const cmd = db.prepare("SELECT status, completed_at FROM agent_commands WHERE command_id = ?").get(commandId) as {
      status: string; completed_at: string | null;
    };
    expect(cmd.status).toBe("cancelled");
    expect(cmd.completed_at).toBeTruthy();
  });
});
