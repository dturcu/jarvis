import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import { listApprovals, resolveApproval } from '@jarvis/runtime'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'

function getDb(): DatabaseSync {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
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
    res.json(listApprovals(db, filter))
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
    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'approval.approved', 'approval', req.params.id!, {})
    const approvals = listApprovals(db)
    const entry = approvals.find(a => a.id === req.params.id)
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
    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'approval.rejected', 'approval', req.params.id!, {})
    const approvals = listApprovals(db)
    const entry = approvals.find(a => a.id === req.params.id)
    res.json(entry)
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
})
