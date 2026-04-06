import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import { configureJarvisStatePersistence, getJarvisState } from '@jarvis/shared'

const RUNTIME_DB_PATH = join(os.homedir(), '.jarvis', 'runtime.sqlite')

// Ensure JarvisState is configured for this process
configureJarvisStatePersistence({ databasePath: RUNTIME_DB_PATH })

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

// GET / — list 8 agents with last run info from JarvisState + decisions from knowledge.db
agentsRouter.get('/', (_req, res) => {
  // Get last completed/failed job per agent from JarvisState
  let lastJobs: Record<string, { status: string; finished_at: string | null; summary: string }> = {}
  try {
    const state = getJarvisState()
    const db = (state as unknown as { db: DatabaseSync }).db
    if (db) {
      const rows = db.prepare(`
        SELECT job_id, job_type, status, updated_at, record_json
        FROM jobs
        WHERE job_type = 'agent.start'
          AND status IN ('completed', 'failed')
        ORDER BY updated_at DESC
      `).all() as Array<{ job_id: string; status: string; updated_at: string; record_json: string }>
      for (const row of rows) {
        try {
          const record = JSON.parse(row.record_json) as { envelope: { input: { agent_id?: string } }; result: { summary: string; metrics?: { finished_at?: string } } }
          const agentId = record.envelope?.input?.agent_id
          if (typeof agentId === 'string' && !lastJobs[agentId]) {
            lastJobs[agentId] = {
              status: row.status,
              finished_at: record.result?.metrics?.finished_at ?? row.updated_at,
              summary: record.result?.summary ?? '',
            }
          }
        } catch { /* skip malformed records */ }
      }
    }
  } catch {
    // Fall back to decisions if JarvisState not available
  }

  // Fall back to knowledge.db decisions for agents not found in JarvisState
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
    const job = lastJobs[id]
    const last = lastDecisions[id]

    return {
      agentId: id,
      label: meta.label,
      description: meta.description,
      schedule: meta.schedule,
      lastRun: job?.finished_at ?? last?.decided_at ?? last?.created_at ?? null,
      lastOutcome: job?.status ?? last?.outcome ?? null,
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

// POST /:agentId/trigger — submit agent.start job to JarvisState (replaces trigger-file)
agentsRouter.post('/:agentId/trigger', (req, res) => {
  const { agentId } = req.params
  if (!AGENT_IDS.includes(agentId)) {
    res.status(400).json({ error: `Unknown agent: ${agentId}` })
    return
  }
  try {
    const result = getJarvisState().submitJob({
      type: "agent.start",
      input: {
        agent_id: agentId,
        trigger_kind: "manual",
        triggered_by: "dashboard",
      },
    })
    res.json({ ok: true, job_id: result.job_id, status: result.status })
  } catch (e) {
    res.status(500).json({ error: `Failed to submit job: ${e instanceof Error ? e.message : String(e)}` })
  }
})
