/**
 * tasks.ts — Unified operator task visibility (Epic 4).
 *
 * Aggregates runs, jobs, approvals, and flow state into a single
 * UnifiedTask shape. Operators see the same work from chat and dashboard.
 *
 * Routes:
 *   GET /api/tasks          — list tasks (filterable)
 *   GET /api/tasks/:id      — task detail with job graph and approvals
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

// ---- Types ----------------------------------------------------------------

export type TaskSource = 'schedule' | 'webhook' | 'command' | 'operator'

export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'executing'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'

export interface UnifiedTask {
  task_id: string
  agent_id: string
  source: TaskSource
  status: TaskStatus
  started_at: string
  updated_at: string
  jobs_total: number
  jobs_completed: number
  pending_approvals: number
  flow_id?: string
  provenance?: { channel: string; trigger_type: string }
}

export interface TaskDetail extends UnifiedTask {
  jobs: Array<{
    job_id: string
    type: string
    status: string
    claimed_at?: string
    completed_at?: string
  }>
  approvals: Array<{
    approval_id: string
    action: string
    status: string
    created_at: string
  }>
}

// ---- Helpers ---------------------------------------------------------------

const JARVIS_DIR = join(homedir(), '.jarvis')
const RUNTIME_DB = join(JARVIS_DIR, 'runtime.db')

function openDb(): DatabaseSync | null {
  if (!existsSync(RUNTIME_DB)) return null
  const db = new DatabaseSync(RUNTIME_DB)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  return db
}

function mapRunStatus(status: string): TaskStatus {
  switch (status) {
    case 'queued': return 'queued'
    case 'planning': return 'planning'
    case 'running':
    case 'executing': return 'executing'
    case 'awaiting_approval': return 'awaiting_approval'
    case 'completed':
    case 'succeeded': return 'completed'
    case 'failed':
    case 'errored': return 'failed'
    default: return 'queued'
  }
}

function inferSource(row: Record<string, unknown>): TaskSource {
  const src = String(row.source ?? row.trigger_type ?? '')
  if (src.includes('schedule') || src.includes('cron')) return 'schedule'
  if (src.includes('webhook')) return 'webhook'
  if (src.includes('operator') || src.includes('godmode') || src.includes('chat')) return 'operator'
  return 'command'
}

// ---- Router ----------------------------------------------------------------

export const tasksRouter = Router()

tasksRouter.get('/', (_req: Request, res: Response) => {
  const db = openDb()
  if (!db) {
    res.json({ tasks: [], message: 'runtime.db not found' })
    return
  }

  try {
    const { status, agent_id, since, limit: limitStr } = _req.query as Record<string, string | undefined>
    const pageLimit = Math.min(Number(limitStr) || 50, 200)

    // Build query with optional filters
    const conditions: string[] = []
    const params: unknown[] = []

    if (status) {
      conditions.push('r.status = ?')
      params.push(status)
    }
    if (agent_id) {
      conditions.push('r.agent_id = ?')
      params.push(agent_id)
    }
    if (since) {
      conditions.push('r.created_at >= ?')
      params.push(since)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT
        r.run_id,
        r.agent_id,
        r.status,
        r.created_at,
        r.updated_at,
        r.source,
        r.trigger_type,
        (SELECT COUNT(*) FROM jobs j WHERE j.run_id = r.run_id) as jobs_total,
        (SELECT COUNT(*) FROM jobs j WHERE j.run_id = r.run_id AND j.status IN ('completed','succeeded')) as jobs_completed,
        (SELECT COUNT(*) FROM approvals a WHERE a.run_id = r.run_id AND a.status = 'pending') as pending_approvals
      FROM runs r
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(...params, pageLimit) as Array<Record<string, unknown>>

    const tasks: UnifiedTask[] = rows.map((row) => ({
      task_id: String(row.run_id),
      agent_id: String(row.agent_id ?? ''),
      source: inferSource(row),
      status: mapRunStatus(String(row.status ?? 'queued')),
      started_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? row.created_at ?? ''),
      jobs_total: Number(row.jobs_total ?? 0),
      jobs_completed: Number(row.jobs_completed ?? 0),
      pending_approvals: Number(row.pending_approvals ?? 0),
    }))

    res.json({ tasks })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
})

tasksRouter.get('/:id', (req: Request, res: Response) => {
  const db = openDb()
  if (!db) {
    res.status(404).json({ error: 'runtime.db not found' })
    return
  }

  try {
    const { id } = req.params

    const row = db.prepare(`
      SELECT run_id, agent_id, status, created_at, updated_at, source, trigger_type
      FROM runs WHERE run_id = ?
    `).get(id) as Record<string, unknown> | undefined

    if (!row) {
      res.status(404).json({ error: 'Task not found' })
      return
    }

    const jobs = db.prepare(`
      SELECT job_id, type, status, claimed_at, completed_at
      FROM jobs WHERE run_id = ? ORDER BY created_at
    `).all(id) as Array<Record<string, unknown>>

    const approvals = db.prepare(`
      SELECT approval_id, action, status, created_at
      FROM approvals WHERE run_id = ? ORDER BY created_at
    `).all(id) as Array<Record<string, unknown>>

    const detail: TaskDetail = {
      task_id: String(row.run_id),
      agent_id: String(row.agent_id ?? ''),
      source: inferSource(row),
      status: mapRunStatus(String(row.status ?? 'queued')),
      started_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? row.created_at ?? ''),
      jobs_total: jobs.length,
      jobs_completed: jobs.filter((j) => ['completed', 'succeeded'].includes(String(j.status))).length,
      pending_approvals: approvals.filter((a) => a.status === 'pending').length,
      jobs: jobs.map((j) => ({
        job_id: String(j.job_id),
        type: String(j.type ?? ''),
        status: String(j.status ?? ''),
        claimed_at: j.claimed_at ? String(j.claimed_at) : undefined,
        completed_at: j.completed_at ? String(j.completed_at) : undefined,
      })),
      approvals: approvals.map((a) => ({
        approval_id: String(a.approval_id),
        action: String(a.action ?? ''),
        status: String(a.status ?? ''),
        created_at: String(a.created_at ?? ''),
      })),
    }

    res.json(detail)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
})
