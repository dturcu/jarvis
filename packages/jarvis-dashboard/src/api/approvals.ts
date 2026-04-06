import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import { configureJarvisStatePersistence, getJarvisState } from '@jarvis/shared'
import fs from 'fs'

const RUNTIME_DB_PATH = join(os.homedir(), '.jarvis', 'runtime.sqlite')

// Ensure JarvisState is configured for this process
configureJarvisStatePersistence({ databasePath: RUNTIME_DB_PATH })

// Legacy approvals file path — used as fallback during migration
const legacyApprovalsPath = join(os.homedir(), '.jarvis', 'approvals.json')

export const approvalsRouter = Router()

// GET / — list approvals from JarvisState (optionally ?status=pending)
approvalsRouter.get('/', (req, res) => {
  const { status } = req.query as { status?: string }

  try {
    const state = getJarvisState()
    const db = (state as unknown as { db: DatabaseSync }).db
    if (!db) {
      res.json([])
      return
    }

    let sql = 'SELECT approval_id, state, created_at, updated_at, record_json FROM approvals'
    const params: string[] = []
    if (status) {
      sql += ' WHERE state = ?'
      params.push(status)
    }
    sql += ' ORDER BY created_at DESC'

    const rows = db.prepare(sql).all(...params) as Array<{
      approval_id: string; state: string; created_at: string; updated_at: string; record_json: string
    }>

    const approvals = rows.map(row => {
      try {
        const record = JSON.parse(row.record_json) as Record<string, unknown>
        return {
          id: row.approval_id,
          status: row.state,
          ...record,
        }
      } catch {
        return {
          id: row.approval_id,
          status: row.state,
          created_at: row.created_at,
        }
      }
    })

    // Also include legacy approvals for backward compatibility
    let legacyApprovals: Array<{ id: string; status: string; [key: string]: unknown }> = []
    try {
      if (fs.existsSync(legacyApprovalsPath)) {
        const raw = JSON.parse(fs.readFileSync(legacyApprovalsPath, 'utf8')) as Array<{ id: string; status: string }>
        legacyApprovals = raw
          .filter(a => !status || a.status === status)
          .filter(a => !approvals.some(ja => ja.id === a.id)) // deduplicate
      }
    } catch { /* legacy file may not exist */ }

    res.json([...approvals, ...legacyApprovals])
  } catch {
    res.json([])
  }
})

// POST /:id/approve — resolve approval as approved in JarvisState
approvalsRouter.post('/:id/approve', (req, res) => {
  const approvalId = req.params.id
  try {
    // Try JarvisState first
    const result = getJarvisState().resolveApproval(approvalId, 'approved')
    if (result) {
      res.json({ id: result.approval_id, status: result.state, resolved_at: result.resolved_at })
      return
    }

    // Fall back to legacy approvals file
    if (resolveLegacyApproval(approvalId, 'approved')) {
      res.json({ id: approvalId, status: 'approved', resolved_at: new Date().toISOString() })
      return
    }

    res.status(404).json({ error: 'Approval not found' })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// POST /:id/reject — resolve approval as rejected in JarvisState
approvalsRouter.post('/:id/reject', (req, res) => {
  const approvalId = req.params.id
  try {
    // Try JarvisState first
    const result = getJarvisState().resolveApproval(approvalId, 'rejected')
    if (result) {
      res.json({ id: result.approval_id, status: result.state, resolved_at: result.resolved_at })
      return
    }

    // Fall back to legacy approvals file
    if (resolveLegacyApproval(approvalId, 'rejected')) {
      res.json({ id: approvalId, status: 'rejected', resolved_at: new Date().toISOString() })
      return
    }

    res.status(404).json({ error: 'Approval not found' })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

/** Resolve a legacy approval in the JSON file (backward compatibility) */
function resolveLegacyApproval(id: string, status: 'approved' | 'rejected'): boolean {
  try {
    if (!fs.existsSync(legacyApprovalsPath)) return false
    const approvals = JSON.parse(fs.readFileSync(legacyApprovalsPath, 'utf8')) as Array<{ id: string; status: string; [key: string]: unknown }>
    const idx = approvals.findIndex(a => a.id === id)
    if (idx === -1) return false
    approvals[idx] = { ...approvals[idx], status, resolvedAt: new Date().toISOString() }
    fs.writeFileSync(legacyApprovalsPath, JSON.stringify(approvals, null, 2))
    return true
  } catch {
    return false
  }
}
