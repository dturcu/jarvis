import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import { join } from 'path'

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

type DaemonHeartbeatRow = {
  daemon_id: string
  pid: number | null
  host: string | null
  status: string | null
  last_seen_at: string
  details_json: string | null
}

export const HEARTBEAT_STALE_MS = 30_000

const DISCONNECTED: DaemonStatus = {
  running: false,
  pid: null,
  uptime_seconds: null,
  agents_registered: 0,
  schedules_active: 0,
  last_run: null,
  current_run: null,
  active_runs: [],
}

function getRuntimeDbPath(): string {
  return join(os.homedir(), '.jarvis', 'runtime.db')
}

function openRuntimeDb(): DatabaseSync | null {
  const dbPath = getRuntimeDbPath()
  if (!fs.existsSync(dbPath)) return null

  try {
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec('PRAGMA busy_timeout = 5000;')
    return db
  } catch {
    return null
  }
}

export function isProcessAlive(pid: number | null | undefined): boolean {
  if (pid == null || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return code === 'EPERM'
  }
}

export function isDaemonHeartbeatFresh(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false
  const lastSeenMs = new Date(lastSeenAt).getTime()
  if (!Number.isFinite(lastSeenMs)) return false
  return Date.now() - lastSeenMs <= HEARTBEAT_STALE_MS
}

export function getLatestDaemonHeartbeat(): DaemonHeartbeatRow | null {
  let db: DatabaseSync | null = null

  try {
    db = openRuntimeDb()
    if (!db) return null

    const row = db.prepare(
      'SELECT daemon_id, pid, host, status, last_seen_at, details_json FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1'
    ).get() as DaemonHeartbeatRow | undefined

    return row ?? null
  } catch {
    return null
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
}

export function getFreshDaemonHeartbeat(): DaemonHeartbeatRow | null {
  const row = getLatestDaemonHeartbeat()
  if (!row) return null
  if (!isDaemonHeartbeatFresh(row.last_seen_at)) return null
  if (!isProcessAlive(row.pid)) return null
  return row
}

export function readDaemonStatus(): DaemonStatus {
  const row = getFreshDaemonHeartbeat()
  if (!row) return { ...DISCONNECTED }

  let details: Record<string, unknown> = {}
  try {
    details = row.details_json ? (JSON.parse(row.details_json) as Record<string, unknown>) : {}
  } catch {
    details = {}
  }

  const startedAt = details.started_at as string | undefined
  const uptimeSeconds = startedAt
    ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    : null

  return {
    running: true,
    pid: row.pid,
    uptime_seconds: uptimeSeconds,
    agents_registered: (details.agents_registered as number) ?? 0,
    schedules_active: (details.schedules_active as number) ?? 0,
    last_run: (details.last_run as DaemonStatus['last_run']) ?? null,
    current_run: (details.current_run as DaemonStatus['current_run']) ?? null,
    active_runs: (details.active_runs as DaemonActiveRun[]) ?? [],
  }
}
