import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import fs from 'node:fs'
import { join } from 'node:path'
import { createCommand } from '@jarvis/runtime'
import {
  verifyWebhookSignature,
  normalizeGithubWebhook,
  normalizeGenericWebhook,
  normalizeCustomWebhook,
  webhookEventToCommand,
} from '@jarvis/shared'
import type { NormalizedWebhookEvent, WebhookCommandParams } from '@jarvis/shared'

const JARVIS_DIR = join(os.homedir(), '.jarvis')

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
 * Issue a command via createCommand() and write an audit log entry.
 * Accepts the pre-built params from webhookEventToCommand() plus
 * a triggeredBy label for the audit row.
 */
function issueCommandAndAudit(params: WebhookCommandParams, triggeredBy: string): string {
  const db = getDb()

  try {
    const { commandId } = createCommand(db, params)

    // Write audit log entry — this is domain logic that stays in the ingress layer
    db.prepare(`
      INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), 'webhook', triggeredBy, 'trigger.created', 'agent', params.agentId, JSON.stringify(params.payload), new Date().toISOString())

    return commandId
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
}

/**
 * Get the raw body string from a request, falling back to JSON.stringify
 * when the rawBody middleware is not configured.
 */
function getRawBody(req: import('express').Request): string {
  return typeof (req as any).rawBody === "string"
    ? (req as any).rawBody
    : JSON.stringify(req.body)
}

export const webhookRouter = Router()

// POST /api/webhooks/github — GitHub webhook handler
webhookRouter.post('/github', (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined
  const secret = loadWebhookSecret()

  // --- Signature verification via shared normalizer ---
  let signatureVerified = false
  if (secret && signature) {
    const rawBody = getRawBody(req)
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
    signatureVerified = true
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

  // --- Normalize via shared normalizer ---
  const normalized = normalizeGithubWebhook({ event, payload, signatureVerified })
  if (!normalized) {
    res.json({ status: 'ignored', event, message: `No agent mapped for event: ${event}` })
    return
  }

  const cmdParams = webhookEventToCommand(normalized)
  issueCommandAndAudit(cmdParams, `webhook:github:${event}`)

  res.json({
    status: 'triggered',
    agentId: normalized.agent_id,
    event,
    triggeredAt: normalized.received_at,
  })
})

// POST /api/webhooks/generic — generic JSON webhook
webhookRouter.post('/generic', (req, res) => {
  const secret = loadWebhookSecret()

  // --- Signature verification via shared normalizer ---
  let signatureVerified = false
  if (secret) {
    const signature = req.headers['x-jarvis-signature'] as string | undefined
    if (!signature || !verifyWebhookSignature(JSON.stringify(req.body), signature, secret)) {
      res.status(401).json({ error: 'Invalid or missing X-Jarvis-Signature' })
      return
    }
    signatureVerified = true
  }

  // --- Normalize via shared normalizer ---
  const result = normalizeGenericWebhook({
    payload: req.body as Record<string, unknown>,
    signatureVerified,
  })

  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }

  const cmdParams = webhookEventToCommand(result.event)
  issueCommandAndAudit(cmdParams, 'webhook:generic')

  res.json({
    status: 'triggered',
    agentId: result.event.agent_id,
    triggeredAt: result.event.received_at,
  })
})

// POST /api/webhooks/:agentId — trigger any agent with optional payload
webhookRouter.post('/:agentId', (req, res) => {
  const secret = loadWebhookSecret()

  // --- Signature verification via shared normalizer ---
  let signatureVerified = false
  if (secret) {
    const signature = req.headers['x-jarvis-signature'] as string | undefined
    if (!signature || !verifyWebhookSignature(JSON.stringify(req.body), signature, secret)) {
      res.status(401).json({ error: 'Invalid or missing X-Jarvis-Signature' })
      return
    }
    signatureVerified = true
  }

  const { agentId } = req.params

  // --- Normalize via shared normalizer ---
  const normalized = normalizeCustomWebhook({
    agentId: agentId!,
    payload: req.body as Record<string, unknown>,
    signatureVerified,
  })

  const cmdParams = webhookEventToCommand(normalized)
  issueCommandAndAudit(cmdParams, 'webhook')

  res.json({
    status: 'triggered',
    agentId,
    triggeredAt: normalized.received_at,
  })
})
