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
  // Core — primary consulting product
  'bd-pipeline': {
    label: 'BD Pipeline',
    description: 'Scan for BD signals, enrich leads, draft outreach, update CRM',
    schedule: 'Weekdays at 8:00 AM',
    pack: 'core',
  },
  'proposal-engine': {
    label: 'Proposal Engine',
    description: 'Analyze RFQ/SOW, build quote structure, draft proposal',
    schedule: 'On demand',
    pack: 'core',
  },
  'evidence-auditor': {
    label: 'Evidence Auditor',
    description: 'Scan project for ISO 26262 work products, produce gap matrix',
    schedule: 'Mondays at 9:00 AM',
    pack: 'core',
  },
  'contract-reviewer': {
    label: 'Contract Reviewer',
    description: 'Analyze NDA/MSA clauses, produce sign/negotiate/escalate recommendation',
    schedule: 'On demand',
    pack: 'core',
  },
  'staffing-monitor': {
    label: 'Staffing Monitor',
    description: 'Calculate team utilization, forecast gaps, match skills to pipeline',
    schedule: 'Mondays at 9:00 AM',
    pack: 'core',
  },
  // Experimental — work-in-progress
  'content-engine': {
    label: 'Content Engine',
    description: 'Draft LinkedIn post for today\'s content pillar',
    schedule: 'Mon/Wed/Thu at 7:00 AM',
    pack: 'experimental',
  },
  'email-campaign': {
    label: 'Email Campaign',
    description: 'Manage drip campaigns, follow-up sequences, outreach automation',
    schedule: 'On demand',
    pack: 'experimental',
  },
  'social-engagement': {
    label: 'Social Engagement',
    description: 'Monitor and respond to social media interactions',
    schedule: 'Weekdays at 8:30 AM & 6:00 PM',
    pack: 'experimental',
  },
  'security-monitor': {
    label: 'Security Monitor',
    description: 'Track security advisories, vulnerability alerts, compliance updates',
    schedule: 'Daily at 3:00 AM',
    pack: 'experimental',
  },
  'drive-watcher': {
    label: 'Drive Watcher',
    description: 'Watch shared drives for new/changed documents, trigger workflows',
    schedule: 'Every 5 minutes',
    pack: 'experimental',
  },
  'invoice-generator': {
    label: 'Invoice Generator',
    description: 'Generate and track invoices for client engagements',
    schedule: 'On demand',
    pack: 'experimental',
  },
  'meeting-transcriber': {
    label: 'Meeting Transcriber',
    description: 'Transcribe and summarize meeting recordings',
    schedule: 'On demand',
    pack: 'experimental',
  },
  // Personal — non-consulting agents
  'portfolio-monitor': {
    label: 'Portfolio Monitor',
    description: 'Check crypto prices, calculate drift, recommend rebalance',
    schedule: 'Daily at 8:00 AM & 8:00 PM',
    pack: 'personal',
  },
  'garden-calendar': {
    label: 'Garden Calendar',
    description: 'Generate weekly garden brief based on date + weather',
    schedule: 'Mondays at 7:00 AM',
    pack: 'personal',
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
  const db = getRuntimeDb()
  try {
    const { commandId } = createCommand(db, { agentId, source: 'dashboard' })
    res.json({ ok: true, command_id: commandId })
  } catch {
    res.status(500).json({ error: 'Failed to queue agent command' })
  } finally {
    try { db.close() } catch {}
  }
})
