import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import os from 'os'
import { join } from 'path'

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
  try {
    const db = getRuntimeDb()
    let sql = 'SELECT * FROM runs WHERE 1=1'
    const params: SQLInputValue[] = []
    if (agent && agent !== 'all') {
      sql += ' AND agent_id = ?'
      params.push(agent)
    }
    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), Number(offset))
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /:runId — full run detail with events from runtime.db
runsRouter.get('/:runId', (req, res) => {
  try {
    const db = getRuntimeDb()
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId) as Record<string, unknown> | undefined
    if (!run) {
      db.close()
      res.status(404).json({ error: 'Run not found' })
      return
    }
    // Get run events for this run
    const events = db.prepare(
      'SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC'
    ).all(req.params.runId)
    db.close()
    res.json({ ...run, events })
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})
