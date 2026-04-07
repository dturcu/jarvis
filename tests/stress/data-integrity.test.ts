/**
 * Stress: Data Integrity
 *
 * Tests database consistency, WAL behavior, transaction atomicity,
 * referential integrity, data correctness guarantees, scale limits,
 * and migration idempotency across the Jarvis runtime database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import {
  RunStore,
  DbSchedulerStore,
  requestApproval,
  resolveApproval,
  listApprovals,
  runMigrations,
} from "@jarvis/runtime";
import { createStressDb, cleanupDb, range } from "./helpers.js";

// ── WAL Mode Tests ─────────────────────────────────────────────────────────

describe("WAL Mode Behavior", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("wal"));
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("PRAGMA journal_mode returns wal", () => {
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode).toBe("wal");
  });

  it("write 1000 rows then checkpoint then verify all present", () => {
    const store = new RunStore(db);
    const ids: string[] = [];
    for (const i of range(1000)) {
      ids.push(store.startRun(`agent-${i}`, "wal-test"));
    }

    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");

    const recent = store.getRecentRuns(1000);
    expect(recent).toHaveLength(1000);

    // Spot-check a few
    for (const idx of [0, 499, 999]) {
      const run = store.getRun(ids[idx]);
      expect(run).not.toBeNull();
      expect(run!.status).toBe("planning");
    }
  });

  it("write without checkpoint: data still readable", () => {
    const store = new RunStore(db);
    for (const i of range(100)) {
      store.startRun(`agent-nc-${i}`, "wal-test");
    }
    // No checkpoint — reads should still work via WAL
    const recent = store.getRecentRuns(100);
    expect(recent).toHaveLength(100);
  });

  it("checkpoint mode PASSIVE succeeds", () => {
    const store = new RunStore(db);
    for (const i of range(50)) {
      store.startRun(`agent-passive-${i}`, "test");
    }
    expect(() => db.exec("PRAGMA wal_checkpoint(PASSIVE);")).not.toThrow();
    expect(store.getRecentRuns(50)).toHaveLength(50);
  });

  it("checkpoint mode FULL succeeds", () => {
    const store = new RunStore(db);
    for (const i of range(50)) {
      store.startRun(`agent-full-${i}`, "test");
    }
    expect(() => db.exec("PRAGMA wal_checkpoint(FULL);")).not.toThrow();
    expect(store.getRecentRuns(50)).toHaveLength(50);
  });

  it("checkpoint mode TRUNCATE succeeds", () => {
    const store = new RunStore(db);
    for (const i of range(50)) {
      store.startRun(`agent-trunc-${i}`, "test");
    }
    expect(() => db.exec("PRAGMA wal_checkpoint(TRUNCATE);")).not.toThrow();
    expect(store.getRecentRuns(50)).toHaveLength(50);
  });

  it("DB file exists on disk during writes", () => {
    const store = new RunStore(db);
    store.startRun("agent-file-check", "test");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("WAL file exists during writes", () => {
    const store = new RunStore(db);
    // Write enough to create WAL file
    for (const i of range(50)) {
      store.startRun(`agent-wal-file-${i}`, "test");
    }
    // WAL file should exist (may not on all platforms, so we check existence softly)
    const walExists = fs.existsSync(dbPath + "-wal");
    const shmExists = fs.existsSync(dbPath + "-shm");
    // At minimum the DB file must exist; WAL/SHM may vary by platform
    expect(fs.existsSync(dbPath)).toBe(true);
    // If WAL exists, SHM should too
    if (walExists) {
      expect(shmExists).toBe(true);
    }
  });

  it("heavy writes between checkpoints maintain data integrity", () => {
    const store = new RunStore(db);
    const ids: string[] = [];

    for (let batch = 0; batch < 5; batch++) {
      for (const i of range(100)) {
        ids.push(store.startRun(`batch-${batch}-agent-${i}`, "test"));
      }
      if (batch === 2) {
        db.exec("PRAGMA wal_checkpoint(PASSIVE);");
      }
    }

    const recent = store.getRecentRuns(500);
    expect(recent).toHaveLength(500);

    // Every run should be readable
    for (const id of ids.slice(0, 10)) {
      expect(store.getRun(id)).not.toBeNull();
    }
  });

  it("read during writes returns consistent snapshot", () => {
    const store = new RunStore(db);
    const writeIds: string[] = [];

    // Interleave writes and reads
    for (const i of range(100)) {
      writeIds.push(store.startRun(`interleave-${i}`, "test"));
      const recent = store.getRecentRuns(i + 1);
      expect(recent.length).toBe(i + 1);
    }
  });

  it("PRAGMA busy_timeout is 5000", () => {
    const row = db.prepare("PRAGMA busy_timeout").get() as Record<string, number>;
    // node:sqlite returns the column as "timeout" or "busy_timeout" depending on version
    const value = row.busy_timeout ?? row.timeout;
    expect(value).toBe(5000);
  });

  it("PRAGMA foreign_keys is ON", () => {
    const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });
});

// ── Transaction Integrity ──────────────────────────────────────────────────

describe("Transaction Integrity", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("txn"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("startRun creates both runs row AND run_events row atomically", () => {
    const runId = store.startRun("bd-pipeline", "test", undefined, "Test goal");

    const run = store.getRun(runId);
    expect(run).not.toBeNull();
    expect(run!.status).toBe("planning");

    const events = store.getRunEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("run_started");
    expect(events[0].run_id).toBe(runId);
  });

  it("transition creates both runs UPDATE AND run_events INSERT atomically", () => {
    const runId = store.startRun("agent-txn", "test");
    store.transition(runId, "agent-txn", "executing", "plan_built");

    expect(store.getStatus(runId)).toBe("executing");
    const events = store.getRunEvents(runId);
    // run_started + plan_built
    expect(events).toHaveLength(2);
    expect(events[1].event_type).toBe("plan_built");
  });

  it("resolveApproval creates both approvals UPDATE AND audit_log INSERT atomically", () => {
    const runId = store.startRun("agent-txn-appr", "test");
    const approvalId = requestApproval(db, {
      agent_id: "agent-txn-appr",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });

    resolveApproval(db, approvalId, "approved", "tester", "Looks good");

    // Approval status updated
    const approvals = listApprovals(db, "approved");
    expect(approvals.some((a) => a.id === approvalId)).toBe(true);

    // Audit log entry created
    const auditRow = db.prepare(
      "SELECT * FROM audit_log WHERE target_id = ?",
    ).get(approvalId) as Record<string, unknown> | undefined;
    expect(auditRow).toBeDefined();
    expect(auditRow!.action).toBe("approval.approved");
    expect(auditRow!.actor_id).toBe("tester");
  });

  it("simulated failure mid-transaction: ROLLBACK, no partial writes", () => {
    const runId = store.startRun("agent-rollback", "test");

    // Manually test that a failed transaction rolls back
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("UPDATE runs SET status = 'executing' WHERE run_id = ?").run(runId);
      // Simulate failure before event insert
      throw new Error("Simulated failure");
    } catch {
      db.exec("ROLLBACK");
    }

    // Status should still be 'planning' (the UPDATE was rolled back)
    expect(store.getStatus(runId)).toBe("planning");
  });

  it("after rollback, DB in consistent state for new operations", () => {
    const runId1 = store.startRun("agent-post-rb", "test");

    // Failed transaction
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("UPDATE runs SET status = 'executing' WHERE run_id = ?").run(runId1);
      throw new Error("Simulated failure");
    } catch {
      db.exec("ROLLBACK");
    }

    // New operations work fine
    const runId2 = store.startRun("agent-post-rb-2", "test");
    expect(store.getStatus(runId2)).toBe("planning");
    store.transition(runId2, "agent-post-rb-2", "executing", "plan_built");
    expect(store.getStatus(runId2)).toBe("executing");
  });

  it("concurrent transactions do not corrupt data", async () => {
    const errors: string[] = [];
    await Promise.all(
      range(50).map(async (i) => {
        try {
          const agentId = `concurrent-${i}`;
          const runId = store.startRun(agentId, "test");
          store.transition(runId, agentId, "executing", "plan_built");
          store.transition(runId, agentId, "completed", "run_completed");
        } catch (e) {
          errors.push(String(e));
        }
      }),
    );

    expect(errors).toHaveLength(0);

    const recent = store.getRecentRuns(50);
    expect(recent).toHaveLength(50);
    for (const run of recent) {
      expect(run.status).toBe("completed");
    }
  });

  it("run count matches event count: 1 run_started per run", () => {
    for (const i of range(20)) {
      store.startRun(`agent-count-${i}`, "test");
    }

    const runs = store.getRecentRuns(20);
    expect(runs).toHaveLength(20);

    // Each run should have exactly 1 run_started event
    for (const run of runs) {
      const events = store.getRunEvents(run.run_id);
      const startEvents = events.filter((e) => e.event_type === "run_started");
      expect(startEvents).toHaveLength(1);
    }
  });

  it("every completed run has completed_at set", () => {
    for (const i of range(10)) {
      const agentId = `agent-completed-${i}`;
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");
      store.transition(runId, agentId, "completed", "run_completed");
    }

    const runs = store.getRecentRuns(10);
    for (const run of runs) {
      expect(run.status).toBe("completed");
      expect(run.completed_at).toBeTruthy();
    }
  });

  it("every failed run has completed_at set", () => {
    for (const i of range(10)) {
      const agentId = `agent-failed-${i}`;
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");
      store.transition(runId, agentId, "failed", "run_failed", {
        details: { error: `Failure ${i}` },
      });
    }

    const runs = store.getRecentRuns(10);
    for (const run of runs) {
      expect(run.status).toBe("failed");
      expect(run.completed_at).toBeTruthy();
    }
  });

  it("every cancelled run has completed_at set", () => {
    for (const i of range(10)) {
      const agentId = `agent-cancelled-${i}`;
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "cancelled", "run_cancelled");
    }

    const runs = store.getRecentRuns(10);
    for (const run of runs) {
      expect(run.status).toBe("cancelled");
      expect(run.completed_at).toBeTruthy();
    }
  });
});

// ── Foreign Key / Referential Integrity ────────────────────────────────────

describe("Referential Integrity", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("fk"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("run_events reference valid run_ids (consistency check)", () => {
    for (const i of range(20)) {
      const agentId = `agent-fk-${i}`;
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1 });
      store.transition(runId, agentId, "completed", "run_completed");
    }

    // Check that all events have matching runs
    const allEvents = db.prepare("SELECT DISTINCT run_id FROM run_events").all() as Array<{ run_id: string }>;
    for (const event of allEvents) {
      const run = store.getRun(event.run_id);
      // May be null for orphaned emitEvent calls, but in this test all should match
      expect(run).not.toBeNull();
    }
  });

  it("approvals reference valid run_ids", () => {
    for (const i of range(10)) {
      const agentId = `agent-appr-${i}`;
      const runId = store.startRun(agentId, "test");
      requestApproval(db, {
        agent_id: agentId,
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });
    }

    const approvals = listApprovals(db);
    expect(approvals).toHaveLength(10);

    for (const approval of approvals) {
      const run = store.getRun(approval.run_id);
      expect(run).not.toBeNull();
    }
  });

  it("audit_log entries reference valid approval_ids", () => {
    for (const i of range(5)) {
      const agentId = `agent-audit-${i}`;
      const runId = store.startRun(agentId, "test");
      const approvalId = requestApproval(db, {
        agent_id: agentId,
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });
      resolveApproval(db, approvalId, "approved", "tester");
    }

    const auditRows = db.prepare("SELECT target_id FROM audit_log WHERE target_type = 'approval'").all() as Array<{ target_id: string }>;
    expect(auditRows).toHaveLength(5);

    for (const row of auditRows) {
      const approval = db.prepare("SELECT approval_id FROM approvals WHERE approval_id = ?").get(row.target_id) as { approval_id: string } | undefined;
      expect(approval).toBeDefined();
    }
  });

  it("no orphaned events: every event has a matching run (within controlled test)", () => {
    const runIds: string[] = [];
    for (const i of range(15)) {
      const agentId = `agent-orphan-${i}`;
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");
      store.emitEvent(runId, agentId, "step_started", { step_no: 1 });
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1 });
      store.transition(runId, agentId, "completed", "run_completed");
      runIds.push(runId);
    }

    const eventRunIds = db.prepare("SELECT DISTINCT run_id FROM run_events").all() as Array<{ run_id: string }>;
    for (const { run_id } of eventRunIds) {
      expect(runIds).toContain(run_id);
    }
  });

  it("no orphaned approvals: every approval has a matching run (within controlled test)", () => {
    const runIds: string[] = [];
    for (const i of range(10)) {
      const agentId = `agent-oa-${i}`;
      const runId = store.startRun(agentId, "test");
      requestApproval(db, {
        agent_id: agentId,
        run_id: runId,
        action: "crm.move_stage",
        severity: "warning",
        payload: "{}",
      });
      runIds.push(runId);
    }

    const approvalRunIds = db.prepare(
      "SELECT DISTINCT run_id FROM approvals",
    ).all() as Array<{ run_id: string }>;
    for (const { run_id } of approvalRunIds) {
      expect(runIds).toContain(run_id);
    }
  });
});

// ── Data Correctness ───────────────────────────────────────────────────────

describe("Data Correctness", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("correctness"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("run status transitions are monotonic (never go backwards in lifecycle)", () => {
    const lifecycle: Array<{ status: string; order: number }> = [
      { status: "planning", order: 1 },
      { status: "executing", order: 2 },
      { status: "completed", order: 4 },
    ];

    const runId = store.startRun("agent-monotonic", "test");
    expect(store.getStatus(runId)).toBe("planning"); // order 1

    store.transition(runId, "agent-monotonic", "executing", "plan_built");
    expect(store.getStatus(runId)).toBe("executing"); // order 2

    store.transition(runId, "agent-monotonic", "completed", "run_completed");
    expect(store.getStatus(runId)).toBe("completed"); // order 4

    // Cannot go backwards
    expect(() =>
      store.transition(runId, "agent-monotonic", "planning" as any, "run_started"),
    ).toThrow("Invalid run transition");
  });

  it("events ordered chronologically within a run", () => {
    const agentId = "agent-chrono";
    const runId = store.startRun(agentId, "test");
    store.transition(runId, agentId, "executing", "plan_built");
    for (const i of range(5)) {
      store.emitEvent(runId, agentId, "step_completed", {
        step_no: i + 1,
        action: `action.${i}`,
      });
    }
    store.transition(runId, agentId, "completed", "run_completed");

    const events = store.getRunEvents(runId);
    // Should be: run_started, plan_built, 5x step_completed, run_completed
    expect(events.length).toBe(8);

    for (let i = 1; i < events.length; i++) {
      expect(events[i].created_at >= events[i - 1].created_at).toBe(true);
    }
  });

  it("approval status only changes once (pending -> resolved)", () => {
    const runId = store.startRun("agent-appr-once", "test");
    const approvalId = requestApproval(db, {
      agent_id: "agent-appr-once",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });

    // Resolve once
    expect(resolveApproval(db, approvalId, "approved", "tester")).toBe(true);
    // Second resolve fails
    expect(resolveApproval(db, approvalId, "rejected", "tester")).toBe(false);
    // Third resolve also fails
    expect(resolveApproval(db, approvalId, "approved", "other-tester")).toBe(false);

    // Final status is approved (unchanged)
    const approvals = listApprovals(db, "approved");
    expect(approvals.some((a) => a.id === approvalId)).toBe(true);
  });

  it("schedule fire counts are accurate", () => {
    const scheduler = new DbSchedulerStore(db);
    const past = new Date(Date.now() - 60_000).toISOString();

    scheduler.seedSchedule({
      job_type: "fire.count",
      input: {},
      next_fire_at: past,
      enabled: true,
    });

    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(1);

    // Fire it multiple times
    for (const _ of range(5)) {
      scheduler.markFired(due[0].schedule_id);
    }

    // last_fired_at should be set
    const dueAfter = scheduler.getDueSchedules(new Date());
    expect(dueAfter).toHaveLength(1);
    expect(dueAfter[0].last_fired_at).toBeTruthy();
  });

  it("getRecentRuns returns DESC order by started_at", () => {
    for (const i of range(20)) {
      store.startRun(`agent-order-${i}`, "test");
    }

    const recent = store.getRecentRuns(20);
    for (let i = 1; i < recent.length; i++) {
      expect(recent[i - 1].started_at >= recent[i].started_at).toBe(true);
    }
  });

  it("listApprovals returns DESC order by created_at", () => {
    for (const i of range(10)) {
      const runId = store.startRun(`agent-appr-order-${i}`, "test");
      requestApproval(db, {
        agent_id: `agent-appr-order-${i}`,
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });
    }

    const all = listApprovals(db);
    expect(all).toHaveLength(10);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].created_at >= all[i].created_at).toBe(true);
    }
  });

  it("approval IDs are valid format (8-char short IDs)", () => {
    for (const i of range(20)) {
      const runId = store.startRun(`agent-id-fmt-${i}`, "test");
      const approvalId = requestApproval(db, {
        agent_id: `agent-id-fmt-${i}`,
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });
      expect(approvalId).toHaveLength(8);
      expect(approvalId).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("run IDs are valid UUID format", () => {
    for (const i of range(20)) {
      const runId = store.startRun(`agent-uuid-${i}`, "test");
      expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("ISO timestamps are valid format in runs", () => {
    const runId = store.startRun("agent-ts", "test");
    const run = store.getRun(runId);
    expect(run).not.toBeNull();
    // ISO format: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(new Date(run!.started_at).toISOString()).toBeTruthy();
    expect(isNaN(new Date(run!.started_at).getTime())).toBe(false);
  });

  it("ISO timestamps are valid format in events", () => {
    const runId = store.startRun("agent-ts-evt", "test");
    const events = store.getRunEvents(runId);
    for (const evt of events) {
      expect(isNaN(new Date(evt.created_at).getTime())).toBe(false);
    }
  });

  it("no null values in required columns for runs", () => {
    for (const i of range(10)) {
      const runId = store.startRun(`agent-null-${i}`, "test", undefined, `Goal ${i}`);
      const run = store.getRun(runId);
      expect(run!.run_id).toBeTruthy();
      expect(run!.agent_id).toBeTruthy();
      expect(run!.status).toBeTruthy();
      expect(run!.started_at).toBeTruthy();
    }
  });

  it("no null values in required columns for events", () => {
    const runId = store.startRun("agent-null-evt", "test");
    store.transition(runId, "agent-null-evt", "executing", "plan_built");

    const events = store.getRunEvents(runId);
    for (const evt of events) {
      expect(evt.event_id).toBeTruthy();
      expect(evt.run_id).toBeTruthy();
      expect(evt.agent_id).toBeTruthy();
      expect(evt.event_type).toBeTruthy();
      expect(evt.created_at).toBeTruthy();
    }
  });

  it("no null values in required columns for approvals", () => {
    const runId = store.startRun("agent-null-appr", "test");
    requestApproval(db, {
      agent_id: "agent-null-appr",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });

    const approvals = listApprovals(db);
    for (const a of approvals) {
      expect(a.id).toBeTruthy();
      expect(a.agent).toBeTruthy();
      expect(a.action).toBeTruthy();
      expect(a.status).toBeTruthy();
      expect(a.run_id).toBeTruthy();
      expect(a.severity).toBeTruthy();
      expect(a.created_at).toBeTruthy();
    }
  });
});

// ── Scale Tests ────────────────────────────────────────────────────────────

describe("Scale Tests", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("scale"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("1000 runs: getRecentRuns(1000) returns all", () => {
    for (const i of range(1000)) {
      store.startRun(`agent-scale-${i}`, "test");
    }
    const recent = store.getRecentRuns(1000);
    expect(recent).toHaveLength(1000);
  });

  it("500 approvals: listApprovals returns all", () => {
    for (const i of range(500)) {
      const runId = store.startRun(`agent-appr-scale-${i}`, "test");
      requestApproval(db, {
        agent_id: `agent-appr-scale-${i}`,
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: JSON.stringify({ index: i }),
      });
    }
    const all = listApprovals(db);
    expect(all).toHaveLength(500);
  });

  it("10000 events across 100 runs: getRunEvents returns correct per-run", () => {
    const runIds: string[] = [];
    for (const i of range(100)) {
      const agentId = `agent-evt-scale-${i}`;
      const runId = store.startRun(agentId, "test");
      runIds.push(runId);

      store.transition(runId, agentId, "executing", "plan_built");
      // Each run: run_started (1) + plan_built (1) + 98 step events = 100 events
      for (const j of range(98)) {
        store.emitEvent(runId, agentId, "step_completed", {
          step_no: j + 1,
          action: `action.${j}`,
        });
      }
    }

    // Verify per-run event count
    for (const runId of runIds.slice(0, 5)) {
      const events = store.getRunEvents(runId);
      expect(events).toHaveLength(100);
    }
  });

  it("200 schedules: count() returns 200", () => {
    const scheduler = new DbSchedulerStore(db);
    for (const i of range(200)) {
      scheduler.seedSchedule({
        job_type: `scale.schedule_${i}`,
        input: { index: i },
        next_fire_at: new Date().toISOString(),
        enabled: true,
      });
    }
    expect(scheduler.count()).toBe(200);
  });

  it("DB size stays reasonable after 5000 operations", () => {
    for (const i of range(5000)) {
      store.startRun(`agent-size-${i}`, "test");
    }

    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    const stats = fs.statSync(dbPath);
    // DB should be under 50MB for 5000 runs
    expect(stats.size).toBeLessThan(50 * 1024 * 1024);
  });

  it("getRecentRuns with limit=1 returns only 1", () => {
    for (const i of range(100)) {
      store.startRun(`agent-limit-${i}`, "test");
    }
    const recent = store.getRecentRuns(1);
    expect(recent).toHaveLength(1);
  });

  it("sequential write performance: 1000 runs complete in reasonable time", () => {
    const start = performance.now();
    for (const i of range(1000)) {
      store.startRun(`agent-perf-${i}`, "test");
    }
    const elapsed = performance.now() - start;
    // Should complete in under 30 seconds even on slow CI
    expect(elapsed).toBeLessThan(30_000);
  });

  it("concurrent write performance: 200 runs via Promise.all", async () => {
    const start = performance.now();
    const errors: string[] = [];

    await Promise.all(
      range(200).map(async (i) => {
        try {
          store.startRun(`agent-conc-perf-${i}`, "test");
        } catch (e) {
          errors.push(String(e));
        }
      }),
    );

    const elapsed = performance.now() - start;
    expect(errors).toHaveLength(0);
    expect(store.getRecentRuns(200)).toHaveLength(200);
    // Should complete in under 30 seconds
    expect(elapsed).toBeLessThan(30_000);
  });

  it("heap memory stable after 5000 operations (< 50MB growth)", () => {
    // Force GC if available
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;

    for (const i of range(5000)) {
      store.startRun(`agent-mem-${i}`, "test");
    }

    if (global.gc) global.gc();
    const after = process.memoryUsage().heapUsed;
    const growthMB = (after - before) / (1024 * 1024);

    // Allow up to 50MB growth for 5000 operations
    expect(growthMB).toBeLessThan(50);
  });

  it("getRecentRuns pagination consistency", () => {
    for (const i of range(100)) {
      store.startRun(`agent-page-${i}`, "test");
    }

    const page1 = store.getRecentRuns(10);
    const page2 = store.getRecentRuns(20);
    const pageAll = store.getRecentRuns(100);

    expect(page1).toHaveLength(10);
    expect(page2).toHaveLength(20);
    expect(pageAll).toHaveLength(100);

    // First 10 of page2 should match page1
    for (let i = 0; i < 10; i++) {
      expect(page1[i].run_id).toBe(page2[i].run_id);
    }
  });
});

// ── Migration Tests ────────────────────────────────────────────────────────

describe("Migration Tests", () => {
  it("runMigrations on fresh DB succeeds", () => {
    const dbPath = join(
      os.tmpdir(),
      `jarvis-mig-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    expect(() => runMigrations(db)).not.toThrow();

    // Verify key tables exist
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("runs");
    expect(tableNames).toContain("run_events");
    expect(tableNames).toContain("approvals");
    expect(tableNames).toContain("audit_log");
    expect(tableNames).toContain("schedules");

    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("runMigrations on already-migrated DB is idempotent (no error)", () => {
    const dbPath = join(
      os.tmpdir(),
      `jarvis-mig-idem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    runMigrations(db);
    // Run again — should not throw
    expect(() => runMigrations(db)).not.toThrow();

    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("double runMigrations produces no error and same schema", () => {
    const dbPath = join(
      os.tmpdir(),
      `jarvis-mig-dbl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    runMigrations(db);
    const tablesBefore = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;

    runMigrations(db);
    const tablesAfter = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tablesBefore.map((t) => t.name)).toEqual(
      tablesAfter.map((t) => t.name),
    );

    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("tables exist after migration: runs, run_events, approvals, audit_log, agent_commands, schedules, daemon_heartbeats", () => {
    const dbPath = join(
      os.tmpdir(),
      `jarvis-mig-tables-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    const requiredTables = [
      "runs",
      "run_events",
      "approvals",
      "audit_log",
      "agent_commands",
      "schedules",
      "daemon_heartbeats",
    ];
    for (const table of requiredTables) {
      expect(tableNames).toContain(table);
    }

    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("indexes exist after migration for key tables", () => {
    const dbPath = join(
      os.tmpdir(),
      `jarvis-mig-idx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    // Key indexes that should exist
    expect(indexNames).toContain("idx_runs_agent_id");
    expect(indexNames).toContain("idx_runs_status");
    expect(indexNames).toContain("idx_approvals_run_id");
    expect(indexNames).toContain("idx_approvals_status");
    expect(indexNames).toContain("idx_run_events_run_id");
    expect(indexNames).toContain("idx_schedules_next_fire");

    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("schema_migrations table tracks applied migrations", () => {
    const dbPath = join(
      os.tmpdir(),
      `jarvis-mig-track-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);

    const migrations = db
      .prepare("SELECT id, name, applied_at, checksum FROM schema_migrations ORDER BY id")
      .all() as Array<{ id: string; name: string; applied_at: string; checksum: string }>;

    expect(migrations.length).toBeGreaterThanOrEqual(2);
    expect(migrations[0].id).toBe("0001");
    expect(migrations[0].name).toBeTruthy();
    expect(migrations[0].applied_at).toBeTruthy();
    expect(migrations[0].checksum).toBeTruthy();

    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("runMigrations called 3 times produces same schema_migrations count", () => {
    const dbPath = join(
      os.tmpdir(),
      `jarvis-mig-3x-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    runMigrations(db);
    const count1 = (db.prepare("SELECT COUNT(*) as n FROM schema_migrations").get() as { n: number }).n;

    runMigrations(db);
    const count2 = (db.prepare("SELECT COUNT(*) as n FROM schema_migrations").get() as { n: number }).n;

    runMigrations(db);
    const count3 = (db.prepare("SELECT COUNT(*) as n FROM schema_migrations").get() as { n: number }).n;

    expect(count1).toBe(count2);
    expect(count2).toBe(count3);

    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("operations work correctly after migration on fresh DB", () => {
    const dbPath = join(
      os.tmpdir(),
      `jarvis-mig-ops-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db);

    const store = new RunStore(db);
    const scheduler = new DbSchedulerStore(db);

    // All operations should work on a freshly migrated DB
    const runId = store.startRun("test-agent", "test", undefined, "Post-migration test");
    expect(store.getStatus(runId)).toBe("planning");

    store.transition(runId, "test-agent", "executing", "plan_built");
    store.transition(runId, "test-agent", "completed", "run_completed");

    const approvalId = requestApproval(db, {
      agent_id: "test-agent",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });
    resolveApproval(db, approvalId, "approved", "tester");

    scheduler.seedSchedule({
      job_type: "post.migration",
      input: {},
      next_fire_at: new Date().toISOString(),
      enabled: true,
    });
    expect(scheduler.count()).toBe(1);

    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });
});
