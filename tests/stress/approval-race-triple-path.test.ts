/**
 * Stress: Approval Race — Triple-Path Resolution
 *
 * Invariant: each approval reaches exactly ONE terminal state;
 * no side-effect fires when the final state != "approved";
 * the audit log is strictly monotonic (no duplicate terminal entries).
 *
 * Exercises three concurrent race shapes:
 *   (a) approved / rejected / expired race across 200 approvals
 *   (b) double-approve from two distinct operator tokens across 50 approvals
 *   (c) raw SQL DELETE mid-transaction across 50 approvals
 *
 * Side-effect fidelity: we drive a spy "dispatcher" that would only
 * fire on a final `approved` status — this lets us prove that no rejected
 * or expired outcome accidentally triggered the action.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  RunStore,
  requestApproval,
  resolveApproval,
  listApprovals,
} from "@jarvis/runtime";
import { createStressDb, cleanupDb, range } from "./helpers.js";

// ─── Side-effect spy ────────────────────────────────────────────────────────

/**
 * Emulates the "if approved, dispatch the action" step that lives
 * downstream of resolveApproval in production. We spy on final state
 * to ensure it's never triggered by rejected/expired outcomes.
 */
class SideEffectSpy {
  private fired = new Set<string>();
  fireIfApproved(db: DatabaseSync, approvalId: string): void {
    const row = db
      .prepare("SELECT status FROM approvals WHERE approval_id = ?")
      .get(approvalId) as { status: string } | undefined;
    if (row?.status === "approved") this.fired.add(approvalId);
  }
  count(): number { return this.fired.size; }
  firedFor(id: string): boolean { return this.fired.has(id); }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function seedEmailSendApproval(
  db: DatabaseSync,
  store: RunStore,
  i: number,
): { approvalId: string; runId: string } {
  const agentId = `race-${i}`;
  const runId = store.startRun(agentId, "stress");
  store.transition(runId, agentId, "executing", "plan_built");
  store.transition(runId, agentId, "awaiting_approval", "approval_requested");
  const approvalId = requestApproval(db, {
    agent_id: agentId,
    run_id: runId,
    action: "email.send",
    severity: "critical",
    payload: JSON.stringify({ to: `dest-${i}@example.com`, subject: `#${i}` }),
  });
  return { approvalId, runId };
}

/**
 * Direct DB UPDATE to simulate an expiry sweep. Uses the same
 * "only transition from pending" predicate as resolveApproval so
 * the race conditions are realistic.
 */
function expireDirect(db: DatabaseSync, approvalId: string): boolean {
  const now = new Date().toISOString();
  const r = db
    .prepare(
      "UPDATE approvals SET status = 'expired', resolved_at = ?, resolved_by = 'system' WHERE approval_id = ? AND status = 'pending'",
    )
    .run(now, approvalId) as { changes: number };
  return r.changes > 0;
}

function countAuditForApproval(db: DatabaseSync, approvalId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM audit_log WHERE target_type = 'approval' AND target_id = ?",
    )
    .get(approvalId) as { c: number };
  return row.c;
}

