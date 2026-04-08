import { Router } from 'express'
import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import fs from 'node:fs'
import { join } from 'node:path'
import { createCommand } from '@jarvis/runtime'

const JARVIS_DIR = join(os.homedir(), '.jarvis')

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

function getDb(): DatabaseSync {
  const db = new DatabaseSync(join(JARVIS_DIR, 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

/**
 * Insert a command into agent_commands table via the centralized command factory.
 * Also writes an audit log entry for webhook triggers.
 */
function insertCommand(agentId: string, triggeredBy: string, context: Record<string, unknown>): string {
  const db = getDb()
  // Use agent_id + timestamp as idempotency key to prevent rapid duplicate triggers
  const idempotencyKey = `${agentId}:${triggeredBy}:${Math.floor(Date.now() / 10_000)}`

  try {
    const { commandId } = createCommand(db, {
      agentId,
      source: 'webhook',
      payload: context,
      idempotencyKey,
    })

    // Write audit log entry
    db.prepare(`
      INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), 'webhook', triggeredBy, 'trigger.created', 'agent', agentId, JSON.stringify(context), new Date().toISOString())

    return commandId
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
}

export const webhookRouter = Router()

// POST /api/webhooks/github — GitHub webhook handler
webhookRouter.post('/github', (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined
  const secret = loadWebhookSecret()

  if (secret && signature) {
    // Use the raw request body bytes for HMAC, not re-serialized JSON.
    // Providers sign the exact payload — JSON.stringify(req.body) can
    // differ in whitespace/key ordering and fail verification.
    const rawBody = typeof (req as any).rawBody === "string"
      ? (req as any).rawBody
      : JSON.stringify(req.body); // fallback if rawBody middleware not configured
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(rawBody)
    const expected = 'sha256=' + hmac.digest('hex')

    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expected)
    // Pad both buffers to the same length to avoid leaking length information
    const maxLen = Math.max(sigBuf.length, expBuf.length)
    const paddedSig = Buffer.alloc(maxLen)
    const paddedExp = Buffer.alloc(maxLen)
    sigBuf.copy(paddedSig)
    expBuf.copy(paddedExp)

    if (sigBuf.length !== expBuf.length ||
        !crypto.timingSafeEqual(paddedSig, paddedExp)) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
  } else if (secret && !signature) {
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

  insertCommand(agentId, `webhook:github:${event}`, {
    github_event: event,
    action: payload.action,
    repository: (payload.repository as Record<string, unknown>)?.full_name,
    sender: (payload.sender as Record<string, unknown>)?.login,
    payload,
  })

  res.json({
    status: 'triggered',
    agentId,
    event,
    triggeredAt: new Date().toISOString(),
  })
})

/**
 * Validate HMAC signature for non-GitHub webhooks when webhook_secret is configured.
 * Expects X-Jarvis-Signature header with format: sha256=<hex>
 */
function validateHmac(req: import('express').Request, secret: string | undefined): boolean {
  if (!secret) return true; // no secret configured, skip validation

  const signature = req.headers['x-jarvis-signature'] as string | undefined
  if (!signature) return false

  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(JSON.stringify(req.body))
  const expected = 'sha256=' + hmac.digest('hex')

  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  const maxLen = Math.max(sigBuf.length, expBuf.length)
  const paddedSig = Buffer.alloc(maxLen)
  const paddedExp = Buffer.alloc(maxLen)
  sigBuf.copy(paddedSig)
  expBuf.copy(paddedExp)

  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(paddedSig, paddedExp)
}

// POST /api/webhooks/generic — generic JSON webhook
webhookRouter.post('/generic', (req, res) => {
  const secret = loadWebhookSecret()
  if (secret && !validateHmac(req, secret)) {
    res.status(401).json({ error: 'Invalid or missing X-Jarvis-Signature' })
    return
  }

  const body = req.body as Record<string, unknown>
  const agentId = body.agent_id as string | undefined
  const context = (body.context as Record<string, unknown>) ?? {}

  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ error: 'Missing or invalid agent_id field' })
    return
  }

  insertCommand(agentId, 'webhook:generic', context)

  res.json({
    status: 'triggered',
    agentId,
    triggeredAt: new Date().toISOString(),
  })
})

// POST /api/webhooks/:agentId — trigger any agent with optional payload
webhookRouter.post('/:agentId', (req, res) => {
  const secret = loadWebhookSecret()
  if (secret && !validateHmac(req, secret)) {
    res.status(401).json({ error: 'Invalid or missing X-Jarvis-Signature' })
    return
  }

  const { agentId } = req.params
  const payload = req.body as Record<string, unknown>

  insertCommand(agentId!, 'webhook', payload)

  res.json({
    status: 'triggered',
    agentId,
    triggeredAt: new Date().toISOString(),
  })
})
