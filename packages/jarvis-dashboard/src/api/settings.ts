import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'

const JARVIS_DIR = join(os.homedir(), '.jarvis')
const CONFIG_PATH = join(JARVIS_DIR, 'config.json')

// Sensitive fields that should be masked when reading
const SENSITIVE_KEYS = ['token', 'secret', 'password', 'api_key', 'apiKey', 'bot_token', 'webhook_url']

function maskSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSensitive(value as Record<string, unknown>)
    } else if (typeof value === 'string' && SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      masked[key] = value.length > 4 ? '****' + value.slice(-4) : '****'
    } else {
      masked[key] = value
    }
  }
  return masked
}

function readConfig(): Record<string, unknown> {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeConfig(config: Record<string, unknown>) {
  if (!fs.existsSync(JARVIS_DIR)) {
    fs.mkdirSync(JARVIS_DIR, { recursive: true })
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

const AGENT_META: Record<string, { label: string; description: string; schedule: string }> = {
  'orchestrator': {
    label: 'Orchestrator',
    description: 'Top-level coordinator: decomposes goals into agent DAGs, manages execution',
    schedule: 'On demand'
  },
  'self-reflection': {
    label: 'Self-Reflection & Improvement',
    description: 'Weekly system health analysis, ranked improvement proposals',
    schedule: 'Sundays at 6:00 AM'
  },
  'regulatory-watch': {
    label: 'Regulatory Intelligence Watch',
    description: 'Tracks ISO 26262, ISO 21434, ASPICE, EU regulatory changes',
    schedule: 'Mon/Thu at 7:00 AM'
  },
  'knowledge-curator': {
    label: 'Knowledge Curator',
    description: 'Ingests documents and meetings, resolves entities, monitors collection health',
    schedule: 'Weekdays at 6:00 AM'
  },
  'proposal-engine': {
    label: 'Proposal & Quote Engine',
    description: 'Analyzes RFQs/SOWs, builds quote structures, generates proposals, handles invoicing',
    schedule: 'On demand'
  },
  'evidence-auditor': {
    label: 'ISO 26262 / ASPICE Evidence Auditor',
    description: 'Audits project evidence against ISO 26262 and ASPICE baselines',
    schedule: 'Mondays at 9:00 AM'
  },
  'contract-reviewer': {
    label: 'Contract Reviewer',
    description: 'Analyzes NDA/MSA/SOW clauses against TIC baseline and regulatory landscape',
    schedule: 'On demand'
  },
  'staffing-monitor': {
    label: 'Staffing Monitor',
    description: 'Tracks 23-engineer utilization, forecasts gaps, matches skills to pipeline',
    schedule: 'Mondays at 9:00 AM'
  },
}

export const settingsRouter = Router()

// GET / — read config (masked)
settingsRouter.get('/', (_req, res) => {
  const config = readConfig()
  res.json(maskSensitive(config))
})

// PATCH / — partial update to config
settingsRouter.patch('/', (req, res) => {
  const updates = req.body as Record<string, unknown>
  const config = readConfig()
  // Deep merge
  const maskedConfig = maskSensitive(config)
  function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>, masked: Record<string, unknown>): Record<string, unknown> {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') {
        target[key] = deepMerge(
          target[key] as Record<string, unknown>,
          value as Record<string, unknown>,
          (masked[key] ?? {}) as Record<string, unknown>
        )
      } else {
        // Don't overwrite with masked values — compare against exact masked value sent to client
        if (typeof value === 'string' && typeof masked[key] === 'string' && value === masked[key] && /^\*{4}/.test(value)) continue
        target[key] = value
      }
    }
    return target
  }
  const merged = deepMerge(config, updates, maskedConfig)
  writeConfig(merged)
  const actor = getActor(req as AuthenticatedRequest)
  writeAuditLog(actor.type, actor.id, 'settings.updated', 'settings', 'config', { keys: Object.keys(updates) })
  res.json(maskSensitive(merged))
})

// GET /agents — list agent definitions with meta + enabled state
settingsRouter.get('/agents', (_req, res) => {
  const config = readConfig()
  const enabledAgents = (config.enabled_agents ?? {}) as Record<string, boolean>
  const agents = Object.entries(AGENT_META).map(([id, meta]) => ({
    id,
    ...meta,
    enabled: enabledAgents[id] !== false // default to enabled
  }))
  res.json(agents)
})

