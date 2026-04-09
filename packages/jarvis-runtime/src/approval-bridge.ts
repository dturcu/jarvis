import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type ApprovalEntry = {
  id: string;
  agent: string;
  action: string;
  payload: string;
  created_at: string;
  status: "pending" | "approved" | "rejected" | "expired";
  run_id: string;
  severity: "info" | "warning" | "critical";
  resolved_at?: string;
  resolved_by?: string;
  resolution_note?: string;
};

/**
 * Write a new approval request to the runtime database.
 * Dashboard and Telegram bot poll the DB and can resolve it.
 */
export function requestApproval(
  db: DatabaseSync,
  req: {
    agent_id: string;
    run_id: string;
    action: string;
    severity: "info" | "warning" | "critical";
    payload: string;
  },
): string {
  const id = randomUUID().slice(0, 8); // short ID for easy Telegram commands
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO approvals (approval_id, run_id, agent_id, action, severity, payload_json, status, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, req.run_id, req.agent_id, req.action, req.severity, req.payload, now);

  return id;
}

/**
 * Poll the runtime database until the given approval is resolved or timeout.
 * Dashboard sets status via POST /api/approvals/:id/approve.
 * Telegram bot sets status via /approve command.
 */
export async function waitForApproval(
  db: DatabaseSync,
  approvalId: string,
  timeoutMs = 24 * 60 * 60 * 1000,
  pollMs = 5_000,
): Promise<"approved" | "rejected" | "timeout"> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Force WAL checkpoint so this connection sees writes from other processes
    // (API server, Telegram bot). Without this, the long-lived daemon connection
    // can miss approval resolutions written by external connections.
    try { db.exec("PRAGMA wal_checkpoint(PASSIVE)"); } catch { /* best-effort */ }

    const row = db.prepare(
      "SELECT status FROM approvals WHERE approval_id = ?",
    ).get(approvalId) as { status: string } | undefined;

    if (row && row.status !== "pending") {
      // Map expired/cancelled to "rejected" so callers abort instead of proceeding
      if (row.status === "approved") return "approved";
      return "rejected"; // rejected, expired, cancelled all mean "do not proceed"
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return "timeout";
}

/**
 * Resolve an approval (approve or reject).
 * Also writes an audit_log entry for traceability.
 */
export function resolveApproval(
  db: DatabaseSync,
  approvalId: string,
  status: "approved" | "rejected" | "expired",
  resolvedBy: string,
  note?: string,
): boolean {
  const now = new Date().toISOString();

  // Atomic: approval resolution + audit log entry
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(`
      UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?
      WHERE approval_id = ? AND status = 'pending'
    `).run(status, now, resolvedBy, note ?? null, approvalId);

    if ((result as { changes: number }).changes === 0) {
      db.exec("ROLLBACK");
      return false;
    }

    // Write audit log entry
    db.prepare(`
      INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      "user",
      resolvedBy,
      `approval.${status}`,
      "approval",
      approvalId,
      JSON.stringify({ note }),
      now,
    );

    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Delegate a pending approval to another operator.
 * Records who delegated and why in the approvals table + audit log.
 */
export function delegateApproval(
  db: DatabaseSync,
  approvalId: string,
  assignee: string,
  delegatedBy: string,
  note?: string,
): boolean {
  const now = new Date().toISOString();

  // Atomic: delegation update + audit log entry (same pattern as resolveApproval)
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(`
      UPDATE approvals SET assignee = ?, delegated_by = ?, delegation_note = ?
      WHERE approval_id = ? AND status = 'pending'
    `).run(assignee, delegatedBy, note ?? null, approvalId);

    if ((result as { changes: number }).changes === 0) {
      db.exec("ROLLBACK");
      return false;
    }

    db.prepare(`
      INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), "user", delegatedBy, "approval.delegated",
      "approval", approvalId,
      JSON.stringify({ assignee, note }), now,
    );

    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * List approvals assigned to a specific user.
 */
export function listApprovalsByAssignee(
  db: DatabaseSync,
  assignee: string,
): ApprovalEntry[] {
  return db.prepare(
    "SELECT approval_id as id, agent_id as agent, action, payload_json as payload, requested_at as created_at, status, run_id, severity, resolved_at, resolved_by, resolution_note FROM approvals WHERE assignee = ? AND status = 'pending' ORDER BY requested_at DESC",
  ).all(assignee) as ApprovalEntry[];
}

/**
 * List approvals, optionally filtered by status.
 */
export function listApprovals(
  db: DatabaseSync,
  status?: "pending" | "approved" | "rejected" | "expired",
): ApprovalEntry[] {
  if (status) {
    return db.prepare(
      "SELECT approval_id as id, agent_id as agent, action, payload_json as payload, requested_at as created_at, status, run_id, severity, resolved_at, resolved_by, resolution_note FROM approvals WHERE status = ? ORDER BY requested_at DESC",
    ).all(status) as ApprovalEntry[];
  }
  return db.prepare(
    "SELECT approval_id as id, agent_id as agent, action, payload_json as payload, requested_at as created_at, status, run_id, severity, resolved_at, resolved_by, resolution_note FROM approvals ORDER BY requested_at DESC",
  ).all() as ApprovalEntry[];
}

// ─── Approval analytics for self-reflection ───────────────────────────────

export type ApprovalMetrics = {
  total: number;
  approved: number;
  rejected: number;
  expired: number;
  pending: number;
  rejection_rate: number;
  avg_latency_ms: number | null;
  by_action: Array<{ action: string; total: number; rejected: number }>;
  by_severity: Array<{ severity: string; total: number; rejected: number }>;
};

/** Aggregated approval metrics over the past N days. */
export function getApprovalMetrics(db: DatabaseSync, days = 7): ApprovalMetrics {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) as approved,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) as rejected,
      COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) as expired,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending
    FROM approvals
    WHERE requested_at >= ?
  `).get(cutoff) as any;

  const latency = db.prepare(`
    SELECT AVG(
      (julianday(resolved_at) - julianday(requested_at)) * 86400000
    ) as avg_ms
    FROM approvals
    WHERE requested_at >= ? AND resolved_at IS NOT NULL
  `).get(cutoff) as { avg_ms: number | null };

  const byAction = db.prepare(`
    SELECT action,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM approvals
    WHERE requested_at >= ?
    GROUP BY action ORDER BY total DESC
  `).all(cutoff) as any[];

  const bySeverity = db.prepare(`
    SELECT severity,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM approvals
    WHERE requested_at >= ?
    GROUP BY severity ORDER BY total DESC
  `).all(cutoff) as any[];

  return {
    ...totals,
    rejection_rate: totals.total > 0 ? Math.round((totals.rejected / totals.total) * 1000) / 1000 : 0,
    avg_latency_ms: latency.avg_ms !== null ? Math.round(latency.avg_ms) : null,
    by_action: byAction,
    by_severity: bySeverity,
  };
}
