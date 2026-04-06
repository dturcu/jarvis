import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import { configureJarvisStatePersistence, getJarvisState } from '@jarvis/shared'

const RUNTIME_DB_PATH = join(os.homedir(), '.jarvis', 'runtime.sqlite')

// Ensure JarvisState is configured for this process
configureJarvisStatePersistence({ databasePath: RUNTIME_DB_PATH })

function getKnowledgeDb() {
  return new DatabaseSync(join(os.homedir(), '.jarvis', 'knowledge.db'))
}

export const runsRouter = Router()

// GET / — list recent runs from JarvisState, with optional agent filter
runsRouter.get('/', (req, res) => {
  const { agent, limit = '50', offset = '0', status } = req.query as {
    agent?: string; limit?: string; offset?: string; status?: string
  }
  try {
    const state = getJarvisState()
    const db = (state as unknown as { db: DatabaseSync }).db
    if (!db) {
      res.json([])
      return
    }

    let sql = `SELECT job_id, job_type, status, updated_at, record_json FROM jobs WHERE job_type = 'agent.start'`
    const params: (string | number)[] = []

    if (agent && agent !== 'all') {
      // Filter by agent_id in the record JSON — use the record_json column
      sql += ` AND record_json LIKE ?`
      params.push(`%"agent_id":"${agent}"%`)
    }
    if (status) {
      sql += ` AND status = ?`
      params.push(status)
    }
    sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    params.push(Number(limit), Number(offset))

    const rows = db.prepare(sql).all(...params) as Array<{
      job_id: string; job_type: string; status: string; updated_at: string; record_json: string
    }>

    const runs = rows.map(row => {
      try {
        const record = JSON.parse(row.record_json) as {
          envelope: { input: Record<string, unknown>; metadata: Record<string, unknown> };
          result: { summary: string; structured_output?: Record<string, unknown>; metrics?: Record<string, unknown>; error?: Record<string, unknown> };
          claim?: { claimed_by?: string; last_heartbeat_at?: string } | null;
        }
        return {
          run_id: row.job_id,
          agent_id: record.envelope?.input?.agent_id ?? 'unknown',
          status: row.status,
          trigger_kind: record.envelope?.input?.trigger_kind ?? 'manual',
          started_at: record.result?.metrics?.started_at ?? row.updated_at,
          completed_at: record.result?.metrics?.finished_at ?? null,
          updated_at: row.updated_at,
          summary: record.result?.summary ?? '',
          error: record.result?.error ?? null,
          plan: record.result?.structured_output?.plan ?? null,
          steps_completed: record.result?.structured_output?.steps_completed ?? 0,
          total_steps: record.result?.structured_output?.total_steps ?? 0,
          worker_id: record.claim?.claimed_by ?? record.result?.metrics?.worker_id ?? null,
        }
      } catch {
        return {
          run_id: row.job_id,
          agent_id: 'unknown',
          status: row.status,
          updated_at: row.updated_at,
          summary: '',
        }
      }
    })

    res.json(runs)
  } catch {
    res.json([])
  }
})

// GET /active — list currently running or approval-blocked jobs
runsRouter.get('/active', (_req, res) => {
  try {
    const state = getJarvisState()
    const db = (state as unknown as { db: DatabaseSync }).db
    if (!db) {
      res.json([])
      return
    }

    const rows = db.prepare(`
      SELECT job_id, job_type, status, updated_at, record_json
      FROM jobs
      WHERE status IN ('running', 'awaiting_approval')
      ORDER BY updated_at DESC
    `).all() as Array<{ job_id: string; status: string; updated_at: string; record_json: string }>

    const runs = rows.map(row => {
      try {
        const record = JSON.parse(row.record_json)
        return {
          run_id: row.job_id,
          agent_id: record.envelope?.input?.agent_id ?? 'unknown',
          status: row.status,
          started_at: record.result?.metrics?.started_at ?? row.updated_at,
          summary: record.result?.summary ?? '',
          worker_id: record.claim?.claimed_by ?? null,
          last_heartbeat: record.claim?.last_heartbeat_at ?? null,
        }
      } catch {
        return { run_id: row.job_id, status: row.status, updated_at: row.updated_at }
      }
    })

    res.json(runs)
  } catch {
    res.json([])
  }
})

// GET /failed — list failed and cancelled jobs
runsRouter.get('/failed', (_req, res) => {
  try {
    const state = getJarvisState()
    const db = (state as unknown as { db: DatabaseSync }).db
    if (!db) {
      res.json([])
      return
    }

    const rows = db.prepare(`
      SELECT job_id, job_type, status, updated_at, record_json
      FROM jobs
      WHERE status IN ('failed', 'cancelled')
      ORDER BY updated_at DESC
      LIMIT 50
    `).all() as Array<{ job_id: string; status: string; updated_at: string; record_json: string }>

    const runs = rows.map(row => {
      try {
        const record = JSON.parse(row.record_json)
        return {
          run_id: row.job_id,
          agent_id: record.envelope?.input?.agent_id ?? 'unknown',
          status: row.status,
          error: record.result?.error ?? null,
          summary: record.result?.summary ?? '',
          finished_at: record.result?.metrics?.finished_at ?? row.updated_at,
        }
      } catch {
        return { run_id: row.job_id, status: row.status, updated_at: row.updated_at }
      }
    })

    res.json(runs)
  } catch {
    res.json([])
  }
})

// POST /:jobId/retry — retry a failed job
runsRouter.post('/:jobId/retry', (req, res) => {
  try {
    const result = getJarvisState().retryJob(req.params.jobId)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// POST /:jobId/cancel — cancel a job
runsRouter.post('/:jobId/cancel', (req, res) => {
  try {
    const result = getJarvisState().cancelJob(req.params.jobId, 'Cancelled by operator')
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// GET /:runId — full run detail (falls back to knowledge.db for decisions)
runsRouter.get('/:runId', (req, res) => {
  try {
    // Try JarvisState first
    const jobResponse = getJarvisState().getJob(req.params.runId)
    if (jobResponse.status !== 'failed' || jobResponse.error?.code !== 'JOB_NOT_FOUND') {
      // Get decisions from knowledge.db for this run
      let decisions: unknown[] = []
      try {
        const kdb = getKnowledgeDb()
        decisions = kdb.prepare(
          'SELECT * FROM decisions WHERE run_id = ? ORDER BY decision_id ASC'
        ).all(req.params.runId)
        kdb.close()
      } catch { /* no decisions yet */ }

      res.json({
        ...jobResponse,
        decisions,
      })
      return
    }

    // Fall back to knowledge.db agent_runs (legacy)
    const kdb = getKnowledgeDb()
    const run = kdb.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(req.params.runId) as Record<string, unknown> | undefined
    if (!run) {
      kdb.close()
      res.status(404).json({ error: 'Run not found' })
      return
    }
    let plan = null
    if (run.plan_json && typeof run.plan_json === 'string') {
      try { plan = JSON.parse(run.plan_json as string) } catch {}
    }
    const decisions = kdb.prepare(
      'SELECT * FROM decisions WHERE run_id = ? ORDER BY decision_id ASC'
    ).all(req.params.runId)
    kdb.close()
    res.json({ ...run, plan, decisions })
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})
