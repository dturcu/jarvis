import { Router } from 'express'
import os from 'os'
import { join } from 'path'
import fs from 'fs'
import { DatabaseSync } from 'node:sqlite'

const JARVIS_DIR = join(os.homedir(), '.jarvis')
const CONFIG_PATH = join(JARVIS_DIR, 'config.json')
const RUNTIME_DB_PATH = join(JARVIS_DIR, 'runtime.db')

export const safemodeRouter = Router()

// GET / — check if system should boot in safe mode
safemodeRouter.get('/', (_req, res) => {
  const checks = {
    databases_ok: true,
    config_ok: true,
    daemon_running: true
  }
  let reason: string | null = null

  // Check if runtime.db exists and is readable
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    checks.databases_ok = false
    reason = 'Runtime database missing'
  } else {
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(RUNTIME_DB_PATH)
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA busy_timeout = 5000;')
      // Quick integrity check — verify key tables exist (must match daemon + POST /exit)
      const tables = db.prepare(
        "SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name IN ('runs', 'approvals', 'agent_commands', 'daemon_heartbeats')"
      ).get() as { n: number }
      if (tables.n < 4) {
        checks.databases_ok = false
        reason = 'Runtime database is missing required tables'
      }
    } catch {
      checks.databases_ok = false
      reason = 'Runtime database cannot be opened'
    } finally {
      try { db?.close() } catch { /* best-effort */ }
    }
  }

  // Check if config.json is valid
  if (!fs.existsSync(CONFIG_PATH)) {
    checks.config_ok = false
    if (!reason) reason = 'Configuration file missing'
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>
      if (!parsed.lmstudio_url || !parsed.adapter_mode) {
        checks.config_ok = false
        if (!reason) reason = 'Configuration missing required fields (lmstudio_url or adapter_mode)'
      }
    } catch {
      checks.config_ok = false
      if (!reason) reason = 'Configuration file is invalid JSON'
    }
  }

  // Check daemon heartbeat staleness
  if (checks.databases_ok && fs.existsSync(RUNTIME_DB_PATH)) {
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(RUNTIME_DB_PATH)
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA busy_timeout = 5000;')
      const heartbeat = db.prepare(
        'SELECT last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1'
      ).get() as { last_seen_at: string } | undefined

      if (!heartbeat) {
        checks.daemon_running = false
        if (!reason) reason = 'No daemon heartbeat found'
      } else {
        const staleness = Date.now() - new Date(heartbeat.last_seen_at).getTime()
        if (staleness > 30_000) {
          checks.daemon_running = false
          if (!reason) reason = 'Daemon heartbeat is stale'
        }
      }
    } catch {
      checks.daemon_running = false
      if (!reason) reason = 'Cannot check daemon heartbeat'
    } finally {
      try { db?.close() } catch { /* best-effort */ }
    }
  } else {
    // Can't check daemon if database is unavailable
    checks.daemon_running = false
    if (!reason) reason = 'Cannot check daemon — database unavailable'
  }

  // Safe mode triggers on any critical failure — including stale daemon
  const safeMode = !checks.databases_ok || !checks.config_ok || !checks.daemon_running

  res.json({
    safe_mode: safeMode,
    reason: safeMode ? reason : null,
    checks
  })
})

// POST /exit — re-run all health checks and report whether safe mode can be exited.
// This does not directly control the daemon — the daemon's own periodic re-check
// detects when conditions clear. This gives the operator visibility into whether
// their repair was sufficient.
safemodeRouter.post('/exit', (_req, res) => {
  const remaining_issues: string[] = []

  // 1. Check runtime.db existence and key tables
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    remaining_issues.push('Runtime database missing')
  } else {
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(RUNTIME_DB_PATH)
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA busy_timeout = 5000;')
      const tables = db.prepare(
        "SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name IN ('runs', 'approvals', 'agent_commands', 'daemon_heartbeats')"
      ).get() as { n: number }
      if (tables.n < 4) {
        remaining_issues.push(`Missing required tables (found ${tables.n}/4)`)
      }
    } catch {
      remaining_issues.push('Runtime database cannot be opened')
    } finally {
      try { db?.close() } catch { /* best-effort */ }
    }
  }

  // 2. Check config.json validity
  if (!fs.existsSync(CONFIG_PATH)) {
    remaining_issues.push('Configuration file missing')
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>
      if (!parsed.lmstudio_url || !parsed.adapter_mode) {
        remaining_issues.push('Configuration missing required fields (lmstudio_url or adapter_mode)')
      }
    } catch {
      remaining_issues.push('Configuration file is invalid JSON')
    }
  }

  // 3. Check daemon heartbeat freshness
  if (remaining_issues.length === 0 && fs.existsSync(RUNTIME_DB_PATH)) {
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(RUNTIME_DB_PATH)
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA busy_timeout = 5000;')
      const heartbeat = db.prepare(
        'SELECT last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1'
      ).get() as { last_seen_at: string } | undefined

      if (!heartbeat) {
        remaining_issues.push('No daemon heartbeat found')
      } else {
        const staleness = Date.now() - new Date(heartbeat.last_seen_at).getTime()
        if (staleness > 30_000) {
          remaining_issues.push('Daemon heartbeat is stale')
        }
      }
    } catch {
      remaining_issues.push('Cannot check daemon heartbeat')
    } finally {
      try { db?.close() } catch { /* best-effort */ }
    }
  }

  if (remaining_issues.length === 0) {
    res.json({
      safe_mode: false,
      message: 'All checks passed. Safe to resume normal operation.'
    })
  } else {
    res.json({
      safe_mode: true,
      remaining_issues
    })
  }
})
