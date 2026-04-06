/**
 * Comprehensive repair assessment endpoint.
 *
 * GET /api/repair returns a single actionable report that combines
 * database health, configuration validity, daemon heartbeat freshness,
 * model runtime availability, stale command claims, orphan runs, and
 * backup status into one operator-facing response.
 */

import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'

const JARVIS_DIR = join(os.homedir(), '.jarvis')
const CONFIG_PATH = join(JARVIS_DIR, 'config.json')
const RUNTIME_DB_PATH = join(JARVIS_DIR, 'runtime.db')
const BACKUPS_DIR = join(JARVIS_DIR, 'backups')

type CheckStatus = 'ok' | 'warning' | 'critical'

interface FixAction {
  type: string
  field?: string
  description: string
  example?: string
}

interface RepairCheck {
  name: string
  status: CheckStatus
  message: string
  severity: number
  fix_action: FixAction | null
}

type OverallStatus = 'healthy' | 'degraded' | 'broken'

interface RepairReport {
  status: OverallStatus
  checks: RepairCheck[]
  recommended_actions: string[]
  safe_mode: boolean
}

/** Open runtime.db with WAL + busy timeout. Caller must close. */
function openRuntimeDb(): DatabaseSync {
  const db = new DatabaseSync(RUNTIME_DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  return db
}

// ── Individual checks ────────────────────────────────────────────────────────

function checkRuntimeDatabase(): RepairCheck {
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    return {
      name: 'runtime_database',
      status: 'critical',
      message: 'Runtime database not found',
      severity: 3,
      fix_action: {
        type: 'manual',
        description: 'Initialize the runtime database: npx tsx scripts/init-jarvis.ts',
      },
    }
  }

  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()

    // Verify required tables
    const tables = db.prepare(
      "SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name IN ('runs', 'approvals', 'agent_commands', 'daemon_heartbeats')"
    ).get() as { n: number }

    if (tables.n < 4) {
      return {
        name: 'runtime_database',
        status: 'critical',
        message: `Runtime database is missing required tables (found ${tables.n}/4)`,
        severity: 3,
        fix_action: {
          type: 'manual',
          description: 'Re-initialize the runtime database: npx tsx scripts/init-jarvis.ts',
        },
      }
    }

    // Integrity check
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (integrity.integrity_check !== 'ok') {
      return {
        name: 'runtime_database',
        status: 'critical',
        message: `Runtime database integrity check failed: ${integrity.integrity_check}`,
        severity: 3,
        fix_action: {
          type: 'manual',
          description: 'Restore from backup: POST /api/backup/restore, or re-initialize: npx tsx scripts/init-jarvis.ts',
        },
      }
    }

    return {
      name: 'runtime_database',
      status: 'ok',
      message: 'Runtime database is healthy',
      severity: 0,
      fix_action: null,
    }
  } catch {
    return {
      name: 'runtime_database',
      status: 'critical',
      message: 'Runtime database cannot be opened',
      severity: 3,
      fix_action: {
        type: 'manual',
        description: 'Check file permissions on ~/.jarvis/runtime.db or restore from backup',
      },
    }
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
}

function checkConfig(): RepairCheck {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      name: 'config',
      status: 'critical',
      message: 'Configuration file missing',
      severity: 3,
      fix_action: {
        type: 'edit_config',
        field: 'config.json',
        description: 'Create ~/.jarvis/config.json with required fields',
        example: '{ "lmstudio_url": "http://localhost:1234", "adapter_mode": "lmstudio" }',
      },
    }
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (!parsed.lmstudio_url && !parsed.adapter_mode) {
      return {
        name: 'config',
        status: 'critical',
        message: 'Configuration missing lmstudio_url and adapter_mode',
        severity: 3,
        fix_action: {
          type: 'edit_config',
          field: 'lmstudio_url',
          description: 'Set lmstudio_url and adapter_mode in ~/.jarvis/config.json',
          example: 'http://localhost:1234',
        },
      }
    }

    if (!parsed.lmstudio_url) {
      return {
        name: 'config',
        status: 'critical',
        message: 'Configuration missing lmstudio_url',
        severity: 3,
        fix_action: {
          type: 'edit_config',
          field: 'lmstudio_url',
          description: 'Set your LM Studio URL in ~/.jarvis/config.json',
          example: 'http://localhost:1234',
        },
      }
    }

    if (!parsed.adapter_mode) {
      return {
        name: 'config',
        status: 'critical',
        message: 'Configuration missing adapter_mode',
        severity: 3,
        fix_action: {
          type: 'edit_config',
          field: 'adapter_mode',
          description: 'Set adapter_mode in ~/.jarvis/config.json',
          example: 'lmstudio',
        },
      }
    }

    return {
      name: 'config',
      status: 'ok',
      message: 'Configuration is valid',
      severity: 0,
      fix_action: null,
    }
  } catch {
    return {
      name: 'config',
      status: 'critical',
      message: 'Configuration file is invalid JSON',
      severity: 3,
      fix_action: {
        type: 'edit_config',
        field: 'config.json',
        description: 'Fix JSON syntax in ~/.jarvis/config.json',
      },
    }
  }
}

