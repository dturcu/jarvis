/**
 * A4.4 — Attention API: response structure (black-box lifecycle certification)
 *
 * Tests the attention/needs-attention logic as implemented in
 * packages/jarvis-dashboard/src/api/attention.ts — exercising the same
 * SQL queries the handler uses, but against temp databases we control.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, RunStore } from "@jarvis/runtime";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-attn-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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
 * Replicates the attention query logic from attention.ts.
 * Returns the same shape the GET /attention endpoint returns.
 */
function getAttention(db: DatabaseSync) {
  // Counts
  const pendingApprovals = (db.prepare(
    "SELECT COUNT(*) as cnt FROM approvals WHERE status = 'pending'",
  ).get() as { cnt: number }).cnt;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const failedRuns = (db.prepare(
    "SELECT COUNT(*) as cnt FROM runs WHERE status = 'failed' AND completed_at > ?",
  ).get(twentyFourHoursAgo) as { cnt: number }).cnt;

  const overdueSchedules = (db.prepare(
    "SELECT COUNT(*) as cnt FROM schedules WHERE enabled = 1 AND next_fire_at < ?",
  ).get(nowIso) as { cnt: number }).cnt;

  // Active work
  const activeWork = db.prepare(
    "SELECT run_id, agent_id, status, current_step, total_steps, started_at FROM runs WHERE status IN ('planning','executing','awaiting_approval') ORDER BY started_at DESC",
  ).all() as Record<string, unknown>[];

  // Recent completions
  const recentCompletions = db.prepare(
    "SELECT run_id, agent_id, status, completed_at, current_step FROM runs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 5",
  ).all() as Record<string, unknown>[];

  // Recommended actions
  const recommendedActions: string[] = [];
  if (pendingApprovals > 0) {
    recommendedActions.push(`Review ${pendingApprovals} pending approval${pendingApprovals > 1 ? "s" : ""}`);
  }
  if (failedRuns > 0) {
    recommendedActions.push(`${failedRuns} failed run${failedRuns > 1 ? "s" : ""} need${failedRuns === 1 ? "s" : ""} retry`);
  }
  if (overdueSchedules > 0) {
    recommendedActions.push(`${overdueSchedules} overdue schedule${overdueSchedules > 1 ? "s" : ""}`);
  }

  // System status
  const systemStatus = (pendingApprovals > 0 || failedRuns > 0) ? "needs_attention" : "healthy";

  return {
    needs_attention: {
      pending_approvals: pendingApprovals,
      failed_runs: failedRuns,
      overdue_schedules: overdueSchedules,
    },
    active_work: activeWork,
    recent_completions: recentCompletions,
    recommended_actions: recommendedActions,
    system_status: systemStatus,
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("Attention API: response structure", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("returns correct shape with all fields", () => {
    const now = new Date().toISOString();
    const store = new RunStore(db);

    // 1. Create a pending approval
    db.prepare(`
      INSERT INTO approvals (approval_id, run_id, agent_id, step_no, action, severity, status, requested_at)
      VALUES (?, ?, ?, 1, 'email.send', 'critical', 'pending', ?)
    `).run(randomUUID(), "run-pending", "bd-pipeline", now);

    // 2. Create a failed run (recent — within 24h)
    const failedRunId = store.startRun("evidence-auditor", "schedule");
    store.transition(failedRunId, "evidence-auditor", "executing", "step_started");
    store.transition(failedRunId, "evidence-auditor", "failed", "run_failed", {
      details: { error: "Network timeout" },
    });

    // 3. Create an active (executing) run
    const activeRunId = store.startRun("staffing-monitor", "manual");
    store.transition(activeRunId, "staffing-monitor", "executing", "step_started");

    // 4. Create a completed run
    const completedRunId = store.startRun("content-engine", "schedule");
    store.transition(completedRunId, "content-engine", "executing", "step_started");
    store.transition(completedRunId, "content-engine", "completed", "run_completed");

    // Query the attention logic
    const result = getAttention(db);

    // Verify needs_attention counts
    expect(result.needs_attention.pending_approvals).toBe(1);
    expect(result.needs_attention.failed_runs).toBe(1);
    expect(typeof result.needs_attention.overdue_schedules).toBe("number");

    // Verify active_work has the executing run
    expect(result.active_work.length).toBe(1);
    expect(result.active_work[0].run_id).toBe(activeRunId);
    expect(result.active_work[0].agent_id).toBe("staffing-monitor");

    // Verify recent_completions has the completed run
    expect(result.recent_completions.length).toBe(1);
    expect(result.recent_completions[0].run_id).toBe(completedRunId);

    // Verify recommended_actions is non-empty (we have pending approvals + failed runs)
    expect(result.recommended_actions.length).toBeGreaterThan(0);
    expect(result.recommended_actions.some(a => a.includes("pending approval"))).toBe(true);
    expect(result.recommended_actions.some(a => a.includes("failed run"))).toBe(true);

    // Verify system_status
    expect(result.system_status).toBe("needs_attention");
  });

  it("returns healthy status when nothing needs attention", () => {
    const store = new RunStore(db);

    // Only a completed run — no failures, no pending approvals
    const runId = store.startRun("content-engine", "schedule");
    store.transition(runId, "content-engine", "executing", "step_started");
    store.transition(runId, "content-engine", "completed", "run_completed");

    const result = getAttention(db);

    expect(result.needs_attention.pending_approvals).toBe(0);
    expect(result.needs_attention.failed_runs).toBe(0);
    expect(result.system_status).toBe("healthy");
    expect(result.recommended_actions).toHaveLength(0);
    expect(result.recent_completions.length).toBe(1);
    expect(result.active_work).toHaveLength(0);
  });

  it("counts overdue schedules", () => {
    // Insert an overdue schedule (next_fire_at in the past, enabled)
    const pastTime = new Date(Date.now() - 3600_000).toISOString();
    db.prepare(`
      INSERT INTO schedules (schedule_id, job_type, cron_expression, next_fire_at, enabled, created_at)
      VALUES (?, 'run_agent', '0 9 * * *', ?, 1, ?)
    `).run(randomUUID(), pastTime, new Date().toISOString());

    // Insert a schedule that is NOT overdue (next_fire_at in the future)
    const futureTime = new Date(Date.now() + 3600_000).toISOString();
    db.prepare(`
      INSERT INTO schedules (schedule_id, job_type, cron_expression, next_fire_at, enabled, created_at)
      VALUES (?, 'run_agent', '0 9 * * *', ?, 1, ?)
    `).run(randomUUID(), futureTime, new Date().toISOString());

    const result = getAttention(db);
    expect(result.needs_attention.overdue_schedules).toBe(1);
    expect(result.recommended_actions.some(a => a.includes("overdue schedule"))).toBe(true);
  });

  it("limits recent_completions to 5", () => {
    const store = new RunStore(db);

    // Create 7 completed runs
    for (let i = 0; i < 7; i++) {
      const runId = store.startRun(`agent-${i}`, "schedule");
      store.transition(runId, `agent-${i}`, "executing", "step_started");
      store.transition(runId, `agent-${i}`, "completed", "run_completed");
    }

    const result = getAttention(db);
    expect(result.recent_completions.length).toBeLessThanOrEqual(5);
  });

  it("includes multiple active work statuses", () => {
    const store = new RunStore(db);

    // Planning run
    const planningRunId = store.startRun("bd-pipeline", "manual");
    // (startRun starts in 'planning' status)

    // Executing run
    const executingRunId = store.startRun("content-engine", "schedule");
    store.transition(executingRunId, "content-engine", "executing", "step_started");

    // Awaiting approval run
    const awaitingRunId = store.startRun("proposal-engine", "manual");
    store.transition(awaitingRunId, "proposal-engine", "executing", "step_started");
    store.transition(awaitingRunId, "proposal-engine", "awaiting_approval", "approval_requested");

    const result = getAttention(db);
    expect(result.active_work.length).toBe(3);

    const activeStatuses = result.active_work.map(w => w.status);
    expect(activeStatuses).toContain("planning");
    expect(activeStatuses).toContain("executing");
    expect(activeStatuses).toContain("awaiting_approval");
  });

  it("pluralizes recommended_actions correctly", () => {
    const now = new Date().toISOString();

    // 1 pending approval
    db.prepare(`
      INSERT INTO approvals (approval_id, run_id, agent_id, step_no, action, severity, status, requested_at)
      VALUES (?, ?, ?, 1, 'email.send', 'critical', 'pending', ?)
    `).run(randomUUID(), "run-1", "agent-1", now);

    const result1 = getAttention(db);
    expect(result1.recommended_actions[0]).toContain("1 pending approval");
    expect(result1.recommended_actions[0]).not.toContain("approvals");

    // Add a 2nd pending approval
    db.prepare(`
      INSERT INTO approvals (approval_id, run_id, agent_id, step_no, action, severity, status, requested_at)
      VALUES (?, ?, ?, 1, 'publish_post', 'critical', 'pending', ?)
    `).run(randomUUID(), "run-2", "agent-2", now);

    const result2 = getAttention(db);
    expect(result2.recommended_actions[0]).toContain("2 pending approvals");
  });
});
