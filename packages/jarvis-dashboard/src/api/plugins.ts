import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import { join } from 'path'

const PLUGINS_DIR = join(os.homedir(), '.jarvis', 'plugins')
const CONFIG_PATH = join(os.homedir(), '.jarvis', 'config.json')

interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  agent: Record<string, unknown>
  knowledge_seeds?: Array<{
    collection: string
    title: string
    content: string
    tags: string[]
  }>
  config_requirements?: string[]
  installed_at: string
}

function loadPlugins(): PluginManifest[] {
  if (!fs.existsSync(PLUGINS_DIR)) return []

  const dirs = fs.readdirSync(PLUGINS_DIR).filter(d => {
    try {
      return fs.statSync(join(PLUGINS_DIR, d)).isDirectory()
    } catch {
      return false
    }
  })

  const manifests: PluginManifest[] = []
  for (const dir of dirs) {
    const manifestPath = join(PLUGINS_DIR, dir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest
      manifests.push(manifest)
    } catch {
      // Skip malformed manifests
    }
  }

  return manifests
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

function installPlugin(sourcePath: string): PluginManifest {
  const manifestPath = join(sourcePath, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json found at ${sourcePath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest

  if (!manifest.id || !manifest.name || !manifest.version) {
    throw new Error('Plugin manifest must contain id, name, and version')
  }

  const targetDir = join(PLUGINS_DIR, manifest.id)
  fs.mkdirSync(targetDir, { recursive: true })

  // Write manifest with install timestamp
  manifest.installed_at = new Date().toISOString()
  fs.writeFileSync(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  // Copy prompt files if they exist
  const promptsDir = join(sourcePath, 'prompts')
  if (fs.existsSync(promptsDir)) {
    const targetPrompts = join(targetDir, 'prompts')
    fs.mkdirSync(targetPrompts, { recursive: true })
    for (const f of fs.readdirSync(promptsDir)) {
      const srcFile = join(promptsDir, f)
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, join(targetPrompts, f))
      }
    }
  }

  return manifest
}

function uninstallPlugin(pluginId: string): boolean {
  const dir = join(PLUGINS_DIR, pluginId)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true })
  return true
}

export const pluginsRouter = Router()

// GET /api/plugins — list installed plugins with config status
pluginsRouter.get('/', (_req, res) => {
  const plugins = loadPlugins()
  const configured = getConfiguredIntegrations()

  const enriched = plugins.map(plugin => ({
    ...plugin,
    config_status: (plugin.config_requirements ?? []).map(req => ({
      integration: req,
      configured: configured.includes(req),
    })),
  }))

  res.json(enriched)
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

  try {
    const manifest = installPlugin(sourcePath)
    res.json({ status: 'installed', plugin: manifest })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

// DELETE /api/plugins/:id — uninstall a plugin
pluginsRouter.delete('/:id', (req, res) => {
  const removed = uninstallPlugin(req.params.id)
  res.json({ status: removed ? 'removed' : 'not_found' })
})