function checkDaemon(): RepairCheck {
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    return {
      name: 'daemon',
      status: 'critical',
      message: 'Cannot check daemon — runtime database missing',
      severity: 3,
      fix_action: {
        type: 'manual',
        description: 'Initialize the runtime database first: npx tsx scripts/init-jarvis.ts',
      },
    }
  }

  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()
    const heartbeat = db.prepare(
      'SELECT last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1'
    ).get() as { last_seen_at: string } | undefined

    if (!heartbeat) {
      return {
        name: 'daemon',
        status: 'critical',
        message: 'No daemon heartbeat found — daemon has never run',
        severity: 3,
        fix_action: {
          type: 'restart_daemon',
          description: 'Start the daemon: npm run daemon',
        },
      }
    }

    const stalenessMs = Date.now() - new Date(heartbeat.last_seen_at).getTime()
    const stalenessSeconds = Math.round(stalenessMs / 1000)

    if (stalenessMs > 5 * 60 * 1000) {
      return {
        name: 'daemon',
        status: 'critical',
        message: `Daemon heartbeat is stale (${stalenessSeconds}s) — daemon appears down`,
        severity: 3,
        fix_action: {
          type: 'restart_daemon',
          description: 'Restart the daemon: npm run daemon',
        },
      }
    }

    if (stalenessMs > 30_000) {
      return {
        name: 'daemon',
        status: 'warning',
        message: `Daemon heartbeat is stale (${stalenessSeconds}s)`,
        severity: 2,
        fix_action: {
          type: 'restart_daemon',
          description: 'Restart the daemon: npm run daemon',
        },
      }
    }

    return {
      name: 'daemon',
      status: 'ok',
      message: `Daemon heartbeat is fresh (${stalenessSeconds}s ago)`,
      severity: 0,
      fix_action: null,
    }
  } catch {
    return {
      name: 'daemon',
      status: 'critical',
      message: 'Cannot check daemon heartbeat — database error',
      severity: 3,
      fix_action: {
        type: 'restart_daemon',
        description: 'Restart the daemon: npm run daemon',
      },
    }
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
}

function checkModelRuntime(): RepairCheck {
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    return {
      name: 'model_runtime',
      status: 'critical',
      message: 'Cannot check models — runtime database missing',
      severity: 3,
      fix_action: {
        type: 'manual',
        description: 'Initialize the runtime database first: npx tsx scripts/init-jarvis.ts',
      },
    }
  }

  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()

    // Check if model_registry table exists before querying
    const tableExists = db.prepare(
      "SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'model_registry'"
    ).get() as { n: number }

    if (tableExists.n === 0) {
      return {
        name: 'model_runtime',
        status: 'critical',
        message: 'model_registry table does not exist',
        severity: 3,
        fix_action: {
          type: 'manual',
          description: 'Re-initialize the runtime database: npx tsx scripts/init-jarvis.ts',
        },
      }
    }

    const row = db.prepare(
      'SELECT COUNT(*) as n FROM model_registry WHERE enabled = 1'
    ).get() as { n: number }

    if (row.n === 0) {
      return {
        name: 'model_runtime',
        status: 'critical',
        message: 'No enabled models found',
        severity: 3,
        fix_action: {
          type: 'start_model_runtime',
          description: 'Start LM Studio or Ollama and ensure at least one model is loaded',
        },
      }
    }

    // Check freshness — if last_seen_at is stale, models may be unavailable despite being enabled
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const freshRow = db.prepare(
      'SELECT COUNT(*) as n FROM model_registry WHERE enabled = 1 AND last_seen_at > ?'
    ).get(fiveMinAgo) as { n: number }

    if (freshRow.n === 0) {
      return {
        name: 'model_runtime',
        status: 'warning',
        message: `${row.n} model(s) enabled but none seen in the last 5 minutes — runtime may be down`,
        severity: 2,
        fix_action: {
          type: 'start_model_runtime',
          description: 'Verify LM Studio or Ollama is running and has loaded models',
        },
      }
    }

    return {
      name: 'model_runtime',
      status: 'ok',
      message: `${freshRow.n} enabled model(s) recently seen`,
      severity: 0,
      fix_action: null,
    }
  } catch {
    return {
      name: 'model_runtime',
      status: 'critical',
      message: 'Cannot query model registry — database error',
      severity: 3,
      fix_action: {
        type: 'start_model_runtime',
        description: 'Start LM Studio or Ollama and ensure at least one model is loaded',
      },
    }
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
}

