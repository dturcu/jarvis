import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'

const JARVIS_DIR = join(os.homedir(), '.jarvis')
const BACKUPS_DIR = join(JARVIS_DIR, 'backups')

const CONFIG_FILES = ['config.json'] as const
const SQLITE_DATABASE_FILES = ['crm.db', 'knowledge.db', 'runtime.db'] as const
const BACKUP_FILES = [...CONFIG_FILES, ...SQLITE_DATABASE_FILES] as const
const LEGACY_WAL_SIDECARS = ['runtime.db-wal', 'runtime.db-shm', 'crm.db-wal', 'crm.db-shm', 'knowledge.db-wal', 'knowledge.db-shm'] as const
const ALLOWED_RESTORE = new Set<string>([...BACKUP_FILES, ...LEGACY_WAL_SIDECARS])
const SQLITE_SIDECARS = ['-wal', '-shm'] as const

type BackupManifest = {
  timestamp: string
  files: Array<{ name: string; size: number }>
  total_size: number
}

type BackupStatusResponse = {
  last_backup: string | null
  last_backup_at: string | null
  path?: string | null
  last_backup_path: string | null
  files?: Array<{ name: string; size: number }>
  size?: number
  size_mb?: number | null
}

function formatTimestamp(now: Date): string {
  return now.toISOString()
    .replace(/[T]/g, '-')
    .replace(/[:]/g, '')
    .replace(/\.\d+Z$/, '')
}

function sqliteStringLiteral(value: string): string {
  return value.replace(/\\/g, '/').replace(/'/g, "''")
}

function removeIfExists(path: string): void {
  try {
    if (fs.existsSync(path)) fs.unlinkSync(path)
  } catch { /* best effort */ }
}

function clearSqliteSidecars(basePath: string): void {
  for (const suffix of SQLITE_SIDECARS) {
    removeIfExists(basePath + suffix)
  }
}

export function snapshotSqliteDatabase(sourcePath: string, targetPath: string): void {
  removeIfExists(targetPath)
  const db = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000;')
    db.exec(`VACUUM INTO '${sqliteStringLiteral(targetPath)}'`)
  } finally {
    try { db.close() } catch {}
  }
}

export function createBackupSnapshot(
  jarvisDir = JARVIS_DIR,
  backupsDir = BACKUPS_DIR,
  now = new Date(),
): { backupDir: string; files: Array<{ name: string; size: number }>; totalSize: number; manifest: BackupManifest } {
  const backupDir = join(backupsDir, `backup-${formatTimestamp(now)}`)
  fs.mkdirSync(backupDir, { recursive: true })

  const files: Array<{ name: string; size: number }> = []

  for (const name of CONFIG_FILES) {
    const src = join(jarvisDir, name)
    if (!fs.existsSync(src)) continue
    const dest = join(backupDir, name)
    fs.copyFileSync(src, dest)
    files.push({ name, size: fs.statSync(dest).size })
  }

  for (const name of SQLITE_DATABASE_FILES) {
    const src = join(jarvisDir, name)
    if (!fs.existsSync(src)) continue
    const dest = join(backupDir, name)
    snapshotSqliteDatabase(src, dest)
    files.push({ name, size: fs.statSync(dest).size })
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0)
  const manifest: BackupManifest = {
    timestamp: now.toISOString(),
    files,
    total_size: totalSize,
  }

  fs.writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { backupDir, files, totalSize, manifest }
}

