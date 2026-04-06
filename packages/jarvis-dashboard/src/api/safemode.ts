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
      // Quick integrity check — verify key tables exist
      const tables = db.prepare(
        "SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name IN ('runs', 'approvals', 'daemon_heartbeats')"
      ).get() as { n: number }
      if (tables.n < 3) {
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
      JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
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
