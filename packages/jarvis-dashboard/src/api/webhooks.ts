import { Router } from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { configureJarvisStatePersistence, getJarvisState } from '@jarvis/shared'

const JARVIS_DIR = join(os.homedir(), '.jarvis')
const RUNTIME_DB_PATH = join(JARVIS_DIR, 'runtime.sqlite')

// Ensure JarvisState is configured for this process
configureJarvisStatePersistence({ databasePath: RUNTIME_DB_PATH })

const GITHUB_EVENT_TO_AGENT: Record<string, string> = {
  push: 'evidence-auditor',
  pull_request: 'contract-reviewer',
  issues: 'bd-pipeline',
}

function loadWebhookSecret(): string | undefined {
  const configPath = join(JARVIS_DIR, 'config.json')
  if (!fs.existsSync(configPath)) return undefined
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    return raw.webhook_secret as string | undefined
  } catch {
    return undefined
  }
}

/** Submit an agent.start job to JarvisState */
function submitTrigger(agentId: string, triggeredBy: string, context: Record<string, unknown>): { job_id?: string } {
  const result = getJarvisState().submitJob({
    type: "agent.start",
    input: {
      agent_id: agentId,
      trigger_kind: "event",
      triggered_by: triggeredBy,
      context,
    },
  })
  return { job_id: result.job_id }
}

export const webhookRouter = Router()

// POST /api/webhooks/github — GitHub webhook handler
// Must be registered before the :agentId catch-all
webhookRouter.post('/github', (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined
  const secret = loadWebhookSecret()

  if (secret && signature) {
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(JSON.stringify(req.body))
    const expected = 'sha256=' + hmac.digest('hex')

    if (signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
  } else if (secret && !signature) {
    // Secret is configured but request has no signature — reject
    res.status(401).json({ error: 'Missing signature' })
    return
  }

  const event = req.headers['x-github-event'] as string | undefined
  const payload = req.body as Record<string, unknown>

  if (!event) {
    res.status(400).json({ error: 'Missing X-GitHub-Event header' })
    return
  }

  const agentId = GITHUB_EVENT_TO_AGENT[event]
  if (!agentId) {
    res.json({ status: 'ignored', event, message: `No agent mapped for event: ${event}` })
    return
  }

  const { job_id } = submitTrigger(agentId, `webhook:github:${event}`, {
    github_event: event,
    action: payload.action,
    repository: (payload.repository as Record<string, unknown>)?.full_name,
    sender: (payload.sender as Record<string, unknown>)?.login,
  })

  res.json({
    status: 'triggered',
    agentId,
    job_id,
    event,
    triggeredAt: new Date().toISOString(),
  })
})

// POST /api/webhooks/generic — generic JSON webhook
// Must be registered before the :agentId catch-all
webhookRouter.post('/generic', (req, res) => {
  const body = req.body as Record<string, unknown>
  const agentId = body.agent_id as string | undefined
  const context = (body.context as Record<string, unknown>) ?? {}

  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ error: 'Missing or invalid agent_id field' })
    return
  }

  const { job_id } = submitTrigger(agentId, 'webhook:generic', context)

  res.json({
    status: 'triggered',
    agentId,
    job_id,
    triggeredAt: new Date().toISOString(),
  })
})

// POST /api/webhooks/:agentId — trigger any agent with optional payload
webhookRouter.post('/:agentId', (req, res) => {
  const { agentId } = req.params
  const payload = req.body as Record<string, unknown>

  const { job_id } = submitTrigger(agentId, 'webhook', payload)

  res.json({
    status: 'triggered',
    agentId,
    job_id,
    triggeredAt: new Date().toISOString(),
  })
})