// PATCH /agents/:id — update agent config (enable/disable)
settingsRouter.patch('/agents/:id', (req, res) => {
  const { id } = req.params
  if (!AGENT_META[id]) {
    res.status(404).json({ error: `Unknown agent: ${id}` })
    return
  }
  const { enabled } = req.body as { enabled?: boolean }
  const config = readConfig()
  if (!config.enabled_agents) config.enabled_agents = {}
  ;(config.enabled_agents as Record<string, boolean>)[id] = enabled !== false
  writeConfig(config)
  const actor = getActor(req as AuthenticatedRequest)
  writeAuditLog(actor.type, actor.id, 'agent.toggled', 'agent', id, { enabled: enabled !== false })
  res.json({ id, enabled: enabled !== false })
})

// ─── Repair API ──────────────────────────────────────────────────────────────

settingsRouter.post('/repair', (req, res) => {
  const { check = 'all' } = req.body as { check?: 'lmstudio' | 'databases' | 'config' | 'all' }
  const checks: Array<{ name: string; ok: boolean; message: string }> = []

  if (check === 'config' || check === 'all') {
    try {
      const config = readConfig()
      const hasLms = typeof config.lmstudio_url === 'string'
      const hasMode = typeof config.adapter_mode === 'string'
      checks.push({ name: 'config', ok: hasLms && hasMode, message: hasLms && hasMode ? 'Config valid' : 'Missing lmstudio_url or adapter_mode' })
    } catch {
      checks.push({ name: 'config', ok: false, message: 'Cannot read config.json' })
    }
  }

  if (check === 'databases' || check === 'all') {
    for (const dbName of ['runtime.db', 'crm.db', 'knowledge.db']) {
      const dbPath = join(JARVIS_DIR, dbName)
      if (!fs.existsSync(dbPath)) {
        checks.push({ name: dbName, ok: false, message: `${dbName} not found` })
      } else {
        let db: DatabaseSync | undefined
        try {
          db = new DatabaseSync(dbPath)
          db.prepare('SELECT 1').get()
          checks.push({ name: dbName, ok: true, message: `${dbName} accessible` })
        } catch {
          checks.push({ name: dbName, ok: false, message: `${dbName} corrupted or locked` })
        } finally {
          try { db?.close() } catch {}
        }
      }
    }
  }

  if (check === 'lmstudio' || check === 'all') {
    // Sync check — just verify config has a URL
    const config = readConfig()
    const url = config.lmstudio_url as string | undefined
    checks.push({ name: 'lmstudio', ok: !!url, message: url ? `LM Studio configured at ${url}` : 'No lmstudio_url in config' })
  }

  const allOk = checks.every(c => c.ok)
  const actor = getActor(req as AuthenticatedRequest)
  writeAuditLog(actor.type, actor.id, 'settings.repair', 'settings', check, { checks })
  res.json({ repaired: allOk, checks, message: allOk ? 'All checks passed' : 'Some checks failed — see details' })
})

// ─── Expert Mode API ───────────────────────────────────────────────────────

function getModeDb(): DatabaseSync {
  const dbPath = join(JARVIS_DIR, 'runtime.db')
  if (!fs.existsSync(dbPath)) {
    throw new Error('runtime.db not found')
  }
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const modeRouter = Router()

// GET / — read current UI mode
modeRouter.get('/', (_req, res) => {
  let db: DatabaseSync | null = null
  try {
    db = getModeDb()
    const row = db.prepare(
      "SELECT value_json FROM settings WHERE key = 'ui_mode'"
    ).get() as { value_json: string } | undefined

    const mode = row ? JSON.parse(row.value_json) as string : 'simple'
    res.json({ mode })
  } catch {
    // If DB doesn't exist yet, default to simple
    res.json({ mode: 'simple' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// POST / — set UI mode
modeRouter.post('/', (req, res) => {
  const { mode } = req.body as { mode?: string }

  if (mode !== 'simple' && mode !== 'expert') {
    res.status(400).json({ error: 'mode must be "simple" or "expert"' })
    return
  }

  let db: DatabaseSync | null = null
  try {
    db = getModeDb()
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES ('ui_mode', ?, ?)"
    ).run(JSON.stringify(mode), new Date().toISOString())

    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'mode.changed', 'settings', 'ui_mode', { mode })

    res.json({ mode })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
