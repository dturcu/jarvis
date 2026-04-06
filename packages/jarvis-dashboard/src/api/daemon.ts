import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'

type ActiveRun = {
  agent_id: string
  status: string
  step: number
  total_steps: number
  current_action: string
  started_at: string
}

type CompletedJobSummary = {
  job_id: string
  job_type: string
  status: string
  updated_at: string
  agent_id: string | null
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
  current_run: ActiveRun | null
  /** All currently executing agent runs (supports concurrent execution). */
  active_runs: ActiveRun[]
  /** Metrics sourced from the JarvisState jobs/approvals tables. */
  jarvis_state: {
    queued_jobs: number
    running_jobs: number
    pending_approvals: number
    recent_completed: CompletedJobSummary[]
  } | null
}

function openDb(dbPath: string): DatabaseSync | null {
  if (!fs.existsSync(dbPath)) return null
  try {
    const db = new DatabaseSync(dbPath)
    db.exec("PRAGMA journal_mode = WAL;")
    db.exec("PRAGMA busy_timeout = 5000;")
    return db
  } catch {
    return null
  }
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
    jarvis_state: null,
  }

  const runtimeDbPath = join(os.homedir(), '.jarvis', 'runtime.db')
  const runtimeDb = openDb(runtimeDbPath)
  if (!runtimeDb) return { ...disconnected, jarvis_state: readJarvisStateMetrics() }

  try {
    // Read latest heartbeat
    const row = runtimeDb.prepare(
      "SELECT * FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | undefined

    if (!row) return { ...disconnected, jarvis_state: readJarvisStateMetrics() }

    // Check if heartbeat is stale (not updated in the last 30 seconds)
    const lastSeen = row.last_seen_at as string
    const age = Date.now() - new Date(lastSeen).getTime()
    if (age > 30_000) {
      return { ...disconnected, jarvis_state: readJarvisStateMetrics() }
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

    const activeRuns = (Array.isArray(details.active_runs) ? details.active_runs : []) as ActiveRun[]

    return {
      running: true,
      pid: row.pid as number | null,
      uptime_seconds: uptimeSeconds,
      agents_registered: (details.agents_registered as number) ?? 0,
      schedules_active: (details.schedules_active as number) ?? 0,
      last_run: (details.last_run as DaemonStatus['last_run']) ?? null,
      current_run: (details.current_run as DaemonStatus['current_run']) ?? null,
      active_runs: activeRuns,
      jarvis_state: readJarvisStateMetrics(),
    }
  } catch {
    return { ...disconnected, jarvis_state: readJarvisStateMetrics() }
  } finally {
    try { runtimeDb.close() } catch { /* best-effort */ }
  }
}

/**
 * Query JarvisState's SQLite database for job/approval metrics.
 * Returns null if the database is unavailable.
 */
function readJarvisStateMetrics(): DaemonStatus['jarvis_state'] {
  const stateDbPath = join(os.homedir(), '.jarvis', 'jarvis-state.sqlite')
  const db = openDb(stateDbPath)
  if (!db) return null

  try {
    const queuedRow = db.prepare(
      "SELECT COUNT(*) AS count FROM jobs WHERE status = 'queued'"
    ).get() as { count: number }

    const runningRow = db.prepare(
      "SELECT COUNT(*) AS count FROM jobs WHERE status = 'running'"
    ).get() as { count: number }

    const pendingRow = db.prepare(
      "SELECT COUNT(*) AS count FROM approvals WHERE state = 'pending'"
    ).get() as { count: number }

    const recentRows = db.prepare(
      "SELECT job_id, job_type, status, updated_at, record_json FROM jobs WHERE status IN ('completed', 'failed') ORDER BY updated_at DESC LIMIT 5"
    ).all() as Array<{ job_id: string; job_type: string; status: string; updated_at: string; record_json: string }>

    const recentCompleted: CompletedJobSummary[] = recentRows.map(r => {
      let agentId: string | null = null
      try {
        const record = JSON.parse(r.record_json) as { envelope?: { metadata?: { agent_id?: string } } }
        agentId = record?.envelope?.metadata?.agent_id ?? null
      } catch { /* ok */ }
      return {
        job_id: r.job_id,
        job_type: r.job_type,
        status: r.status,
        updated_at: r.updated_at,
        agent_id: agentId,
      }
    })

    return {
      queued_jobs: queuedRow.count,
      running_jobs: runningRow.count,
      pending_approvals: pendingRow.count,
      recent_completed: recentCompleted,
    }
  } catch {
    return null
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
}

export const daemonRouter = Router()

// GET /status — daemon status (heartbeat + JarvisState metrics)
daemonRouter.get('/status', (_req, res) => {
  const status = readDaemonStatus()
  res.json(status)
})
