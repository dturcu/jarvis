import { Router } from 'express'
import os from 'os'
import { join } from 'path'
import fs from 'fs'

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
  'bd-pipeline': {
    label: 'BD Pipeline',
    description: 'Scan for BD signals, enrich leads, draft outreach, update CRM',
    schedule: 'Weekdays at 8:00 AM'
  },
  'proposal-engine': {
    label: 'Proposal Engine',
    description: 'Analyze RFQ/SOW, build quote structure, draft proposal',
    schedule: 'On demand'
  },
  'evidence-auditor': {
    label: 'Evidence Auditor',
    description: 'Scan project for ISO 26262 work products, produce gap matrix',
    schedule: 'Mondays at 9:00 AM'
  },
  'contract-reviewer': {
    label: 'Contract Reviewer',
    description: 'Analyze NDA/MSA clauses, produce sign/negotiate/escalate recommendation',
    schedule: 'On demand'
  },
  'staffing-monitor': {
    label: 'Staffing Monitor',
    description: 'Calculate team utilization, forecast gaps, match skills to pipeline',
    schedule: 'Mondays at 9:00 AM'
  },
  'content-engine': {
    label: 'Content Engine',
    description: 'Draft LinkedIn post for today\'s content pillar',
    schedule: 'Mon/Wed/Thu at 7:00 AM'
  },
  'portfolio-monitor': {
    label: 'Portfolio Monitor',
    description: 'Check crypto prices, calculate drift, recommend rebalance',
    schedule: 'Daily at 8:00 AM & 8:00 PM'
  },
  'garden-calendar': {
    label: 'Garden Calendar',
    description: 'Generate weekly garden brief based on date + weather',
    schedule: 'Mondays at 7:00 AM'
  },
  'social-engagement': {
    label: 'Social Engagement',
    description: 'Engage with LinkedIn connections and industry content',
    schedule: 'Weekdays at 12:00 PM'
  }
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
  res.json({ id, enabled: enabled !== false })
})
