import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'

function getRuntimeDb() {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const attentionRouter = Router()

// GET / — needs-attention summary for the operator dashboard
attentionRouter.get('/', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()

    // Counts
    const pendingApprovals = (db.prepare(
      "SELECT COUNT(*) as cnt FROM approvals WHERE status = 'pending'"
    ).get() as { cnt: number }).cnt

    const failedRuns = (db.prepare(
      "SELECT COUNT(*) as cnt FROM runs WHERE status = 'failed' AND completed_at > datetime('now', '-24 hours')"
    ).get() as { cnt: number }).cnt

    const overdueSchedules = (db.prepare(
      "SELECT COUNT(*) as cnt FROM schedules WHERE enabled = 1 AND next_fire_at < datetime('now')"
    ).get() as { cnt: number }).cnt

    // Active work
    const activeWork = db.prepare(
      "SELECT run_id, agent_id, status, current_step, total_steps, started_at FROM runs WHERE status IN ('planning','executing','awaiting_approval') ORDER BY started_at DESC"
    ).all() as Record<string, unknown>[]

    // Recent completions
    const recentCompletions = db.prepare(
      "SELECT run_id, agent_id, status, completed_at, current_step FROM runs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 5"
    ).all() as Record<string, unknown>[]

    // Recommended actions
    const recommendedActions: string[] = []
    if (pendingApprovals > 0) {
      recommendedActions.push(`Review ${pendingApprovals} pending approval${pendingApprovals > 1 ? 's' : ''}`)
    }
    if (failedRuns > 0) {
      recommendedActions.push(`${failedRuns} failed run${failedRuns > 1 ? 's' : ''} need${failedRuns === 1 ? 's' : ''} retry`)
    }
    if (overdueSchedules > 0) {
      recommendedActions.push(`${overdueSchedules} overdue schedule${overdueSchedules > 1 ? 's' : ''}`)
    }

    // System status
    const systemStatus = (pendingApprovals > 0 || failedRuns > 0) ? 'needs_attention' : 'healthy'

    res.json({
      needs_attention: {
        pending_approvals: pendingApprovals,
        failed_runs: failedRuns,
        overdue_schedules: overdueSchedules,
      },
      active_work: activeWork,
      recent_completions: recentCompletions,
      recommended_actions: recommendedActions,
      system_status: systemStatus,
    })
  } catch {
    res.json({
      needs_attention: { pending_approvals: 0, failed_runs: 0, overdue_schedules: 0 },
      active_work: [],
      recent_completions: [],
      recommended_actions: [],
      system_status: 'unknown',
    })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /statuses — plain-English status descriptions
attentionRouter.get('/statuses', (_req, res) => {
  res.json({
    queued: { label: 'Waiting to start', action: 'Will begin when a slot is available' },
    planning: { label: 'Figuring out what to do', action: 'Building a plan of action' },
    executing: { label: 'Working on it', action: 'Running through planned steps' },
    awaiting_approval: { label: 'Needs your approval', action: 'Check the approval inbox' },
    completed: { label: 'Done', action: 'Review the results' },
    failed: { label: 'Something went wrong', action: 'Review the error and retry if needed' },
    cancelled: { label: 'Stopped', action: 'Was cancelled by you or the system' },
  })
})
