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

// POST /restart — placeholder restart signal
serviceRouter.post('/restart', (req, res) => {
  const actor = getActor(req as AuthenticatedRequest)
  writeAuditLog(actor.type, actor.id, 'service.restart_requested', 'service', 'daemon', {
    note: 'Restart signal recorded. Real restart requires OS-level service management.',
  })

  res.json({ ok: true, message: 'Restart signal sent' })
})
