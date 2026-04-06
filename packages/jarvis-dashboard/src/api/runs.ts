import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import os from 'os'
import { join } from 'path'

function getDb() {
  return new DatabaseSync(join(os.homedir(), '.jarvis', 'knowledge.db'))
}

export const runsRouter = Router()

// GET / — list recent runs, paginated, optional agent filter
runsRouter.get('/', (req, res) => {
  const { agent, limit = '50', offset = '0' } = req.query as {
    agent?: string; limit?: string; offset?: string
  }
  try {
    const db = getDb()
    let sql = 'SELECT * FROM agent_runs WHERE 1=1'
    const params: SQLInputValue[] = []
    if (agent && agent !== 'all') {
      sql += ' AND agent_id = ?'
      params.push(agent)
    }
    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), Number(offset))
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
    db.close()
    // Parse plan_json for each row
    const runs = rows.map(r => {
      let plan = null
      if (r.plan_json && typeof r.plan_json === 'string') {
        try { plan = JSON.parse(r.plan_json) } catch {}
      }
      return { ...r, plan }
    })
    res.json(runs)
  } catch {
    res.json([])
  }
})

// GET /:runId — full run detail with parsed plan + decisions
runsRouter.get('/:runId', (req, res) => {
  try {
    const db = getDb()
    const run = db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(req.params.runId) as Record<string, unknown> | undefined
    if (!run) {
      db.close()
      res.status(404).json({ error: 'Run not found' })
      return
    }
    let plan = null
    if (run.plan_json && typeof run.plan_json === 'string') {
      try { plan = JSON.parse(run.plan_json as string) } catch {}
    }
    // Get decisions for this run
    const decisions = db.prepare(
      'SELECT * FROM decisions WHERE run_id = ? ORDER BY decision_id ASC'
    ).all(req.params.runId)
    db.close()
    res.json({ ...run, plan, decisions })
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})
