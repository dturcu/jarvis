import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type ApprovalEntry = {
  id: string
  agent: string
  action: string
  payload: string
  created_at: string
  status: 'pending' | 'approved' | 'rejected'
  run_id: string
  severity: 'info' | 'warning' | 'critical'
  resolved_at?: string
  resolved_by?: string
  resolution_note?: string
  notified?: boolean
}

/**
 * Load approvals from the runtime database.
 */
export function loadApprovals(db: DatabaseSync, status?: 'pending' | 'approved' | 'rejected'): ApprovalEntry[] {
  try {
    const sql = status
      ? "SELECT approval_id as id, agent_id as agent, action, payload_json as payload, requested_at as created_at, status, run_id, severity, resolved_at, resolved_by, resolution_note FROM approvals WHERE status = ? ORDER BY requested_at DESC"
      : "SELECT approval_id as id, agent_id as agent, action, payload_json as payload, requested_at as created_at, status, run_id, severity, resolved_at, resolved_by, resolution_note FROM approvals ORDER BY requested_at DESC"
    return (status ? db.prepare(sql).all(status) : db.prepare(sql).all()) as ApprovalEntry[]
  } catch {
    return []
  }
}

/**
 * Get pending approvals that haven't been notified via Telegram yet.
 * Uses the notifications table to track what's been sent.
 */
export function getUnnotifiedPending(db: DatabaseSync): ApprovalEntry[] {
  try {
    return db.prepare(`
      SELECT a.approval_id as id, a.agent_id as agent, a.action, a.payload_json as payload,
             a.requested_at as created_at, a.status, a.run_id, a.severity
      FROM approvals a
      WHERE a.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.kind = 'approval_prompt'
            AND json_extract(n.payload_json, '$.approval_id') = a.approval_id
        )
      ORDER BY a.requested_at ASC
    `).all() as ApprovalEntry[]
  } catch {
    return []
  }
}

/**
 * Record that an approval notification was sent to Telegram.
 */
export function markNotified(db: DatabaseSync, approvalId: string): void {
  try {
    db.prepare(`
      INSERT INTO notifications (notification_id, channel, kind, payload_json, status, created_at, delivered_at)
      VALUES (?, 'telegram', 'approval_prompt', ?, 'delivered', ?, ?)
    `).run(
      randomUUID(),
      JSON.stringify({ approval_id: approvalId }),
      new Date().toISOString(),
      new Date().toISOString(),
    )
  } catch {
    // Best-effort notification tracking
  }
}

/**
 * Resolve an approval (approve or reject) via the runtime database.
 */
export function resolveApproval(
  db: DatabaseSync,
  approvalId: string,
  status: 'approved' | 'rejected',
): boolean {
  const now = new Date().toISOString()

  try {
    const result = db.prepare(`
      UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?
      WHERE approval_id = ? AND status = 'pending'
    `).run(status, now, 'telegram', null, approvalId)

    if ((result as { changes: number }).changes === 0) return false

    // Write audit log entry
    db.prepare(`
      INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), 'user', 'telegram', `approval.${status}`, 'approval', approvalId, '{}', now)

    return true
  } catch {
    return false
  }
}

export function formatApprovalMessage(entry: ApprovalEntry): string {
  const preview = entry.payload.length > 300 ? entry.payload.slice(0, 300) + '...' : entry.payload
  return `⚠️ APPROVAL NEEDED\nAgent: ${entry.agent}\nAction: ${entry.action}\n\n${preview}\n\nReply:\n/approve ${entry.id.slice(0, 8)}\n/reject ${entry.id.slice(0, 8)}`
}
