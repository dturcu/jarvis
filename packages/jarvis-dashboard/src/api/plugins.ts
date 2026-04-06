import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'
import {
  loadPlugins,
  installPlugin,
  uninstallPlugin,
  validateManifest,
  deriveRequiredPermissions,
} from '@jarvis/runtime'

const CONFIG_PATH = join(os.homedir(), '.jarvis', 'config.json')

function getDb(): DatabaseSync | undefined {
  try {
    const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec('PRAGMA busy_timeout = 5000;')
    return db
  } catch {
    return undefined
  }
}

function getConfiguredIntegrations(): string[] {
  if (!fs.existsSync(CONFIG_PATH)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>
    const configured: string[] = []
    if (raw.gmail) configured.push('gmail')
    if (raw.calendar) configured.push('calendar')
    if (raw.chrome) configured.push('chrome')
    if (raw.telegram) configured.push('telegram')
    return configured
  } catch {
    return []
  }
}

export const pluginsRouter = Router()

// GET /api/plugins — list installed plugins with config status and permissions
pluginsRouter.get('/', (_req, res) => {
  const plugins = loadPlugins()
  const configured = getConfiguredIntegrations()

  const enriched = plugins.map(plugin => ({
    ...plugin,
    config_status: (plugin.config_requirements ?? []).map(req => ({
      integration: req,
      configured: configured.includes(req),
    })),
    required_permissions: deriveRequiredPermissions(plugin.agent.capabilities),
    granted_permissions: plugin.permissions ?? [],
  }))

  res.json(enriched)
})

// POST /api/plugins/validate — validate a manifest without installing
pluginsRouter.post('/validate', (req, res) => {
  const result = validateManifest(req.body)
  res.json(result)
})

// POST /api/plugins/install — install plugin from a local directory path
pluginsRouter.post('/install', (req, res) => {
  const { path: sourcePath } = req.body as { path?: string }

  if (!sourcePath || typeof sourcePath !== 'string') {
    res.status(400).json({ error: 'Missing or invalid path field' })
    return
  }

  if (!fs.existsSync(sourcePath)) {
    res.status(400).json({ error: `Path does not exist: ${sourcePath}` })
    return
  }

  const db = getDb()
  try {
    const actor = getActor(req as AuthenticatedRequest)
    const result = installPlugin(sourcePath, { db, actor: actor.id })

    writeAuditLog(actor.type, actor.id, 'plugin.installed', 'plugin', result.manifest.id, {
      version: result.manifest.version,
      status: result.status,
      previous_version: result.previous_version,
    })

    res.json(result)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// DELETE /api/plugins/:id — uninstall a plugin
pluginsRouter.delete('/:id', (req, res) => {
  const db = getDb()
  try {
    const actor = getActor(req as AuthenticatedRequest)
    const removed = uninstallPlugin(req.params.id!, { db, actor: actor.id })

    if (removed) {
      writeAuditLog(actor.type, actor.id, 'plugin.uninstalled', 'plugin', req.params.id!, {})
    }

    res.json({ status: removed ? 'removed' : 'not_found' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
