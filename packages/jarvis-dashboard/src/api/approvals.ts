import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import { listApprovals, resolveApproval } from '@jarvis/runtime'
import type { ApprovalEntry } from '@jarvis/runtime'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'

function getDb(): DatabaseSync {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

const APPROVAL_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours

const riskMap: Record<string, { level: string; label: string; reversible: boolean }> = {
  info: { level: 'low', label: 'Low risk — informational', reversible: true },
  warning: { level: 'medium', label: 'Review recommended', reversible: true },
  critical: { level: 'high', label: 'Irreversible action', reversible: false },
};

type LinkedRun = {
  run_id: string;
  agent_id: string;
  status: string;
  goal: string;
  current_step: number | null;
  total_steps: number | null;
};

function enrichApprovals(db: DatabaseSync, approvals: ApprovalEntry[]) {
  const runStmt = db.prepare(
    'SELECT run_id, agent_id, status, goal, current_step, total_steps FROM runs WHERE run_id = ?'
  );

  return approvals.map(approval => {
    // a) Risk assessment from severity
    const risk = riskMap[approval.severity] ?? riskMap['info'];

    // b) Linked run info
    let linked_run: LinkedRun | null = null;
    if (approval.run_id) {
      try {
        linked_run = (runStmt.get(approval.run_id) as LinkedRun | undefined) ?? null;
      } catch { /* best-effort */ }
    }

    // c) Timeout info
    const createdAt = new Date(approval.created_at);
    const timeoutAt = new Date(createdAt.getTime() + APPROVAL_TIMEOUT_MS);
    const timeRemaining = Math.max(0, timeoutAt.getTime() - Date.now());

    return {
      ...approval,
      risk,
      linked_run,
      timeout_at: timeoutAt.toISOString(),
      time_remaining_ms: timeRemaining,
      what_happens_if_nothing: 'Will expire after 4 hours. The run will fail immediately.',
    };
  });
}

export const approvalsRouter = Router()

// GET / — list approvals (optionally ?status=pending)
approvalsRouter.get('/', (req, res) => {
  const { status } = req.query as { status?: string }
  const db = getDb()
  try {
    const validStatuses = ['pending', 'approved', 'rejected'] as const
    const filter = validStatuses.includes(status as typeof validStatuses[number])
      ? (status as 'pending' | 'approved' | 'rejected')
      : undefined
    const approvals = listApprovals(db, filter)
    res.json(enrichApprovals(db, approvals))
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
})

// POST /:id/approve — set status=approved
approvalsRouter.post('/:id/approve', (req, res) => {
  const db = getDb()
  try {
    const ok = resolveApproval(db, req.params.id!, 'approved', 'dashboard')
    if (!ok) {
      res.status(404).json({ error: 'Approval not found or already resolved' })
      return
    }
    // Note: resolveApproval() already writes an audit_log entry atomically — no duplicate here
    // Return enriched response (consistent with GET /)
    const approvals = listApprovals(db)
    const enriched = enrichApprovals(db, approvals)
    const entry = enriched.find(a => a.id === req.params.id)
    res.json(entry)
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
})

// POST /:id/reject — set status=rejected
approvalsRouter.post('/:id/reject', (req, res) => {
  const db = getDb()
  try {
    const ok = resolveApproval(db, req.params.id!, 'rejected', 'dashboard')
    if (!ok) {
      res.status(404).json({ error: 'Approval not found or already resolved' })
      return
    }
    // Note: resolveApproval() already writes an audit_log entry atomically — no duplicate here
    const approvals = listApprovals(db)
    const enriched = enrichApprovals(db, approvals)
    const entry = enriched.find(a => a.id === req.params.id)
    res.json(entry)
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
})
