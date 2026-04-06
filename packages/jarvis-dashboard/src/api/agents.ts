import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import os from 'os'
import { join } from 'path'

function getRuntimeDb() {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

function getKnowledgeDb() {
  return new DatabaseSync(join(os.homedir(), '.jarvis', 'knowledge.db'))
}

const AGENT_META: Record<string, { label: string; description: string; schedule: string }> = {
  'bd-pipeline': {
    label: 'BD Pipeline',
    description: 'Scan for BD signals, enrich leads, draft outreach, update CRM',
    schedule: 'Weekdays at 8:00 AM'
  },
  'proposal-engine': {
    label: 'Proposal Engine',
    description: 'Analyze RFQ/SOW, build quote structure, draft proposal',
    schedule: 'On demand'
  },
  'evidence-auditor': {
    label: 'Evidence Auditor',
    description: 'Scan project for ISO 26262 work products, produce gap matrix',
    schedule: 'Mondays at 9:00 AM'
  },
  'contract-reviewer': {
    label: 'Contract Reviewer',
    description: 'Analyze NDA/MSA clauses, produce sign/negotiate/escalate recommendation',
    schedule: 'On demand'
  },
  'staffing-monitor': {
    label: 'Staffing Monitor',
    description: 'Calculate team utilization, forecast gaps, match skills to pipeline',
    schedule: 'Mondays at 9:00 AM'
  },
  'content-engine': {
    label: 'Content Engine',
    description: 'Draft LinkedIn post for today\'s content pillar',
    schedule: 'Mon/Wed/Thu at 7:00 AM'
  },
  'portfolio-monitor': {
    label: 'Portfolio Monitor',
    description: 'Check crypto prices, calculate drift, recommend rebalance',
    schedule: 'Daily at 8:00 AM & 8:00 PM'
  },
  'garden-calendar': {
    label: 'Garden Calendar',
    description: 'Generate weekly garden brief based on date + weather',
    schedule: 'Mondays at 7:00 AM'
  }
}

const AGENT_IDS = Object.keys(AGENT_META)

export const agentsRouter = Router()

// GET / — list agents with last run from runtime.db runs table
agentsRouter.get('/', (_req, res) => {
  let lastRuns: Record<string, Record<string, unknown>> = {}
  try {
    const db = getRuntimeDb()
    const rows = db.prepare(
      `SELECT * FROM runs r1
       WHERE started_at = (
         SELECT MAX(started_at) FROM runs r2 WHERE r2.agent_id = r1.agent_id
       )`
    ).all() as Record<string, unknown>[]
    db.close()
    for (const row of rows) {
      if (typeof row.agent_id === 'string') {
        lastRuns[row.agent_id] = row
      }
    }
  } catch {
    // runtime.db may not exist yet
  }

  const agents = AGENT_IDS.map(id => {
    const meta = AGENT_META[id]
    const last = lastRuns[id]
    return {
      agentId: id,
      label: meta.label,
      description: meta.description,
      schedule: meta.schedule,
      lastRun: last?.started_at ?? null,
      lastOutcome: last?.status ?? null,
      lastStep: last?.current_step ?? null
    }
  })
  res.json(agents)
})

// GET /decisions?agent=&limit=50&offset=0 — paginated decisions log (still from knowledge.db — decisions are knowledge artifacts)
agentsRouter.get('/decisions', (req, res) => {
  const { agent, limit = '50', offset = '0' } = req.query as { agent?: string; limit?: string; offset?: string }
  try {
    const db = getKnowledgeDb()
    let sql = 'SELECT * FROM decisions WHERE 1=1'
    const params: (string | number)[] = []
    if (agent && agent !== 'all') {
      sql += ' AND agent_id = ?'
      params.push(agent)
    }
    sql += ' ORDER BY decision_id DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), Number(offset))
    const rows = db.prepare(sql).all(...params)
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// POST /:agentId/trigger — insert command into agent_commands in runtime.db
agentsRouter.post('/:agentId/trigger', (req, res) => {
  const { agentId } = req.params
  if (!AGENT_IDS.includes(agentId)) {
    res.status(400).json({ error: `Unknown agent: ${agentId}` })
    return
  }
  const db = getRuntimeDb()
  try {
    const commandId = randomUUID()
    db.prepare(`
      INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key)
      VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?, 'dashboard', ?)
    `).run(
      commandId,
      agentId,
      JSON.stringify({ triggered_by: 'dashboard' }),
      new Date().toISOString(),
      `dashboard-${agentId}-${Date.now()}`
    )
    res.json({ ok: true, command_id: commandId })
  } catch {
    res.status(500).json({ error: 'Failed to queue agent command' })
  } finally {
    try { db.close() } catch {}
  }
})
