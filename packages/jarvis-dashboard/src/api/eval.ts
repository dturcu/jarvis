import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import { join } from 'node:path'
import { ALL_AGENTS, MATURITY_LADDER, mapRuntimeMaturity, SCORE_THRESHOLDS } from '@jarvis/agents'
import type { MaturityLevel } from '@jarvis/agents'

function getRuntimeDb(): DatabaseSync {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const evalRouter = Router()

// GET / — overview: all agents with maturity level and promotion readiness
evalRouter.get('/', (_req, res) => {
  const agents = ALL_AGENTS.map(a => {
    const ladderLevel = mapRuntimeMaturity(a.maturity ?? 'experimental')
    const ladder = MATURITY_LADDER.find(l => l.level === ladderLevel)
    return {
      agent_id: a.agent_id,
      label: a.label,
      runtime_maturity: a.maturity,
      ladder_level: ladderLevel,
      planner_mode: a.planner_mode,
      review_required: a.review_required ?? false,
      approval_policy: ladder?.approval_policy ?? 'unknown',
      entry_criteria: ladder?.entry_criteria ?? [],
      rollback_triggers: ladder?.rollback_triggers ?? [],
    }
  })
  res.json(agents)
})

// GET /thresholds — scoring thresholds for all dimensions
evalRouter.get('/thresholds', (_req, res) => {
  res.json({
    thresholds: SCORE_THRESHOLDS,
    maturity_ladder: MATURITY_LADDER,
  })
})

// GET /ladder — maturity ladder with promotion/demotion criteria
evalRouter.get('/ladder', (_req, res) => {
  res.json(MATURITY_LADDER)
})

// GET /:agentId — agent eval summary with recent run stats
evalRouter.get('/:agentId', (req, res) => {
  const { agentId } = req.params
  const agentDef = ALL_AGENTS.find(a => a.agent_id === agentId)
  if (!agentDef) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` })
    return
  }

  const ladderLevel = mapRuntimeMaturity(agentDef.maturity ?? 'experimental')
  const currentLadder = MATURITY_LADDER.find(l => l.level === ladderLevel)
  const nextLevel = getNextLevel(ladderLevel)
  const nextLadder = nextLevel ? MATURITY_LADDER.find(l => l.level === nextLevel) : null

  // Query recent run stats from runtime.db
  let runStats: { total: number; completed: number; failed: number; success_rate: number } = {
    total: 0, completed: 0, failed: 0, success_rate: 0,
  }
  try {
    const db = getRuntimeDb()
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    const row = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM runs WHERE agent_id = ? AND started_at >= ?
    `).get(agentId, cutoff) as any
    db.close()
    runStats = {
      ...row,
      success_rate: row.total > 0 ? Math.round((row.completed / row.total) * 1000) / 1000 : 0,
    }
  } catch { /* runtime.db may not exist */ }

  res.json({
    agent_id: agentId,
    label: agentDef.label,
    runtime_maturity: agentDef.maturity,
    ladder_level: ladderLevel,
    planner_mode: agentDef.planner_mode,
    review_required: agentDef.review_required ?? false,
    current_level: {
      level: ladderLevel,
      approval_policy: currentLadder?.approval_policy,
      rollback_triggers: currentLadder?.rollback_triggers ?? [],
    },
    next_level: nextLadder ? {
      level: nextLevel,
      entry_criteria: nextLadder.entry_criteria,
    } : null,
    run_stats_30d: runStats,
    score_thresholds: SCORE_THRESHOLDS,
  })
})

function getNextLevel(current: MaturityLevel): MaturityLevel | null {
  switch (current) {
    case 'experimental': return 'gated'
    case 'gated': return 'trusted'
    case 'trusted': return null
  }
}
