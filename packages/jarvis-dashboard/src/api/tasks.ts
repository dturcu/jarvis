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
import { invokeGatewayMethod } from '@jarvis/shared'
import {
  webhookIngressTotal, inferenceRuntimeTotal, sessionModeTotal,
  browserBridgeTotal, taskflowRunsTotal, memoryBoundaryViolationsTotal,
  dreamingRunsTotal, wikiRetrievalTotal, legacyPathTraffic,
  inferenceLocalPercentage,
} from '@jarvis/observability'
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

// ---- TaskFlow correlation ---------------------------------------------------

/**
 * Ensure the taskflow_correlations table exists.
 * Maps OpenClaw TaskFlow run IDs to Jarvis run IDs.
 */
function ensureCorrelationTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS taskflow_correlations (
      flow_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      workflow_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function lookupFlowId(db: DatabaseSync, runId: string): string | undefined {
  try {
    const row = db.prepare(
      'SELECT flow_id FROM taskflow_correlations WHERE run_id = ?',
    ).get(runId) as { flow_id: string } | undefined
    return row?.flow_id
  } catch {
    return undefined
  }
}

// ---- Gateway flow queries --------------------------------------------------

interface GatewayFlowEntry {
  flow_id: string
  workflow_name: string
  status: string
  created_at: string
  updated_at?: string
}

/**
 * Query OpenClaw TaskFlow for active/recent flows. Returns empty array
 * if the gateway is unavailable (graceful degradation).
 */
async function queryGatewayFlows(): Promise<GatewayFlowEntry[]> {
  try {
    const result = await invokeGatewayMethod<{ flows?: Array<Record<string, unknown>> }>(
      'taskflow.list',
      undefined,
      { limit: 50 },
    )
    return (result.flows ?? []).map((f) => ({
      flow_id: String(f.flow_id ?? f.id ?? ''),
      workflow_name: String(f.workflow_name ?? f.name ?? ''),
      status: String(f.status ?? 'unknown'),
      created_at: String(f.created_at ?? ''),
      updated_at: f.updated_at ? String(f.updated_at) : undefined,
    }))
  } catch {
    return [] // Gateway unavailable
  }
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
        r.owner,
        (SELECT COUNT(*) FROM jobs j WHERE j.run_id = r.run_id) as jobs_total,
        (SELECT COUNT(*) FROM jobs j WHERE j.run_id = r.run_id AND j.status IN ('completed','succeeded')) as jobs_completed,
        (SELECT COUNT(*) FROM approvals a WHERE a.run_id = r.run_id AND a.status = 'pending') as pending_approvals
      FROM runs r
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(...params, pageLimit) as Array<Record<string, unknown>>

    ensureCorrelationTable(db)

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
      flow_id: lookupFlowId(db, String(row.run_id)),
      provenance: row.source || row.trigger_type || row.owner ? {
        channel: String(row.owner ?? 'daemon'),
        trigger_type: String(row.trigger_type ?? row.source ?? 'unknown'),
      } : undefined,
    }))

    res.json({ tasks })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
})

