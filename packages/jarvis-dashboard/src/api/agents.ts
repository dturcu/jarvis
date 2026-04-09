import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import { createCommand } from '@jarvis/runtime'

function getRuntimeDb() {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

function getKnowledgeDb() {
  return new DatabaseSync(join(os.homedir(), '.jarvis', 'knowledge.db'))
}

type AgentMeta = { label: string; description: string; schedule: string; pack: 'core' | 'experimental' | 'personal' }

const AGENT_META: Record<string, AgentMeta> = {
  'orchestrator': {
    label: 'Orchestrator',
    description: 'Top-level coordinator: decomposes goals into agent DAGs, manages execution, enforces approval gates, merges outputs',
    schedule: 'On demand',
    pack: 'core',
  },
  'self-reflection': {
    label: 'Self-Reflection & Improvement',
    description: 'Weekly analysis of agent performance, approval friction, and knowledge quality — produces ranked improvement proposals',
    schedule: 'Sundays at 6:00 AM',
    pack: 'core',
  },
  'regulatory-watch': {
    label: 'Regulatory Intelligence Watch',
    description: 'Tracks ISO 26262, ISO 21434, ASPICE, UNECE, and EU regulatory changes — feeds intelligence into knowledge store',
    schedule: 'Mon/Thu at 7:00 AM',
    pack: 'core',
  },
  'knowledge-curator': {
    label: 'Knowledge Curator',
    description: 'Maintains knowledge store: ingests documents and meetings, resolves entities, deduplicates, monitors collection health',
    schedule: 'Weekdays at 6:00 AM',
    pack: 'core',
  },
  'proposal-engine': {
    label: 'Proposal & Quote Engine',
    description: 'Analyzes RFQs/SOWs, builds defensible quote structures, generates proposals, handles invoicing',
    schedule: 'On demand',
    pack: 'core',
  },
  'evidence-auditor': {
    label: 'ISO 26262 / ASPICE Evidence Auditor',
    description: 'Audits project evidence against ISO 26262 and ASPICE baselines, produces gap matrices and traceability findings',
    schedule: 'Mondays at 9:00 AM',
    pack: 'core',
  },
  'contract-reviewer': {
    label: 'Contract Reviewer',
    description: 'Analyzes NDA/MSA/SOW clauses against TIC baseline and regulatory landscape',
    schedule: 'On demand',
    pack: 'core',
  },
  'staffing-monitor': {
    label: 'Staffing Monitor',
    description: 'Tracks 23-engineer utilization, forecasts gaps 4-6 weeks ahead, matches skills to CRM pipeline',
    schedule: 'Mondays at 9:00 AM',
    pack: 'core',
  },
}

const AGENT_IDS = Object.keys(AGENT_META)

export const agentsRouter = Router()

// GET / — list agents with last run from runtime.db runs table
// Optional query: ?pack=core|experimental|personal (default: all)
agentsRouter.get('/', (req, res) => {
  const packFilter = req.query.pack as string | undefined
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

  const filteredIds = packFilter
    ? AGENT_IDS.filter(id => AGENT_META[id]?.pack === packFilter)
    : AGENT_IDS
  const agents = filteredIds.map(id => {
    const meta = AGENT_META[id]!
    const last = lastRuns[id]
    return {
      agentId: id,
      label: meta.label,
      description: meta.description,
      schedule: meta.schedule,
      pack: meta.pack,
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
  const { goal } = req.body as { goal?: string }
  const db = getRuntimeDb()
  try {
    const { commandId } = createCommand(db, { agentId, source: 'dashboard', payload: goal ? { goal } : undefined })
    res.json({ ok: true, command_id: commandId })
  } catch {
    res.status(500).json({ error: 'Failed to queue agent command' })
  } finally {
    try { db.close() } catch {}
  }
})
