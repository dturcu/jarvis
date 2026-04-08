import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'

const JARVIS_DIR = join(os.homedir(), '.jarvis')
const BACKUPS_DIR = join(JARVIS_DIR, 'backups')


// Files to include in backup. Include WAL/SHM sidecars for SQLite consistency.
const BACKUP_FILES = ['config.json', 'crm.db', 'knowledge.db', 'runtime.db']
const WAL_SIDECARS = ['runtime.db-wal', 'runtime.db-shm', 'crm.db-wal', 'crm.db-shm', 'knowledge.db-wal', 'knowledge.db-shm']

export const backupRouter = Router()

// POST / — trigger a new backup
backupRouter.post('/', (req, res) => {
  try {
    const now = new Date()
    const ts = now.toISOString()
      .replace(/[T]/g, '-')
      .replace(/[:]/g, '')
      .replace(/\.\d+Z$/, '')
    const backupDir = join(BACKUPS_DIR, `backup-${ts}`)

    fs.mkdirSync(backupDir, { recursive: true })

    const files: Array<{ name: string; size: number }> = []
    // Use VACUUM INTO for SQLite databases — creates a consistent snapshot
    // even while the daemon is writing. Falls back to file copy for non-DB files.
    const DB_FILES = ['crm.db', 'knowledge.db', 'runtime.db']
    for (const name of BACKUP_FILES) {
      const src = join(JARVIS_DIR, name)
      if (!fs.existsSync(src)) continue

      if (DB_FILES.includes(name)) {
        // Atomic snapshot via VACUUM INTO — reads a consistent state without
        // requiring the daemon to quiesce writes.
        try {
          const db = new DatabaseSync(src)
          db.exec(`VACUUM INTO '${join(backupDir, name).replace(/'/g, "''")}'`)
          db.close()
        } catch {
          // Fallback to file copy if VACUUM INTO is unavailable
          fs.copyFileSync(src, join(backupDir, name))
        }
      } else {
        fs.copyFileSync(src, join(backupDir, name))
      }
      files.push({ name, size: fs.statSync(join(backupDir, name)).size })
    }
    // WAL/SHM sidecars are NOT needed when using VACUUM INTO (it produces
    // a standalone DB file). Skip them to avoid inconsistency.

    if (files.length === 0) {
      res.status(400).json({ ok: false, error: 'No files found to back up' })
      return
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0)
    const manifest = {
      timestamp: now.toISOString(),
      files,
      total_size: totalSize
    }

    fs.writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'backup.created', 'backup', backupDir, {
      files: files.map(f => f.name),
      total_size: totalSize
    })

    res.json({
      ok: true,
      path: backupDir,
      files,
      total_size: totalSize
    })
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`
    })
  }
})

// GET /status — return last backup info
backupRouter.get('/status', (_req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      res.json({ last_backup: null })
      return
    }

    const entries = fs.readdirSync(BACKUPS_DIR)
      .filter(e => e.startsWith('backup-'))
      .sort()

    if (entries.length === 0) {
      res.json({ last_backup: null })
      return
    }

    const latest = entries[entries.length - 1]
    const manifestPath = join(BACKUPS_DIR, latest, 'manifest.json')

    if (!fs.existsSync(manifestPath)) {
      res.json({ last_backup: latest, files: [], size: 0 })
      return
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      timestamp: string
      files: Array<{ name: string; size: number }>
      total_size: number
    }

    res.json({
      last_backup: manifest.timestamp,
      path: join(BACKUPS_DIR, latest),
      files: manifest.files,
      size: manifest.total_size
    })
  } catch {
    res.json({ last_backup: null })
  }
})

// POST /restore — restore from a backup
backupRouter.post('/restore', (req, res) => {
  const { backup_path } = req.body as { backup_path?: string }

  if (!backup_path) {
    res.status(400).json({ ok: false, error: 'backup_path is required' })
    return
  }

  // Normalize the path: replace ~ with homedir
  const resolvedPath = backup_path.replace(/^~/, os.homedir())

  try {
    const manifestPath = join(resolvedPath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      res.status(404).json({ ok: false, error: 'manifest.json not found in backup path' })
      return
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      files: Array<{ name: string; size: number }>
    }

    // Allowlist of files that can be restored (prevents path traversal)
    const ALLOWED_RESTORE = new Set([...BACKUP_FILES, ...WAL_SIDECARS])

    // Validate: only restore allowed filenames (no path separators, no ..)
    const safeFiles = manifest.files.filter(f => {
      const name = f.name
      return ALLOWED_RESTORE.has(name) && !name.includes('/') && !name.includes('\\') && !name.includes('..')
    })

    // Validate all safe files exist in the backup
    const missing: string[] = []
    for (const file of safeFiles) {
      if (!fs.existsSync(join(resolvedPath, file.name))) {
        missing.push(file.name)
      }
    }

    if (missing.length > 0) {
      res.status(400).json({
        ok: false,
        error: `Missing files in backup: ${missing.join(', ')}`
      })
      return
    }

    // Check if daemon is running — warn if so
    const runtimeDbPath = join(JARVIS_DIR, 'runtime.db')
    if (fs.existsSync(runtimeDbPath)) {
      let checkDb: DatabaseSync | null = null
      try {
        checkDb = new DatabaseSync(runtimeDbPath)
        checkDb.exec("PRAGMA journal_mode = WAL;")
        checkDb.exec("PRAGMA busy_timeout = 5000;")
        const heartbeat = checkDb.prepare(
          'SELECT last_seen_at, pid FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1'
        ).get() as { last_seen_at: string; pid: number } | undefined
        if (heartbeat) {
          const staleness = Date.now() - new Date(heartbeat.last_seen_at).getTime()
          if (staleness < 30_000) {
            // Daemon appears to be running
            if (req.body.force !== true) {
              res.status(409).json({
                ok: false,
                error: 'Daemon is running. Stop it before restoring, or pass force: true to override.',
                daemon_pid: heartbeat.pid,
              })
              return
            }
          }
        }
      } catch {
        // Cannot read runtime.db — fail closed unless force
        if (req.body.force !== true) {
          res.status(409).json({
            ok: false,
            error: 'Cannot verify daemon status (runtime.db unreadable). Pass force: true to override.',
          })
          return
        }
      } finally {
        try { checkDb?.close() } catch { /* best-effort */ }
      }
    }

    // Ensure target directory exists (fresh install or deleted dir)
    fs.mkdirSync(JARVIS_DIR, { recursive: true })

    // Pre-restore snapshot: save current files for rollback
    const rollbackDir = join(BACKUPS_DIR, `rollback-${Date.now()}`)
    fs.mkdirSync(rollbackDir, { recursive: true })
    for (const file of safeFiles) {
      const currentPath = join(JARVIS_DIR, file.name)
      if (fs.existsSync(currentPath)) {
        fs.copyFileSync(currentPath, join(rollbackDir, file.name))
      }
    }

    // Copy each safe file back to ~/.jarvis/
    const restored: string[] = []
    for (const file of safeFiles) {
      const src = join(resolvedPath, file.name)
      const dest = join(JARVIS_DIR, file.name)
      fs.copyFileSync(src, dest)
      restored.push(file.name)
    }

    // Post-restore health validation
    const healthChecks: Array<{ name: string; ok: boolean; message: string }> = []
    for (const dbName of ['runtime.db', 'crm.db', 'knowledge.db']) {
      const dbPath = join(JARVIS_DIR, dbName)
      if (!fs.existsSync(dbPath)) {
        healthChecks.push({ name: dbName, ok: false, message: 'File missing after restore' })
        continue
      }
      let healthDb: DatabaseSync | undefined
      try {
        healthDb = new DatabaseSync(dbPath)
        const integrity = healthDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
        healthChecks.push({
          name: dbName,
          ok: integrity.integrity_check === 'ok',
          message: integrity.integrity_check === 'ok' ? 'Integrity OK' : `Integrity failed: ${integrity.integrity_check}`,
        })
      } catch (e) {
        healthChecks.push({ name: dbName, ok: false, message: e instanceof Error ? e.message : 'Cannot open' })
      } finally {
        try { healthDb?.close() } catch { /* best-effort */ }
      }
    }

    const allHealthy = healthChecks.every(c => c.ok)

    if (!allHealthy) {
      // Attempt rollback from pre-restore snapshot
      let rollbackOk = true
      for (const file of safeFiles) {
        const rollbackSrc = join(rollbackDir, file.name)
        if (fs.existsSync(rollbackSrc)) {
          try {
            fs.copyFileSync(rollbackSrc, join(JARVIS_DIR, file.name))
          } catch {
            rollbackOk = false
          }
        }
      }

      const actor = getActor(req as AuthenticatedRequest)
      writeAuditLog(actor.type, actor.id, 'backup.restore_rollback', 'backup', resolvedPath, {
        reason: 'post_restore_health_failed',
        rollback_ok: rollbackOk,
      })

      const rollbackStatus = rollbackOk
        ? 'successful'
        : 'partial — manual intervention may be needed. Check /api/safemode or /api/repair.'

      res.status(500).json({
        ok: false,
        error: 'Restore failed health validation — rolled back to previous state',
        health_checks: healthChecks,
        rollback: rollbackStatus,
        rollback_dir: rollbackDir,
      })
      return
    }

    // Cleanup rollback snapshot on success
    try { fs.rmSync(rollbackDir, { recursive: true, force: true }) } catch { /* best effort */ }

    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'backup.restored', 'backup', resolvedPath, { restored, healthy: allHealthy })

    res.json({ ok: true, restored, health_checks: healthChecks, healthy: allHealthy })
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Restore failed: ${err instanceof Error ? err.message : String(err)}`
    })
  }
})
