import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import os from 'os'
import { join } from 'path'
import { getFreshDaemonHeartbeat } from './daemon-status.js'

function getRuntimeDb(): DatabaseSync {
  const dbPath = join(os.homedir(), '.jarvis', 'runtime.db')
  if (!existsSync(dbPath)) throw new Error('runtime.db not found')
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

function getSystemInfo() {
  const memUsage = process.memoryUsage()
  return {
    node_version: process.version,
    platform: process.platform,
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: Math.round(memUsage.rss / 1024 / 1024),
  }
}

export const supportRouter = Router()

// GET /bundle — export recent diagnostic data as JSON for debugging
// Auth: admin only (configured in middleware/auth.ts)
supportRouter.get('/bundle', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()

    // Select only diagnostic-safe columns (exclude payload_json which may contain PII/tokens)
    const recentRuns = db.prepare(
      'SELECT run_id, agent_id, status, trigger_kind, command_id, goal, current_step, total_steps, error, started_at, completed_at FROM runs ORDER BY started_at DESC LIMIT 20'
    ).all() as Record<string, unknown>[]

    const failedRunEvents = db.prepare(
      `SELECT re.event_id, re.run_id, re.agent_id, re.event_type, re.step_no, re.action, re.created_at FROM run_events re JOIN runs r ON re.run_id = r.run_id WHERE r.status = 'failed' ORDER BY re.created_at DESC LIMIT 50`
    ).all() as Record<string, unknown>[]

    const recentAudit = db.prepare(
      'SELECT audit_id, actor_type, actor_id, action, target_type, target_id, created_at FROM audit_log ORDER BY created_at DESC LIMIT 20'
    ).all() as Record<string, unknown>[]

    const pendingApprovals = db.prepare(
      `SELECT approval_id, agent_id, action, severity, status, requested_at, run_id FROM approvals WHERE status = 'pending'`
    ).all() as Record<string, unknown>[]

    res.json({
      generated_at: new Date().toISOString(),
      system: getSystemInfo(),
      recent_runs: recentRuns,
      failed_run_events: failedRunEvents,
      recent_audit: recentAudit,
      pending_approvals: pendingApprovals,
      daemon_heartbeat: getFreshDaemonHeartbeat(),
    })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    const isDbMissing = errMsg.includes('not found')
    res.status(isDbMissing ? 503 : 500).json({
      generated_at: new Date().toISOString(),
      system: getSystemInfo(),
      recent_runs: [],
      failed_run_events: [],
      recent_audit: [],
      pending_approvals: [],
      daemon_heartbeat: null,
      error: isDbMissing ? 'runtime.db not available' : `Database error: ${errMsg}`,
    })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