export function getBackupStatus(backupsDir = BACKUPS_DIR): BackupStatusResponse {
  if (!fs.existsSync(backupsDir)) {
    return {
      last_backup: null,
      last_backup_at: null,
      last_backup_path: null,
      size_mb: null,
    }
  }

  const entries = fs.readdirSync(backupsDir)
    .filter(entry => entry.startsWith('backup-'))
    .sort()

  if (entries.length === 0) {
    return {
      last_backup: null,
      last_backup_at: null,
      last_backup_path: null,
      size_mb: null,
    }
  }

  const latest = entries[entries.length - 1]
  const backupPath = join(backupsDir, latest)
  const manifestPath = join(backupPath, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    return {
      last_backup: latest,
      last_backup_at: latest,
      path: backupPath,
      last_backup_path: backupPath,
      files: [],
      size: 0,
      size_mb: 0,
    }
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
  return {
    last_backup: manifest.timestamp,
    last_backup_at: manifest.timestamp,
    path: backupPath,
    last_backup_path: backupPath,
    files: manifest.files,
    size: manifest.total_size,
    size_mb: Number((manifest.total_size / (1024 * 1024)).toFixed(2)),
  }
}

export function restoreBackupDirectory(
  backupPath: string,
  jarvisDir = JARVIS_DIR,
): { restored: string[] } {
  const manifestPath = join(backupPath, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json not found in backup path')
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    files: Array<{ name: string; size: number }>
  }

  const safeFiles = manifest.files.filter((file) => {
    const name = file.name
    return ALLOWED_RESTORE.has(name) && !name.includes('/') && !name.includes('\\') && !name.includes('..')
  })

  const missing: string[] = []
  for (const file of safeFiles) {
    if (!fs.existsSync(join(backupPath, file.name))) {
      missing.push(file.name)
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing files in backup: ${missing.join(', ')}`)
  }

  for (const dbName of SQLITE_DATABASE_FILES) {
    const hasDatabaseSnapshot = safeFiles.some(file => file.name === dbName)
    const hasLegacySidecar = safeFiles.some(file => file.name === `${dbName}-wal` || file.name === `${dbName}-shm`)
    if (hasDatabaseSnapshot || hasLegacySidecar) {
      clearSqliteSidecars(join(jarvisDir, dbName))
    }
  }

  const restored: string[] = []
  for (const file of safeFiles) {
    fs.copyFileSync(join(backupPath, file.name), join(jarvisDir, file.name))
    restored.push(file.name)
  }

  return { restored }
}

export const backupRouter = Router()

backupRouter.post('/', (req, res) => {
  try {
    const { backupDir, files, totalSize } = createBackupSnapshot()

    if (files.length === 0) {
      res.status(400).json({ ok: false, error: 'No files found to back up' })
      return
    }

    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'backup.created', 'backup', backupDir, {
      files: files.map(file => file.name),
      total_size: totalSize,
    })

    res.json({
      ok: true,
      path: backupDir,
      files,
      total_size: totalSize,
    })
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

backupRouter.get('/status', (_req, res) => {
  try {
    res.json(getBackupStatus())
  } catch {
    res.json({
      last_backup: null,
      last_backup_at: null,
      last_backup_path: null,
      size_mb: null,
    })
  }
})

backupRouter.post('/restore', (req, res) => {
  const { backup_path } = req.body as { backup_path?: string }

  if (!backup_path) {
    res.status(400).json({ ok: false, error: 'backup_path is required' })
    return
  }

  const resolvedPath = backup_path.replace(/^~/, os.homedir())

  try {
    const runtimeDbPath = join(JARVIS_DIR, 'runtime.db')
    if (fs.existsSync(runtimeDbPath)) {
      let checkDb: DatabaseSync | null = null
      try {
        checkDb = new DatabaseSync(runtimeDbPath)
        checkDb.exec('PRAGMA journal_mode = WAL;')
        checkDb.exec('PRAGMA busy_timeout = 5000;')
        const heartbeat = checkDb.prepare(
          'SELECT last_seen_at, pid FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1',
        ).get() as { last_seen_at: string; pid: number } | undefined
        if (heartbeat) {
          const staleness = Date.now() - new Date(heartbeat.last_seen_at).getTime()
          if (staleness < 30_000 && req.body.force !== true) {
            res.status(409).json({
              ok: false,
              error: 'Daemon is running. Stop it before restoring, or pass force: true to override.',
              daemon_pid: heartbeat.pid,
            })
            return
          }
        }
      } catch {
        if (req.body.force !== true) {
          res.status(409).json({
            ok: false,
            error: 'Could not verify daemon state. Stop the daemon first, or pass force: true to override.',
          })
          return
        }
      } finally {
        try { checkDb?.close() } catch {}
      }
    }

    const result = restoreBackupDirectory(resolvedPath)

    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'backup.restored', 'backup', resolvedPath, {
      files: result.restored,
    })

    res.json({ ok: true, restored: result.restored })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'manifest.json not found in backup path') {
      res.status(404).json({ ok: false, error: message })
      return
    }
    if (message.startsWith('Missing files in backup:')) {
      res.status(400).json({ ok: false, error: message })
      return
    }
    res.status(500).json({
      ok: false,
      error: `Restore failed: ${message}`,
    })
  }
})
