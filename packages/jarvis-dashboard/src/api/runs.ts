import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import os from 'os'
import { join } from 'path'
import { RunStore } from '@jarvis/runtime'

function getRuntimeDb() {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const runsRouter = Router()

// GET / — list recent runs from runtime.db, paginated, optional agent filter
runsRouter.get('/', (req, res) => {
  const { agent, limit = '50', offset = '0' } = req.query as {
    agent?: string; limit?: string; offset?: string
  }
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    let sql = 'SELECT * FROM runs WHERE 1=1'
    const params: SQLInputValue[] = []
    if (agent && agent !== 'all') {
      sql += ' AND agent_id = ?'
      params.push(agent)
    }
    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), Number(offset))
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
    res.json(rows)
  } catch {
    res.json([])
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /active — currently running or approval-blocked runs
runsRouter.get('/active', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const rows = db.prepare(
      `SELECT * FROM runs WHERE status IN ('planning', 'executing', 'awaiting_approval') ORDER BY started_at DESC`
    ).all() as Record<string, unknown>[]
    res.json(rows)
  } catch {
    res.json([])
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /failed — recent failures and cancellations
runsRouter.get('/failed', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const rows = db.prepare(
      `SELECT * FROM runs WHERE status IN ('failed', 'cancelled') ORDER BY completed_at DESC LIMIT 50`
    ).all() as Record<string, unknown>[]
    res.json(rows)
  } catch {
    res.json([])
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /:runId — full run detail with events from runtime.db
runsRouter.get('/:runId', (req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId) as Record<string, unknown> | undefined
    if (!run) {
      res.status(404).json({ error: 'Run not found' })
      return
    }
    const events = db.prepare(
      'SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC'
    ).all(req.params.runId)
    res.json({ ...run, events })
  } catch {
    res.status(500).json({ error: 'Database error' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// POST /:runId/retry — retry a failed run by queuing a new command for the same agent
runsRouter.post('/:runId/retry', (req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId) as
      { run_id: string; agent_id: string; status: string } | undefined

    if (!run) {
      res.status(404).json({ error: 'Run not found' })
      return
    }
    if (run.status !== 'failed' && run.status !== 'cancelled') {
      res.status(400).json({ error: `Cannot retry run in status '${run.status}' — only failed or cancelled runs can be retried` })
      return
    }

    const commandId = randomUUID()
    db.prepare(`
      INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key)
      VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?, 'dashboard', ?)
    `).run(
      commandId,
      run.agent_id,
      JSON.stringify({ retry_of: run.run_id }),
      new Date().toISOString(),
      `retry-${run.run_id}-${Date.now()}`
    )
    res.json({ ok: true, command_id: commandId, agent_id: run.agent_id })
  } catch {
    res.status(500).json({ error: 'Failed to queue retry command' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// POST /:runId/cancel — cancel a non-terminal run
runsRouter.post('/:runId/cancel', (req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId) as
      { run_id: string; agent_id: string; status: string } | undefined

    if (!run) {
      res.status(404).json({ error: 'Run not found' })
      return
    }

    const terminalStatuses = ['completed', 'failed', 'cancelled']
    if (terminalStatuses.includes(run.status)) {
      res.status(400).json({ error: `Run is already in terminal status '${run.status}'` })
      return
    }

    const runStore = new RunStore(db)
    runStore.transition(run.run_id, run.agent_id, 'cancelled', 'run_cancelled', {
      details: { reason: 'operator_cancel' }
    })
    // Also complete the associated command so it doesn't get re-claimed
    runStore.completeCommand(run.run_id, 'cancelled')

    // Note: The live orchestrator checks durable status before each step and will
    // detect the cancellation at its next checkpoint. The current step may still
    // complete, but no further steps will execute.
    res.json({ ok: true, run_id: run.run_id, status: 'cancelled', note: 'The current step may still complete; no further steps will execute.' })
  } catch {
    res.status(500).json({ error: 'Failed to cancel run' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