function checkStaleClaims(): RepairCheck {
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    return {
      name: 'stale_claims',
      status: 'ok',
      message: 'Runtime database not available — skipped',
      severity: 0,
      fix_action: null,
    }
  }

  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()
    // Use ISO timestamp for comparison (claimed_at stored as ISO string)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const row = db.prepare(
      "SELECT COUNT(*) as n FROM agent_commands WHERE status = 'claimed' AND claimed_at < ?"
    ).get(tenMinAgo) as { n: number }

    if (row.n > 0) {
      return {
        name: 'stale_claims',
        status: 'warning',
        message: `${row.n} command(s) claimed but not completed in over 10 minutes`,
        severity: 2,
        fix_action: {
          type: 'manual',
          description: 'Review stale command claims in the queue and release or cancel them',
        },
      }
    }

    return {
      name: 'stale_claims',
      status: 'ok',
      message: 'No stale command claims',
      severity: 0,
      fix_action: null,
    }
  } catch {
    return {
      name: 'stale_claims',
      status: 'warning',
      message: 'Cannot check stale claims — database error',
      severity: 1,
      fix_action: { type: 'manual', description: 'Inspect the runtime database and retry the repair check' },
    }
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
}

function checkOrphanRuns(): RepairCheck {
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    return {
      name: 'orphan_runs',
      status: 'ok',
      message: 'Runtime database not available — skipped',
      severity: 0,
      fix_action: null,
    }
  }

  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const row = db.prepare(
      "SELECT COUNT(*) as n FROM runs WHERE status IN ('planning', 'executing', 'awaiting_approval') AND started_at < ?"
    ).get(oneHourAgo) as { n: number }

    if (row.n > 0) {
      return {
        name: 'orphan_runs',
        status: 'warning',
        message: `${row.n} run(s) stuck in non-terminal state for >1 hour`,
        severity: 2,
        fix_action: {
          type: 'manual',
          description: 'Review stuck runs and cancel or retry them',
        },
      }
    }

    return {
      name: 'orphan_runs',
      status: 'ok',
      message: 'No orphan runs detected',
      severity: 0,
      fix_action: null,
    }
  } catch {
    return {
      name: 'orphan_runs',
      status: 'warning',
      message: 'Cannot check orphan runs — database error',
      severity: 2,
      fix_action: { type: 'manual', description: 'Inspect the runtime database and retry the repair check' },
    }
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
}

function checkBackupStatus(): RepairCheck {
  if (!fs.existsSync(BACKUPS_DIR)) {
    return {
      name: 'backup_status',
      status: 'warning',
      message: 'No backups directory found',
      severity: 2,
      fix_action: {
        type: 'create_backup',
        description: 'Create a backup: POST /api/backup',
      },
    }
  }

  try {
    const entries = fs.readdirSync(BACKUPS_DIR).filter(e => e.startsWith('backup-'))

    if (entries.length === 0) {
      return {
        name: 'backup_status',
        status: 'warning',
        message: 'No backups found',
        severity: 2,
        fix_action: {
          type: 'create_backup',
          description: 'Create a backup: POST /api/backup',
        },
      }
    }

    return {
      name: 'backup_status',
      status: 'ok',
      message: `${entries.length} backup(s) available`,
      severity: 0,
      fix_action: null,
    }
  } catch {
    return {
      name: 'backup_status',
      status: 'warning',
      message: 'Cannot read backups directory',
      severity: 2,
      fix_action: {
        type: 'create_backup',
        description: 'Create a backup: POST /api/backup',
      },
    }
  }
}

// ── Safe mode check (reuse safemode logic) ───────────────────────────────────

function isSafeMode(): boolean {
  if (!fs.existsSync(RUNTIME_DB_PATH)) return true
  if (!fs.existsSync(CONFIG_PATH)) return true

  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>
    if (!parsed.lmstudio_url || !parsed.adapter_mode) return true
  } catch {
    return true
  }

  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()
    const tables = db.prepare(
      "SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name IN ('runs', 'approvals', 'agent_commands', 'daemon_heartbeats')"
    ).get() as { n: number }
    if (tables.n < 4) return true

    const heartbeat = db.prepare(
      'SELECT last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1'
    ).get() as { last_seen_at: string } | undefined
    if (!heartbeat) return true

    const staleness = Date.now() - new Date(heartbeat.last_seen_at).getTime()
    if (staleness > 30_000) return true
  } catch {
    return true
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }

  return false
}

// ── Router ───────────────────────────────────────────────────────────────────

export const repairRouter = Router()

repairRouter.get('/', (_req, res) => {
  const checks: RepairCheck[] = [
    checkRuntimeDatabase(),
    checkConfig(),
    checkDaemon(),
    checkModelRuntime(),
    checkStaleClaims(),
    checkOrphanRuns(),
    checkBackupStatus(),
  ]

  // Derive overall status
  const hasCritical = checks.some(c => c.status === 'critical')
  const hasWarning = checks.some(c => c.status === 'warning')
  let status: OverallStatus = 'healthy'
  if (hasCritical) status = 'broken'
  else if (hasWarning) status = 'degraded'

  // Build recommended actions: critical first (severity desc), then warnings
  const actionable = checks
    .filter(c => c.fix_action !== null)
    .sort((a, b) => b.severity - a.severity)

  const recommended_actions = actionable.map(c => {
    // Use the full description as the primary recommendation
    return c.fix_action!.description
  })

  const report: RepairReport = {
    status,
    checks,
    recommended_actions,
    safe_mode: isSafeMode(),
  }

  res.json(report)
})
