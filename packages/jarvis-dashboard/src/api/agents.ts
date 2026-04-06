import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'

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

// GET / — list 8 agents with last decision from decisions table
agentsRouter.get('/', (_req, res) => {
  let lastDecisions: Record<string, Record<string, unknown>> = {}
  try {
    const db = getKnowledgeDb()
    const rows = db.prepare(
      `SELECT * FROM decisions d1
       WHERE decision_id = (
         SELECT MAX(decision_id) FROM decisions d2 WHERE d2.agent_id = d1.agent_id
       )`
    ).all() as Record<string, unknown>[]
    db.close()
    for (const row of rows) {
      if (typeof row.agent_id === 'string') {
        lastDecisions[row.agent_id] = row
      }
    }
  } catch {
    // DB may not exist yet
  }

  const agents = AGENT_IDS.map(id => {
    const meta = AGENT_META[id]
    const last = lastDecisions[id]
    return {
      agentId: id,
      label: meta.label,
      description: meta.description,
      schedule: meta.schedule,
      lastRun: last?.decided_at ?? last?.created_at ?? null,
      lastOutcome: last?.outcome ?? null,
      lastStep: last?.step ?? null
    }
  })
  res.json(agents)
})

// GET /decisions?agent=&limit=50&offset=0 — paginated decisions log
agentsRouter.get('/decisions', (req, res) => {
  const { agent, limit = '50', offset = '0' } = req.query as { agent?: string; limit?: string; offset?: string }
  try {
    const db = getKnowledgeDb()
    let sql = 'SELECT * FROM decisions WHERE 1=1'
    const params: SQLInputValue[] = []
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

// POST /:agentId/trigger — write ~/.jarvis/trigger-{agentId}.json to trigger agent run
agentsRouter.post('/:agentId/trigger', (req, res) => {
  const { agentId } = req.params
  if (!AGENT_IDS.includes(agentId)) {
    res.status(400).json({ error: `Unknown agent: ${agentId}` })
    return
  }
  try {
    const jarvisDir = join(os.homedir(), '.jarvis')
    if (!fs.existsSync(jarvisDir)) {
      fs.mkdirSync(jarvisDir, { recursive: true })
    }
    const triggerPath = join(jarvisDir, `trigger-${agentId}.json`)
    fs.writeFileSync(triggerPath, JSON.stringify({
      agentId,
      triggeredAt: new Date().toISOString(),
      triggeredBy: 'dashboard'
    }, null, 2))
    res.json({ ok: true, triggerFile: triggerPath })
  } catch {
    res.status(500).json({ error: 'Failed to write trigger file' })
  }
})
