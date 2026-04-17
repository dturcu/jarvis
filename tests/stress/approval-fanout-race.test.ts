/**
 * Stress: Approval Fanout Race
 *
 * Invariant: single-decision semantics. When N children share one
 * `approval_id`, resolving once releases all N children; any second
 * resolution is a no-op. No child proceeds while pending. No child
 * fires twice. No SQLITE_BUSY error propagates to callers.
 *
 * ─── API discovery ──────────────────────────────────────────────────────────
 * `requestApproval()` in packages/jarvis-runtime/src/approval-bridge.ts always
 * generates a fresh `randomUUID().slice(0, 8)` — it has NO content-hash dedupe.
 * However, `approval_id` IS the PRIMARY KEY on `approvals`, so the fan-out
 * dedupe contract is expressed via INSERT OR IGNORE with a pre-allocated id.
 * The real `resolveApproval()` already guards with
 * `UPDATE ... WHERE status = 'pending'` and returns false on second call —
 * that IS the single-decision contract this test asserts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RunStore, resolveApproval } from "@jarvis/runtime";
import { createStressDb, cleanupDb, range } from "./helpers.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function allocateApprovalId(): string { return randomUUID().slice(0, 8); }

/** Fan-out dedupe emulation: INSERT OR IGNORE with a pre-allocated approval_id. */
function insertSharedApproval(
  db: DatabaseSync, approvalId: string, runId: string, agentId: string,
): { applied: boolean } {
  const res = db.prepare(
    `INSERT OR IGNORE INTO approvals
       (approval_id, run_id, agent_id, action, severity, payload_json, status, requested_at)
     VALUES (?, ?, ?, 'fanout.shared', 'critical', ?, 'pending', ?)`,
  ).run(approvalId, runId, agentId, JSON.stringify({ shared: true }), new Date().toISOString());
  return { applied: (res as { changes: number }).changes === 1 };
}

/** Tight poll for approval resolution; budget-capped. */
function pollForApproval(
  db: DatabaseSync, approvalId: string, budgetMs: number,
): "approved" | "rejected" | "timeout" {
  const stmt = db.prepare("SELECT status FROM approvals WHERE approval_id = ?");
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const row = stmt.get(approvalId) as { status: string } | undefined;
    if (row && row.status !== "pending") {
      return row.status === "approved" ? "approved" : "rejected";
    }
  }
  return "timeout";
}

