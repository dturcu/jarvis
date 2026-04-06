/**
 * E1: Shutdown event emission tests.
 *
 * Tests the EXACT shutdown contract implemented in daemon.ts:
 * - RunStore.transition(runId, agentId, targetStatus, "daemon_shutdown", { details })
 * - Pending approvals expired via resolveApproval(db, id, "expired", "daemon-{pid}")
 * - audit_log entry for daemon.shutdown
 *
 * This matches the per-run transition loop in daemon.ts shutdown(), NOT bulk SQL.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, RunStore } from "@jarvis/runtime";
import { requestApproval, resolveApproval, listApprovals } from "@jarvis/runtime";

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-shutdown-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

/**
 * Simulate the exact daemon shutdown logic from daemon.ts:
 * 1. Query all non-terminal runs
 * 2. For each: handle awaiting_approval (expire approvals), then transition via RunStore
 * 3. Record audit_log entry
 */
function simulateDaemonShutdown(db: DatabaseSync, signal = "SIGTERM") {
  const runStore = new RunStore(db);
  const activeRuns = db.prepare(
    "SELECT run_id, agent_id, status FROM runs WHERE status NOT IN ('completed','failed','cancelled')"
  ).all() as Array<{ run_id: string; agent_id: string; status: string }>;

  for (const run of activeRuns) {
    if (run.status === "awaiting_approval") {
      const pendingApprovals = db.prepare(
        "SELECT approval_id FROM approvals WHERE run_id = ? AND status = 'pending'"
      ).all(run.run_id) as Array<{ approval_id: string }>;
      for (const approval of pendingApprovals) {
        resolveApproval(db, approval.approval_id, "expired", `daemon-${process.pid}`, "daemon_shutdown");
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
  }

  // Record audit_log entry (same as daemon.ts)
  db.prepare(`
    INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
    VALUES (?, 'daemon', ?, 'daemon.shutdown', 'daemon', ?, ?, ?)
  `).run(
    randomUUID(), `daemon-${process.pid}`, `daemon-${process.pid}`,
    JSON.stringify({ signal, runs_affected: activeRuns.length, pid: process.pid }),
    new Date().toISOString()
  );

  return activeRuns.length;
}

describe("Shutdown: daemon contract (RunStore.transition + daemon_shutdown events)", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("executing run transitions to failed with daemon_shutdown event", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");
    store.transition(runId, "test-agent", "executing", "step_started", { step_no: 1, action: "web.search" });

    const affected = simulateDaemonShutdown(db);
    expect(affected).toBe(1);

    expect(store.getStatus(runId)).toBe("failed");
    const events = store.getRunEvents(runId);
    const shutdownEvent = events.find(e => e.event_type === "daemon_shutdown");
    expect(shutdownEvent).toBeDefined();
    expect(JSON.parse(shutdownEvent!.payload_json ?? "{}").reason).toBe("daemon_shutdown");
  });

  it("planning run transitions to failed with daemon_shutdown event", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");
    expect(store.getStatus(runId)).toBe("planning");

    simulateDaemonShutdown(db);

    expect(store.getStatus(runId)).toBe("failed");
    const events = store.getRunEvents(runId);
    expect(events.some(e => e.event_type === "daemon_shutdown")).toBe(true);
  });

  it("awaiting_approval run has approvals expired before failing", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");
    store.transition(runId, "test-agent", "executing", "step_started");
    store.transition(runId, "test-agent", "awaiting_approval", "approval_requested");

    const approvalId = requestApproval(db, {
      agent_id: "test-agent", run_id: runId,
      action: "email.send", severity: "critical", payload: "test",
    });

    expect(listApprovals(db, "pending").some(a => a.id === approvalId)).toBe(true);

    simulateDaemonShutdown(db);

    // Approval was expired
    const allApprovals = listApprovals(db);
    const approval = allApprovals.find(a => a.id === approvalId);
    expect(approval!.status).toBe("expired");
    expect(approval!.resolved_by).toContain("daemon");

    // Run was failed
    expect(store.getStatus(runId)).toBe("failed");
    const events = store.getRunEvents(runId);
    expect(events.some(e => e.event_type === "daemon_shutdown")).toBe(true);
  });

  it("completed runs are untouched by shutdown", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");
    store.transition(runId, "test-agent", "executing", "step_started");
    store.transition(runId, "test-agent", "completed", "run_completed");

    const affected = simulateDaemonShutdown(db);
    expect(affected).toBe(0);
    expect(store.getStatus(runId)).toBe("completed");
  });

  it("audit_log records daemon.shutdown with correct fields", () => {
    const store = new RunStore(db);
    store.startRun("test-agent"); // creates one in-flight run

    simulateDaemonShutdown(db, "SIGINT");

    const row = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'daemon.shutdown' ORDER BY created_at DESC LIMIT 1"
    ).get() as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(row.actor_type).toBe("daemon");
    expect(row.action).toBe("daemon.shutdown");
    const payload = JSON.parse(row.payload_json as string);
    expect(payload.signal).toBe("SIGINT");
    expect(payload.runs_affected).toBe(1);
    expect(payload.pid).toBe(process.pid);
  });

  it("mixed states: each run transitioned correctly", () => {
    const store = new RunStore(db);

    // planning run
    const r1 = store.startRun("agent-a");

    // executing run
    const r2 = store.startRun("agent-b");
    store.transition(r2, "agent-b", "executing", "step_started");

    // awaiting_approval run
    const r3 = store.startRun("agent-c");
    store.transition(r3, "agent-c", "executing", "step_started");
    store.transition(r3, "agent-c", "awaiting_approval", "approval_requested");
    requestApproval(db, { agent_id: "agent-c", run_id: r3, action: "email.send", severity: "critical", payload: "test" });

    // completed run (should be untouched)
    const r4 = store.startRun("agent-d");
    store.transition(r4, "agent-d", "executing", "step_started");
    store.transition(r4, "agent-d", "completed", "run_completed");

    const affected = simulateDaemonShutdown(db);
    expect(affected).toBe(3); // r1, r2, r3

    expect(store.getStatus(r1)).toBe("failed");   // planning → failed
    expect(store.getStatus(r2)).toBe("failed");   // executing → failed
    expect(store.getStatus(r3)).toBe("failed");   // awaiting_approval → failed (after approval expired)
    expect(store.getStatus(r4)).toBe("completed"); // untouched

    // Each affected run has a daemon_shutdown event
    for (const runId of [r1, r2, r3]) {
      const events = store.getRunEvents(runId);
      expect(events.some(e => e.event_type === "daemon_shutdown")).toBe(true);
    }

    // r4 has no daemon_shutdown event
    const r4Events = store.getRunEvents(r4);
    expect(r4Events.some(e => e.event_type === "daemon_shutdown")).toBe(false);
  });
});
