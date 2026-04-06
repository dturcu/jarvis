import { Router } from 'express'
import os from 'os'
import { join } from 'path'
import fs from 'fs'

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
  current_run: {
    agent_id: string
    status: string
    step: number
    total_steps: number
    current_action: string
    started_at: string
  } | null
}

const DAEMON_STATUS_PATH = join(os.homedir(), '.jarvis', 'daemon-status.json')

function readDaemonStatus(): DaemonStatus {
  const disconnected: DaemonStatus = {
    running: false,
    pid: null,
    uptime_seconds: null,
    agents_registered: 0,
    schedules_active: 0,
    last_run: null,
    current_run: null,
  }

  if (!fs.existsSync(DAEMON_STATUS_PATH)) {
    return disconnected
  }

  try {
    const raw = JSON.parse(fs.readFileSync(DAEMON_STATUS_PATH, 'utf8')) as Record<string, unknown>

    // Check if the status file is stale (not updated in the last 30 seconds)
    const updatedAt = raw.updated_at as string | undefined
    if (updatedAt) {
      const age = Date.now() - new Date(updatedAt).getTime()
      if (age > 30_000) {
        return { ...disconnected, last_run: (raw.last_run as DaemonStatus['last_run']) ?? null }
      }
    }

    // Check if the PID is still alive (best-effort)
    const pid = raw.pid as number | undefined
    if (pid) {
      try {
        process.kill(pid, 0) // signal 0 = check existence
      } catch {
        return { ...disconnected, last_run: (raw.last_run as DaemonStatus['last_run']) ?? null }
      }
    }

    const startedAt = raw.started_at as string | undefined
    const uptimeSeconds = startedAt
      ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      : null

    return {
      running: true,
      pid: pid ?? null,
      uptime_seconds: uptimeSeconds,
      agents_registered: (raw.agents_registered as number) ?? 0,
      schedules_active: (raw.schedules_active as number) ?? 0,
      last_run: (raw.last_run as DaemonStatus['last_run']) ?? null,
      current_run: (raw.current_run as DaemonStatus['current_run']) ?? null,
    }
  } catch {
    return disconnected
  }
}

export const daemonRouter = Router()

// GET / — daemon status (read from file)
daemonRouter.get('/status', (_req, res) => {
  const status = readDaemonStatus()
  res.json(status)
})
