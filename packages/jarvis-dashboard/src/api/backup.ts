import { Router } from 'express'
import os from 'os'
import { join } from 'path'
import fs from 'fs'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'

const JARVIS_DIR = join(os.homedir(), '.jarvis')
const BACKUPS_DIR = join(JARVIS_DIR, 'backups')
const CONFIG_PATH = join(JARVIS_DIR, 'config.json')

// Files to include in backup
const BACKUP_FILES = ['config.json', 'crm.db', 'knowledge.db', 'runtime.db']

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
    for (const name of BACKUP_FILES) {
      const src = join(JARVIS_DIR, name)
      if (fs.existsSync(src)) {
        const dest = join(backupDir, name)
        fs.copyFileSync(src, dest)
        const stat = fs.statSync(dest)
        files.push({ name, size: stat.size })
      }
    }

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

    // Validate all files exist in the backup before restoring
    const missing: string[] = []
    for (const file of manifest.files) {
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

    // Copy each file back to ~/.jarvis/
    const restored: string[] = []
    for (const file of manifest.files) {
      const src = join(resolvedPath, file.name)
      const dest = join(JARVIS_DIR, file.name)
      fs.copyFileSync(src, dest)
      restored.push(file.name)
    }

    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'backup.restored', 'backup', resolvedPath, { restored })

    res.json({ ok: true, restored })
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Restore failed: ${err instanceof Error ? err.message : String(err)}`
    })
  }
})