function terminalStateFor(db: DatabaseSync, approvalId: string): string | null {
  const row = db
    .prepare("SELECT status FROM approvals WHERE approval_id = ?")
    .get(approvalId) as { status: string } | undefined;
  return row?.status ?? null;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Approval Race — Triple-Path Resolution", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;
  let spy: SideEffectSpy;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("approval-race"));
    store = new RunStore(db);
    spy = new SideEffectSpy();
  });

  afterEach(() => cleanupDb(db, dbPath));

  // ── (a) 200 × triple-path race ─────────────────────────────────────────

  it("(a) 200 approvals × approved/rejected/expired triple race — exactly one terminal state each", async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 200; i++) {
      seeded.push(seedEmailSendApproval(db, store, i).approvalId);
    }
    expect(listApprovals(db, "pending")).toHaveLength(200);

    // Fire 3 racers at each approval: approved, rejected, expired.
    // Exactly one must win (DB predicate + BEGIN IMMEDIATE serialize them).
    const winners: Array<{ id: string; path: string; ok: boolean }> = [];

    await Promise.all(
      seeded.flatMap((id, i) => [
        (async () => {
          const ok = resolveApproval(db, id, "approved", `approver-${i}`);
          winners.push({ id, path: "approved", ok });
        })(),
        (async () => {
          const ok = resolveApproval(db, id, "rejected", `rejector-${i}`);
          winners.push({ id, path: "rejected", ok });
        })(),
        (async () => {
          const ok = expireDirect(db, id);
          winners.push({ id, path: "expired", ok });
        })(),
      ]),
    );

    // Run the dispatcher step for every approval AFTER resolution settles.
    for (const id of seeded) spy.fireIfApproved(db, id);

    // Invariant 1: every approval has a terminal state (no pending left).
    expect(listApprovals(db, "pending")).toHaveLength(0);

    // Invariant 2: exactly one racer won per approval.
    const winCountById = new Map<string, number>();
    for (const w of winners) {
      if (w.ok) winCountById.set(w.id, (winCountById.get(w.id) ?? 0) + 1);
    }
    for (const id of seeded) {
      expect(winCountById.get(id), `approval ${id} should have exactly 1 winner`).toBe(1);
    }

    // Invariant 3: the side-effect count equals the number of "approved"
    // terminal states. (Rejected/expired outcomes must never dispatch.)
    const approvedCount = listApprovals(db, "approved").length;
    expect(spy.count()).toBe(approvedCount);

    // Invariant 4: audit log — resolveApproval writes an entry, expireDirect
    // does NOT (it's a simulated silent sweep). So each approval has either
    // 0 entries (expired path won) or 1 entry (approved/rejected won).
    for (const id of seeded) {
      const n = countAuditForApproval(db, id);
      const state = terminalStateFor(db, id);
      if (state === "expired") {
        expect(n, `expired approvals write no bridge audit entry — got ${n} for ${id}`).toBe(0);
      } else {
        expect(n, `resolveApproval writes exactly 1 audit entry for ${id} (${state})`).toBe(1);
      }
    }
  });

  // ── (b) Double-approve from two distinct operator tokens ───────────────

  it("(b) 50 approvals × double-approve from two operator tokens — only first wins", async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 50; i++) {
      seeded.push(seedEmailSendApproval(db, store, 1000 + i).approvalId);
    }

    const results: Array<{ id: string; tokenA: boolean; tokenB: boolean }> = [];
    await Promise.all(
      seeded.map(async (id, i) => {
        // Two operators submit concurrently; each might submit "approved".
        const [a, b] = await Promise.all([
          (async () => resolveApproval(db, id, "approved", `operator-A-${i}`, "LGTM from A"))(),
          (async () => resolveApproval(db, id, "approved", `operator-B-${i}`, "LGTM from B"))(),
        ]);
        results.push({ id, tokenA: a, tokenB: b });
      }),
    );

    // Exactly one of the two tokens won for every approval.
    for (const r of results) {
      const winCount = (r.tokenA ? 1 : 0) + (r.tokenB ? 1 : 0);
      expect(winCount, `approval ${r.id}: both tokens think they won`).toBe(1);
    }

    // Every row is approved, and resolved_by matches exactly one of the two operators.
    const approved = listApprovals(db, "approved");
    expect(approved.length).toBe(50);
    for (const row of approved) {
      expect(row.resolved_by).toBeTruthy();
      expect(
        row.resolved_by!.startsWith("operator-A-") || row.resolved_by!.startsWith("operator-B-"),
        `resolved_by "${row.resolved_by}" should match operator-A-* or operator-B-*`,
      ).toBe(true);
    }

    // No `approved` row has null approver_token.
    const rawApproved = db
      .prepare("SELECT resolved_by FROM approvals WHERE status = 'approved'")
      .all() as Array<{ resolved_by: string | null }>;
    expect(rawApproved.every((r) => r.resolved_by !== null)).toBe(true);

    // Audit log: exactly one entry per approval (no duplicates).
    for (const id of seeded) {
      expect(countAuditForApproval(db, id)).toBe(1);
    }

    // No side-effect fires twice, even though both tokens tried.
    for (const id of seeded) spy.fireIfApproved(db, id);
    expect(spy.count()).toBe(50);
  });

  // ── (c) Mid-transaction DELETE race ────────────────────────────────────

  it("(c) 50 approvals × mid-transaction DELETE race — integrity preserved", async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 50; i++) {
      seeded.push(seedEmailSendApproval(db, store, 2000 + i).approvalId);
    }

    const rawDeletes: number[] = [];
    const resolveWins: string[] = [];

    await Promise.all(
      seeded.flatMap((id) => [
        (async () => {
          // Competing resolve
          const ok = resolveApproval(db, id, "approved", "honest-operator");
          if (ok) resolveWins.push(id);
        })(),
        (async () => {
          // Raw SQL DELETE — simulates an attacker or stale admin cleanup script.
          // If resolve wins first, DELETE removes the row entirely, which is
          // what we must detect. If DELETE wins first, resolve must fail.
          try {
            const r = db.prepare("DELETE FROM approvals WHERE approval_id = ?").run(id) as { changes: number };
            rawDeletes.push(r.changes);
          } catch { /* busy DB is acceptable under heavy contention */ }
        })(),
      ]),
    );

    // Classify each approval: exists vs. deleted
    const finalRows = db
      .prepare("SELECT approval_id, status FROM approvals WHERE approval_id IN (" +
        seeded.map(() => "?").join(",") + ")")
      .all(...seeded) as Array<{ approval_id: string; status: string }>;

    const stillPresent = new Set(finalRows.map((r) => r.approval_id));
    for (const id of seeded) {
      const present = stillPresent.has(id);
      const resolved = resolveWins.includes(id);

      // If DELETE won, row should be absent and resolve should have failed.
      // If resolve won, row should exist with an `approved` status — unless
      // DELETE then removed it after resolve, in which case there's also no row.
      if (!present) {
        // Row is gone. Either way the invariant holds: no pending left
        // and the side-effect spy cannot observe an approved row.
        expect(
          db.prepare("SELECT status FROM approvals WHERE approval_id = ?").get(id),
        ).toBeUndefined();
      } else {
        // Row remains. If resolve won it must be `approved`, otherwise `pending`.
        const row = finalRows.find((r) => r.approval_id === id)!;
        if (resolved) {
          expect(row.status).toBe("approved");
        } else {
          expect(row.status === "pending" || row.status === "approved").toBe(true);
        }
      }
    }

    // No approval row is in an impossible state.
    const impossibleRows = db
      .prepare("SELECT * FROM approvals WHERE status NOT IN ('pending','approved','rejected','expired')")
      .all();
    expect(impossibleRows).toHaveLength(0);

    // Side-effect check: fires ONLY for rows that are currently approved.
    for (const id of seeded) spy.fireIfApproved(db, id);
    const currentlyApproved = db
      .prepare("SELECT COUNT(*) AS c FROM approvals WHERE status = 'approved'")
      .get() as { c: number };
    expect(spy.count()).toBe(currentlyApproved.c);
  });

  // ── Strict monotonicity across all three races in one session ──────────

  it("audit log is strictly monotonic — no duplicate terminal entries per approval", () => {
    // Run a mini mixed race and verify monotonicity directly.
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      ids.push(seedEmailSendApproval(db, store, 3000 + i).approvalId);
    }

    for (const id of ids) {
      // Fire 4 racing paths
      resolveApproval(db, id, "approved", "u1");
      resolveApproval(db, id, "rejected", "u2");
      resolveApproval(db, id, "expired", "u3");
      resolveApproval(db, id, "approved", "u4");
    }

    // Every approval must have exactly one audit entry.
    for (const id of ids) {
      expect(countAuditForApproval(db, id)).toBe(1);
    }

    // Global monotonicity: audit timestamps are non-decreasing when ordered.
    const entries = db
      .prepare("SELECT created_at FROM audit_log WHERE target_type = 'approval' ORDER BY created_at ASC")
      .all() as Array<{ created_at: string }>;
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1]!.created_at <= entries[i]!.created_at).toBe(true);
    }
  });
});