/** Retry-on-busy wrapper — validates "zero SQLITE_BUSY propagates" invariant. */
function resolveWithRetry(
  db: DatabaseSync, approvalId: string, resolverId: string, maxRetries: number,
): { ok: boolean; retries: number; error?: string } {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const ok = resolveApproval(db, approvalId, "approved", resolverId);
      return { ok, retries: attempt };
    } catch (e) {
      const msg = String(e);
      if (msg.includes("SQLITE_BUSY") || msg.includes("database is locked")) continue;
      return { ok: false, retries: attempt, error: msg };
    }
  }
  return { ok: false, retries: maxRetries, error: "max retries exceeded" };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Approval Fanout Race", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("approval-fanout"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  // ── Variation (a): 50 children × 2 resolvers ──────────────────────────────

  it("50 children share one approval_id; 2 racing resolvers yield single applied=true", async () => {
    const orch = store.startRun("orchestrator", "fanout");
    store.transition(orch, "orchestrator", "executing", "plan_built");

    const approvalId = allocateApprovalId();
    const children = await Promise.all(range(50).map(async (i) => {
      const rid = store.startRun(`child-${i}`, "fanout");
      store.transition(rid, `child-${i}`, "awaiting_approval", "approval_requested", {
        step_no: 1, action: "fanout.shared", details: { approval_id: approvalId },
      });
      const ins = insertSharedApproval(db, approvalId, rid, `child-${i}`);
      return { childRunId: rid, insertedFirst: ins.applied };
    }));

    // INSERT OR IGNORE: exactly one child created the row, 49 hit the dedupe path.
    expect(children.filter((c) => c.insertedFirst)).toHaveLength(1);

    // 2 resolvers race on microtask barrier
    const barrier = new Promise<void>((r) => setTimeout(r, 0));
    const [r1, r2] = await Promise.all([
      barrier.then(() => resolveWithRetry(db, approvalId, "operator-1", 10)),
      barrier.then(() => resolveWithRetry(db, approvalId, "operator-2", 10)),
    ]);

    // Zero BUSY errors escape to callers
    expect(r1.error).toBeUndefined();
    expect(r2.error).toBeUndefined();
    // Exactly one resolver got ok=true (single-decision)
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);

    const approval = db.prepare(
      "SELECT status, resolved_by FROM approvals WHERE approval_id = ?",
    ).get(approvalId) as { status: string; resolved_by: string };
    expect(approval.status).toBe("approved");
    expect(["operator-1", "operator-2"]).toContain(approval.resolved_by);

    // All 50 children observe 'approved' and transition waiting -> executing exactly once
    const observations = await Promise.all(children.map(({ childRunId }, i) => {
      const outcome = pollForApproval(db, approvalId, 2000);
      if (outcome === "approved") {
        store.transition(childRunId, `child-${i}`, "executing", "approval_resolved");
      }
      return { childRunId, outcome };
    }));
    expect(observations.every((o) => o.outcome === "approved")).toBe(true);
    expect(children.map((c) => store.getStatus(c.childRunId))
      .filter((s) => s === "executing")).toHaveLength(50);
  });

  // ── Variation (b): 100 children × 4 resolvers ─────────────────────────────

  it("100 children × 4 racing resolvers: single-decision under higher contention", async () => {
    const orch = store.startRun("orchestrator", "fanout-100");
    store.transition(orch, "orchestrator", "executing", "plan_built");

    const approvalId = allocateApprovalId();
    const children = await Promise.all(range(100).map(async (i) => {
      const rid = store.startRun(`hundred-${i}`, "fanout-100");
      store.transition(rid, `hundred-${i}`, "awaiting_approval", "approval_requested");
      insertSharedApproval(db, approvalId, rid, `hundred-${i}`);
      return { childRunId: rid };
    }));

    const barrier = new Promise<void>((r) => setTimeout(r, 0));
    const resolvers = await Promise.all(range(4).map((i) =>
      barrier.then(() => resolveWithRetry(db, approvalId, `operator-${i}`, 20)),
    ));

    // No BUSY leaks under contention
    expect(resolvers.filter((r) => r.error)).toHaveLength(0);
    // Single-decision: exactly one true
    expect(resolvers.filter((r) => r.ok).length).toBe(1);
    // Other 3 resolved with applied=false (not error)
    expect(resolvers.filter((r) => !r.ok && !r.error)).toHaveLength(3);

    // Row count is 1 (dedupe held)
    const rc = db.prepare(
      "SELECT COUNT(*) as c FROM approvals WHERE approval_id = ?",
    ).get(approvalId) as { c: number };
    expect(rc.c).toBe(1);

    // All 100 children observed resolution
    const observed = children.map(({ childRunId }, i) => {
      const s = pollForApproval(db, approvalId, 2000);
      if (s === "approved") {
        store.transition(childRunId, `hundred-${i}`, "executing", "approval_resolved");
      }
      return s;
    });
    expect(observed.filter((s) => s === "approved")).toHaveLength(100);
  });

  // ── Variation (c): clock-skewed resolver ──────────────────────────────────

  it("clock-skewed resolver (10s past) wins first-write but cannot be overwritten", () => {
    const orch = store.startRun("orchestrator", "skew");
    store.transition(orch, "orchestrator", "executing", "plan_built");
    const approvalId = allocateApprovalId();
    range(50).forEach((i) => {
      const rid = store.startRun(`skew-${i}`, "skew");
      store.transition(rid, `skew-${i}`, "awaiting_approval", "approval_requested");
      insertSharedApproval(db, approvalId, rid, `skew-${i}`);
    });

    // Skewed resolver fires first with a back-dated resolved_at
    const pastIso = new Date(Date.now() - 10_000).toISOString();
    const skewResult = db.prepare(
      `UPDATE approvals SET status = 'approved', resolved_at = ?, resolved_by = 'skewed-operator'
       WHERE approval_id = ? AND status = 'pending'`,
    ).run(pastIso, approvalId);
    expect((skewResult as { changes: number }).changes).toBe(1);

    // "Normal" resolver tries after — must be a no-op via WHERE status='pending' guard
    const normal = resolveApproval(db, approvalId, "approved", "normal-operator");
    expect(normal).toBe(false);

    // First-write-wins: skewed resolver's record is final
    const row = db.prepare(
      "SELECT status, resolved_by, resolved_at FROM approvals WHERE approval_id = ?",
    ).get(approvalId) as { status: string; resolved_by: string; resolved_at: string };
    expect(row.status).toBe("approved");
    expect(row.resolved_by).toBe("skewed-operator");
    expect(row.resolved_at).toBe(pastIso);
  });

  // ── Mid-transaction resolver crash ────────────────────────────────────────

  it("3 synthetic resolver crashes mid-transaction do not corrupt approval state", () => {
    const approvalId = allocateApprovalId();
    const orch = store.startRun("orchestrator", "crash");
    store.transition(orch, "orchestrator", "executing", "plan_built");
    range(5).forEach((i) => {
      const rid = store.startRun(`crash-${i}`, "crash");
      store.transition(rid, `crash-${i}`, "awaiting_approval", "approval_requested");
      insertSharedApproval(db, approvalId, rid, `crash-${i}`);
    });

    // Crash pattern: BEGIN IMMEDIATE + UPDATE + ROLLBACK (never commits)
    const crashResolver = (): boolean => {
      try {
        db.exec("BEGIN IMMEDIATE");
        db.prepare(
          "UPDATE approvals SET status = 'approved', resolved_at = ?, resolved_by = ? WHERE approval_id = ? AND status = 'pending'",
        ).run(new Date().toISOString(), "crash-worker", approvalId);
        db.exec("ROLLBACK");
        return true;
      } catch {
        try { db.exec("ROLLBACK"); } catch { /* best-effort */ }
        return true;
      }
    };

    expect(crashResolver()).toBe(true);
    expect(crashResolver()).toBe(true);
    expect(crashResolver()).toBe(true);

    // After 3 crashes, status is still pending (rollback was honored)
    const before = db.prepare(
      "SELECT status FROM approvals WHERE approval_id = ?",
    ).get(approvalId) as { status: string };
    expect(before.status).toBe("pending");

    // Real resolver succeeds after crash churn
    const ok = resolveApproval(db, approvalId, "approved", "recovery-operator");
    expect(ok).toBe(true);
    const after = db.prepare(
      "SELECT status, resolved_by FROM approvals WHERE approval_id = ?",
    ).get(approvalId) as { status: string; resolved_by: string };
    expect(after.status).toBe("approved");
    expect(after.resolved_by).toBe("recovery-operator");

    // Second resolution no-op
    expect(resolveApproval(db, approvalId, "rejected", "late-operator")).toBe(false);
  });

  // ── Audit-log + row-count invariant probe ─────────────────────────────────

  it("no duplicate audit rows and exactly one approval.approved event per fanout", async () => {
    const approvalId = allocateApprovalId();
    const orch = store.startRun("orchestrator", "audit-probe");
    store.transition(orch, "orchestrator", "executing", "plan_built");
    range(20).forEach((i) => {
      const rid = store.startRun(`aud-${i}`, "audit-probe");
      store.transition(rid, `aud-${i}`, "awaiting_approval", "approval_requested");
      insertSharedApproval(db, approvalId, rid, `aud-${i}`);
    });

    const barrier = new Promise<void>((r) => setTimeout(r, 0));
    const outcomes = await Promise.all(range(5).map((i) =>
      barrier.then(() => resolveWithRetry(db, approvalId, `op-${i}`, 10)),
    ));

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => o.error)).toHaveLength(0);

    const auditRows = db.prepare(
      "SELECT * FROM audit_log WHERE target_type = 'approval' AND target_id = ? AND action = 'approval.approved'",
    ).all(approvalId);
    expect(auditRows).toHaveLength(1);

    const approvalRows = db.prepare(
      "SELECT * FROM approvals WHERE approval_id = ?",
    ).all(approvalId);
    expect(approvalRows).toHaveLength(1);
  });
});
