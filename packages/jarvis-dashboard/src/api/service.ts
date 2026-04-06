import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'

const PORT = Number(process.env.PORT ?? 4242)

function readDaemonHeartbeat(): { running: boolean; pid: number | null; uptime_seconds: number | null } {
  const disconnected = { running: false, pid: null, uptime_seconds: null }
  const dbPath = join(os.homedir(), '.jarvis', 'runtime.db')
  if (!fs.existsSync(dbPath)) return disconnected

  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(dbPath)
    db.exec("PRAGMA journal_mode = WAL;")
    db.exec("PRAGMA busy_timeout = 5000;")

    const row = db.prepare(
      "SELECT * FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | undefined

    if (!row) return disconnected

    const lastSeen = row.last_seen_at as string
    const age = Date.now() - new Date(lastSeen).getTime()
    if (age > 30_000) return disconnected

    let details: Record<string, unknown> = {}
    try {
      details = JSON.parse(row.details_json as string) as Record<string, unknown>
    } catch { /* ok */ }

    const startedAt = details.started_at as string | undefined
    const uptimeSeconds = startedAt
      ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      : null

    return {
      running: true,
      pid: row.pid as number | null,
      uptime_seconds: uptimeSeconds,
    }
  } catch {
    return disconnected
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
}

export const serviceRouter = Router()

// GET /status — service status overview
serviceRouter.get('/status', (_req, res) => {
  const daemon = readDaemonHeartbeat()

  res.json({
    daemon: {
      running: daemon.running,
      pid: daemon.pid,
      uptime_seconds: daemon.uptime_seconds,
    },
    dashboard: {
      running: true,
      port: PORT,
    },
  })
})

// POST /restart — send shutdown signal to daemon
serviceRouter.post('/restart', (req, res) => {
  const actor = getActor(req as AuthenticatedRequest)
  const daemon = readDaemonHeartbeat()

  if (!daemon.running || daemon.pid == null) {
    writeAuditLog(actor.type, actor.id, 'service.restart_requested', 'service', 'daemon', {
      note: 'Restart attempted but daemon is not running.',
    })
    res.json({ ok: false, error: 'Daemon is not running' })
    return
  }

  try {
    process.kill(daemon.pid, 'SIGTERM')
    writeAuditLog(actor.type, actor.id, 'service.restart_requested', 'service', 'daemon', {
      pid: daemon.pid,
      note: `SIGTERM sent to daemon PID ${daemon.pid}.`,
    })
    res.json({
      ok: true,
      message: `Shutdown signal sent to daemon (PID ${daemon.pid}). Restart the daemon manually.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    writeAuditLog(actor.type, actor.id, 'service.restart_failed', 'service', 'daemon', {
      pid: daemon.pid,
      error: message,
    })
    res.json({
      ok: false,
      error: `Failed to signal daemon (PID ${daemon.pid}): ${message}`,
    })
  }
})

// GET /restart-policy — document what happens on daemon shutdown + restart
serviceRouter.get('/restart-policy', (_req, res) => {
  res.json({
    run_states: {
      planning: { on_shutdown: 'marked failed with daemon_shutdown event', on_restart: 'stays failed', action: 'operator must retry' },
      executing: { on_shutdown: 'marked failed with daemon_shutdown event', on_restart: 'stays failed', action: 'operator must retry' },
      awaiting_approval: { on_shutdown: 'pending approvals expired, run marked failed', on_restart: 'stuck runs without pending approvals also failed', action: 'operator must retry' },
      completed: { on_shutdown: 'no change', on_restart: 'no change', action: 'none' },
      failed: { on_shutdown: 'no change', on_restart: 'no change', action: 'none' },
      cancelled: { on_shutdown: 'no change', on_restart: 'no change', action: 'none' },
    },
    command_states: {
      queued: { on_shutdown: 'no change', on_restart: 'eligible for claim', action: 'none' },
      claimed: { on_shutdown: 'released back to queued', on_restart: 'stale claims (>10min) released to queued', action: 'automatic' },
      completed: { on_shutdown: 'no change', on_restart: 'no change', action: 'none' },
      failed: { on_shutdown: 'no change', on_restart: 'no change', action: 'none' },
    },
  })
})
