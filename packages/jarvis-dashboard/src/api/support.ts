import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import os from 'os'
import { join } from 'path'

function getRuntimeDb(): DatabaseSync {
  const dbPath = join(os.homedir(), '.jarvis', 'runtime.db')
  if (!existsSync(dbPath)) throw new Error('runtime.db not found')
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const supportRouter = Router()

// GET /bundle — export recent diagnostic data as JSON for debugging
supportRouter.get('/bundle', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()

    // Last 20 runs
    const recentRuns = db.prepare(
      'SELECT * FROM runs ORDER BY started_at DESC LIMIT 20'
    ).all() as Record<string, unknown>[]

    // Last 50 run events for failed runs
    const failedRunEvents = db.prepare(
      `SELECT re.* FROM run_events re JOIN runs r ON re.run_id = r.run_id WHERE r.status = 'failed' ORDER BY re.created_at DESC LIMIT 50`
    ).all() as Record<string, unknown>[]

    // Last 20 audit log entries
    const recentAudit = db.prepare(
      'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20'
    ).all() as Record<string, unknown>[]

    // Pending approvals
    const pendingApprovals = db.prepare(
      `SELECT * FROM approvals WHERE status = 'pending'`
    ).all() as Record<string, unknown>[]

    // Daemon heartbeat
    const heartbeatRow = db.prepare(
      'SELECT * FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1'
    ).get() as Record<string, unknown> | undefined

    // System info
    const memUsage = process.memoryUsage()
    const system = {
      node_version: process.version,
      platform: process.platform,
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(memUsage.rss / 1024 / 1024),
    }

    res.json({
      generated_at: new Date().toISOString(),
      system,
      recent_runs: recentRuns,
      failed_run_events: failedRunEvents,
      recent_audit: recentAudit,
      pending_approvals: pendingApprovals,
      daemon_heartbeat: heartbeatRow ?? null,
    })
  } catch {
    // Handle missing DB gracefully — return empty bundle with system info only
    const memUsage = process.memoryUsage()
    res.json({
      generated_at: new Date().toISOString(),
      system: {
        node_version: process.version,
        platform: process.platform,
        uptime_seconds: Math.floor(process.uptime()),
        memory_mb: Math.round(memUsage.rss / 1024 / 1024),
      },
      recent_runs: [],
      failed_run_events: [],
      recent_audit: [],
      pending_approvals: [],
      daemon_heartbeat: null,
      error: 'runtime.db not available',
    })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
