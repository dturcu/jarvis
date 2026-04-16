import { Router } from 'express'
import fs from 'fs'
import { join } from 'path'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'
import { readDaemonStatus } from './daemon-status.js'

const PORT = Number(process.env.PORT ?? 4242)

function getDashboardVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    ) as { version?: string }
    return packageJson.version ?? '0.1.0'
  } catch {
    return '0.1.0'
  }
}

export const serviceRouter = Router()

// GET /status — service status overview
serviceRouter.get('/status', (_req, res) => {
  const daemon = readDaemonStatus()

  res.json({
    daemon: {
      running: daemon.running,
      pid: daemon.pid,
      uptime_seconds: daemon.uptime_seconds,
    },
    dashboard: {
      running: true,
      port: PORT,
      version: getDashboardVersion(),
      uptime_seconds: Math.floor(process.uptime()),
    },
  })
})

// POST /restart — send shutdown signal to daemon
serviceRouter.post('/restart', (req, res) => {
  const actor = getActor(req as AuthenticatedRequest)
  const daemon = readDaemonStatus()

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
