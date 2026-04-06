import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'

export interface DaemonActiveRun {
  agent_id: string
  status: string
  step: number
  total_steps: number
  current_action: string
  started_at: string
}

export interface DaemonStatus {
  running: boolean
  pid: number | null
  uptime_seconds: number | null
  agents_registered: number
  schedules_active: number
  last_run: {
    agent_id: string
    status: string
    completed_at: string
  } | null
  /** @deprecated Use active_runs instead */
  current_run: DaemonActiveRun | null
  /** All currently executing agent runs (supports concurrent execution). */
  active_runs: DaemonActiveRun[]
}

function readDaemonStatus(): DaemonStatus {
  const disconnected: DaemonStatus = {
    running: false,
    pid: null,
    uptime_seconds: null,
    agents_registered: 0,
    schedules_active: 0,
    last_run: null,
    current_run: null,
    active_runs: [],
  }

  const dbPath = join(os.homedir(), '.jarvis', 'runtime.db')
  if (!fs.existsSync(dbPath)) return disconnected

  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath)
    db.exec("PRAGMA journal_mode = WAL;")
    db.exec("PRAGMA busy_timeout = 5000;")
  } catch {
    return disconnected
  }

  try {
    // Read latest heartbeat
    const row = db.prepare(
      "SELECT * FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | undefined

    if (!row) return disconnected

    // Check if heartbeat is stale (not updated in the last 30 seconds)
    const lastSeen = row.last_seen_at as string
    const age = Date.now() - new Date(lastSeen).getTime()
    if (age > 30_000) {
      return disconnected
    }

    // Parse details from the stored JSON
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
      agents_registered: (details.agents_registered as number) ?? 0,
      schedules_active: (details.schedules_active as number) ?? 0,
      last_run: (details.last_run as DaemonStatus['last_run']) ?? null,
      current_run: (details.current_run as DaemonStatus['current_run']) ?? null,
      active_runs: (details.active_runs as DaemonActiveRun[]) ?? [],
    }
  } catch {
    return disconnected
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
}

export const daemonRouter = Router()

// GET / — daemon status (read from DB heartbeat)
daemonRouter.get('/status', (_req, res) => {
  const status = readDaemonStatus()
  res.json(status)
})