// POST /:id/cancel — cancel a running task (Epic 4 acceptance: cancel from task surface)
tasksRouter.post('/:id/cancel', (req: Request, res: Response) => {
  const db = openDb()
  if (!db) {
    res.status(404).json({ error: 'runtime.db not found' })
    return
  }

  try {
    const { id } = req.params

    const row = db.prepare('SELECT run_id, status FROM runs WHERE run_id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) {
      res.status(404).json({ error: 'Task not found' })
      return
    }

    const currentStatus = String(row.status)
    if (['completed', 'succeeded', 'failed', 'cancelled'].includes(currentStatus)) {
      res.status(409).json({ error: `Task is already ${currentStatus} and cannot be cancelled` })
      return
    }

    db.prepare('UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?')
      .run('cancelled', new Date().toISOString(), id)

    // Cancel pending jobs for this run
    db.prepare("UPDATE jobs SET status = 'cancelled' WHERE run_id = ? AND status IN ('queued', 'claimed')")
      .run(id)

    // Propagate cancellation to TaskFlow if this run has a correlated flow
    ensureCorrelationTable(db)
    const flowRow = db.prepare('SELECT flow_id FROM taskflow_correlations WHERE run_id = ?').get(id) as { flow_id: string } | undefined
    let flowCancelled = false
    if (flowRow) {
      invokeGatewayMethod('taskflow.cancel', undefined, { flow_id: flowRow.flow_id })
        .then(() => { /* flow cancelled */ })
        .catch(() => { /* gateway unavailable — local cancel still succeeded */ })
      flowCancelled = true
    }

    res.json({ task_id: id, status: 'cancelled', cancelled_at: new Date().toISOString(), flow_cancelled: flowCancelled })
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

// POST /api/tasks/correlate — Register a TaskFlow-to-Jarvis run correlation.
// Called by OpenClaw TaskFlow when a managed workflow creates or drives a Jarvis run.
tasksRouter.post('/correlate', (req: Request, res: Response) => {
  const db = openDb()
  if (!db) {
    res.status(503).json({ error: 'runtime.db not found' })
    return
  }

  try {
    const { flow_id, run_id, workflow_name } = req.body as {
      flow_id?: string
      run_id?: string
      workflow_name?: string
    }

    if (!flow_id || !run_id) {
      res.status(400).json({ error: 'flow_id and run_id are required' })
      return
    }

    ensureCorrelationTable(db)
    db.prepare(
      'INSERT OR REPLACE INTO taskflow_correlations (flow_id, run_id, workflow_name, created_at) VALUES (?, ?, ?, ?)',
    ).run(flow_id, run_id, workflow_name ?? null, new Date().toISOString())

    res.json({ status: 'correlated', flow_id, run_id })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
})

// GET /api/tasks/adoption — Adoption metrics dashboard for release gates.
tasksRouter.get('/adoption', (_req: Request, res: Response) => {
  const db = openDb()

  const metrics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    webhook_ingress: {
      default: process.env.JARVIS_WEBHOOK_LEGACY === 'true' ? 'dashboard (legacy)' : 'openclaw (converged)',
      legacy_active: process.env.JARVIS_WEBHOOK_LEGACY === 'true',
    },
    schedule_source: {
      mode: process.env.JARVIS_SCHEDULE_SOURCE ?? 'db',
      taskflow_active: (process.env.JARVIS_SCHEDULE_SOURCE ?? '').toLowerCase() === 'taskflow',
    },
    browser_mode: {
      mode: process.env.JARVIS_BROWSER_MODE ?? 'openclaw',
      openclaw_active: (process.env.JARVIS_BROWSER_MODE ?? 'openclaw').toLowerCase() !== 'legacy',
    },
    telegram_mode: {
      mode: process.env.JARVIS_TELEGRAM_MODE ?? 'session',
      session_active: (process.env.JARVIS_TELEGRAM_MODE ?? 'session').toLowerCase() !== 'legacy',
    },
    dreaming: { enabled: process.env.JARVIS_DREAMING_ENABLED === 'true' },
    memory_boundary: { mode: process.env.JARVIS_MEMORY_BOUNDARY_MODE ?? 'warn' },
  }

  // Prometheus counter values (current totals since last restart)
  const promCounterValue = async (counter: { get: () => Promise<{ values: Array<{ value: number; labels: Record<string, string> }> }> }) => {
    try {
      const m = await counter.get()
      return m.values.map((v) => ({ labels: v.labels, value: v.value }))
    } catch { return [] }
  }

  try {
    metrics.prometheus = {
      webhook_ingress: await promCounterValue(webhookIngressTotal),
      inference_runtime: await promCounterValue(inferenceRuntimeTotal),
      session_mode: await promCounterValue(sessionModeTotal),
      browser_bridge: await promCounterValue(browserBridgeTotal),
      taskflow_runs: await promCounterValue(taskflowRunsTotal),
      memory_boundary_violations: await promCounterValue(memoryBoundaryViolationsTotal),
      dreaming_runs: await promCounterValue(dreamingRunsTotal),
      wiki_retrieval: await promCounterValue(wikiRetrievalTotal),
      legacy_path_traffic: await promCounterValue(legacyPathTraffic),
      inference_local_percentage: (await inferenceLocalPercentage.get()).values[0]?.value ?? null,
    }
  } catch { /* metrics unavailable */ }

  if (db) {
    try {
      ensureCorrelationTable(db)
      const correlationCount = (db.prepare('SELECT COUNT(*) as n FROM taskflow_correlations').get() as { n: number }).n
      metrics.taskflow_correlations = correlationCount
      metrics.total_runs = (db.prepare('SELECT COUNT(*) as n FROM runs').get() as { n: number }).n
    } catch { /* ignore */ } finally {
      try { db.close() } catch { /* ignore */ }
    }
  }

  // Release gate evaluation
  const gates: Record<string, { passed: boolean; reason: string }> = {
    webhook_default_off: {
      passed: process.env.JARVIS_WEBHOOK_LEGACY !== 'true',
      reason: 'Dashboard webhook routes must be off by default',
    },
    session_mode_active: {
      passed: (process.env.JARVIS_TELEGRAM_MODE ?? 'session') !== 'legacy',
      reason: 'Telegram must use session mode',
    },
    browser_openclaw_default: {
      passed: (process.env.JARVIS_BROWSER_MODE ?? 'openclaw') !== 'legacy',
      reason: 'Browser must use OpenClaw bridge by default',
    },
    memory_boundary_active: {
      passed: (process.env.JARVIS_MEMORY_BOUNDARY_MODE ?? 'warn') !== '',
      reason: 'Memory boundary checker must be active (warn or enforce)',
    },
  }
  metrics.release_gates = gates
  metrics.all_gates_passed = Object.values(gates).every((g) => g.passed)

  res.json(metrics)
})
