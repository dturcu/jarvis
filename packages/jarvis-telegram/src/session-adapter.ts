import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  sendSessionMessage,
  type GatewayCallOptions,
} from '@jarvis/shared'
import { createCommand, ChannelStore } from '@jarvis/runtime'
import type { ApprovalEntry } from './approvals.js'
import { loadApprovals, resolveApproval, claimUnnotifiedPending, formatApprovalMessage } from './approvals.js'
import { openRuntimeDb, CRM_DB } from './config.js'
import { handleFreeText, type ChatContext } from './chat-handler.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Agents that can be triggered via slash commands. */
const TRIGGER_AGENTS = [
  'orchestrator', 'self-reflection', 'regulatory-watch', 'knowledge-curator',
  'proposal-engine', 'evidence-auditor', 'contract-reviewer', 'staffing-monitor',
] as const

type TriggerAgentId = (typeof TRIGGER_AGENTS)[number]

/** Map of Telegram slash commands to agent IDs. */
const COMMAND_TO_AGENT: Record<string, TriggerAgentId> = {
  '/orchestrator': 'orchestrator',
  '/reflect': 'self-reflection',
  '/regulatory': 'regulatory-watch',
  '/knowledge': 'knowledge-curator',
  '/proposal': 'proposal-engine',
  '/evidence': 'evidence-auditor',
  '/contract': 'contract-reviewer',
  '/staffing': 'staffing-monitor',
}

type TelegramCommand =
  | { kind: 'status' }
  | { kind: 'crm' }
  | { kind: 'approve'; shortId: string }
  | { kind: 'reject'; shortId: string }
  | { kind: 'help' }
  | { kind: 'agent_trigger'; agentId: TriggerAgentId; rawText: string }
  | { kind: 'free_text'; text: string }
  | { kind: 'unknown'; command: string }

export type SessionAdapterConfig = {
  /** OpenClaw session key for the Telegram channel (e.g. "telegram:main"). */
  sessionKey: string
  /** Optional gateway connection overrides. Falls back to env vars. */
  gatewayOverrides?: GatewayCallOptions
  /** Optional channel store for message tracking. */
  channelStore?: ChannelStore
  /** Optional thread ID for channel message recording. */
  threadId?: string
}

// ─── Command Parser ─────────────────────────────────────────────────────────

/**
 * Parse raw Telegram text into a structured command descriptor.
 * This replaces the switch/case in commands.ts with a pure mapping function.
 */
export function mapTelegramCommandToSession(text: string): TelegramCommand {
  const trimmed = text.trim()
  const parts = trimmed.split(/\s+/)
  const cmd = parts[0]?.toLowerCase() ?? ''
  const arg = parts[1] ?? ''

  if (!cmd.startsWith('/')) {
    return { kind: 'free_text', text: trimmed }
  }

  switch (cmd) {
    case '/status':
      return { kind: 'status' }
    case '/crm':
      return { kind: 'crm' }
    case '/approve':
      return { kind: 'approve', shortId: arg }
    case '/reject':
      return { kind: 'reject', shortId: arg }
    case '/help':
      return { kind: 'help' }
    default: {
      const agentId = COMMAND_TO_AGENT[cmd]
      if (agentId) {
        return { kind: 'agent_trigger', agentId, rawText: trimmed }
      }
      return { kind: 'unknown', command: cmd }
    }
  }
}

// ─── Session Adapter ────────────────────────────────────────────────────────

/**
 * OpenClaw session-based adapter for Telegram delivery.
 *
 * Instead of calling `https://api.telegram.org/bot{token}/sendMessage` directly,
 * this routes all outbound messages through `sendSessionMessage` from @jarvis/shared,
 * which delivers via the OpenClaw gateway's `sessions.send` method.
 *
 * The OpenClaw gateway is responsible for the actual Telegram API integration.
 * Jarvis only talks to OpenClaw sessions -- it never touches external APIs directly.
 */
export class TelegramSessionAdapter {
  private readonly sessionKey: string
  private readonly gatewayOverrides: GatewayCallOptions
  private readonly channelStore: ChannelStore | undefined
  private readonly threadId: string | undefined

  constructor(config: SessionAdapterConfig) {
    this.sessionKey = config.sessionKey
    this.gatewayOverrides = config.gatewayOverrides ?? {}
    this.channelStore = config.channelStore
    this.threadId = config.threadId
  }

  // ─── Core send ──────────────────────────────────────────────────────

  /**
   * Send a text message via the OpenClaw session instead of direct Telegram API.
   * Truncates to 4096 chars (Telegram limit) before sending.
   */
  async send(text: string): Promise<void> {
    const truncated = text.slice(0, 4096)
    // Derive idempotency key from message content + time bucket so retries
    // within the same 10-second window are deduplicated, not re-sent.
    const crypto = await import('node:crypto')
    const contentHash = crypto.createHash('sha256').update(truncated).digest('hex').slice(0, 12)
    const timeBucket = Math.floor(Date.now() / 10_000)
    const idempotencyKey = `tg-session-${contentHash}-${timeBucket}`

    await sendSessionMessage(
      {
        sessionKey: this.sessionKey,
        message: truncated,
        idempotencyKey,
      },
      undefined, // no OpenClawConfig -- relies on env vars via resolveGatewayCallOptions
      this.gatewayOverrides,
    )

    // Record outbound message in channel store (best-effort)
    if (this.channelStore && this.threadId) {
      try {
        this.channelStore.recordMessage({
          threadId: this.threadId,
          channel: 'telegram',
          direction: 'outbound',
          contentPreview: truncated,
          sender: 'jarvis',
        })
      } catch { /* best-effort */ }
    }
  }

  // ─── Approval notifications ─────────────────────────────────────────

  /**
   * Send an approval notification via the session channel.
   * Replaces the direct Telegram API call in JarvisBot.checkApprovals().
   */
  async notifyApproval(entry: ApprovalEntry): Promise<void> {
    const message = formatApprovalMessage(entry)
    await this.send(message)

    // Record specifically as an approval notification
    if (this.channelStore && this.threadId) {
      try {
        this.channelStore.recordMessage({
          threadId: this.threadId,
          channel: 'telegram',
          direction: 'outbound',
          contentPreview: `Approval needed: ${entry.action} by ${entry.agent}`,
          sender: 'jarvis',
          runId: entry.run_id,
        })
      } catch { /* best-effort */ }
    }
  }

  /**
   * Check for pending approvals and send notifications via session.
   * Equivalent to JarvisBot.checkApprovals() but routed through OpenClaw.
   */
  async checkApprovals(): Promise<void> {
    let db: DatabaseSync | undefined
    try {
      db = openRuntimeDb()
    } catch {
      return
    }

    try {
      const claimed = claimUnnotifiedPending(db)
      for (const entry of claimed) {
        try {
          await this.notifyApproval(entry)
        } catch {
          // Notification row already inserted by claimUnnotifiedPending,
          // so this entry won't be re-sent. Send failure is acceptable
          // since the approval still appears in the dashboard.
        }
      }
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  }

  // ─── Command response delivery ──────────────────────────────────────

  /**
   * Deliver a command response via the session channel.
   * The commandId is included for traceability in the channel store.
   */
  async deliverCommandResponse(commandId: string, response: string): Promise<void> {
    await this.send(response)

    if (this.channelStore && this.threadId) {
      try {
        this.channelStore.recordMessage({
          threadId: this.threadId,
          channel: 'telegram',
          direction: 'outbound',
          contentPreview: response,
          sender: 'jarvis',
          commandId,
        })
      } catch { /* best-effort */ }
    }
  }

  // ─── Full command handling (via session) ─────────────────────────────

  /**
   * Handle a Telegram message by mapping it to a session command and
   * delivering the response through the OpenClaw session.
   *
   * This is the session-mode equivalent of JarvisBot.pollOnce() processing.
   */
  async handleMessage(text: string, sender?: string): Promise<string> {
    const command = mapTelegramCommandToSession(text)

    switch (command.kind) {
      case 'status':
        return getStatusViaSession()

      case 'crm':
        return getCrmTop5ViaSession()

      case 'approve':
        return handleApprovalViaSession(command.shortId, 'approved', {
          channelStore: this.channelStore,
          threadId: this.threadId,
          sender,
        })

      case 'reject':
        return handleApprovalViaSession(command.shortId, 'rejected', {
          channelStore: this.channelStore,
          threadId: this.threadId,
          sender,
        })

      case 'help':
        return getHelpText()

      case 'agent_trigger':
        return triggerAgentViaSession(command.agentId, command.rawText, {
          channelStore: this.channelStore,
          threadId: this.threadId,
          sender,
        })

      case 'free_text': {
        const chatCtx: ChatContext = {
          channelStore: this.channelStore,
          threadId: this.threadId,
        }
        const { text: reply } = await handleFreeText(command.text, chatCtx)
        return reply
      }

      case 'unknown':
        return `Unknown command: ${command.command}\n\nSend /help for available commands.`
    }
  }
}

// ─── Session-mode query handlers ────────────────────────────────────────────
//
// These mirror the functions in commands.ts but are designed for the session
// adapter path. They read from the same databases but deliver results via
// the session channel rather than direct Telegram API.

function getStatusViaSession(): string {
  const agents = [
    'orchestrator', 'self-reflection', 'regulatory-watch', 'knowledge-curator',
    'proposal-engine', 'evidence-auditor', 'contract-reviewer', 'staffing-monitor',
  ]
  const lines = ['JARVIS STATUS\n']
  let db: DatabaseSync | undefined

  try {
    db = openRuntimeDb()

    for (const agentId of agents) {
      const row = db.prepare(
        'SELECT started_at, status FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1'
      ).get(agentId) as { started_at: string; status: string } | undefined
      const ts = row ? new Date(row.started_at).toLocaleDateString() : 'never'
      const status = row?.status ?? ''
      lines.push(`${agentId}: ${ts}${status ? ` (${status})` : ''}`)
    }

    const pending = loadApprovals(db, 'pending')
    lines.push(`\nPending approvals: ${pending.length}`)
  } catch {
    lines.push('(could not read runtime.db)')
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }

  return lines.join('\n')
}

function getCrmTop5ViaSession(): string {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(CRM_DB)
    const contacts = db.prepare(
      "SELECT name, company, stage, score FROM contacts WHERE stage NOT IN ('won','lost','parked') ORDER BY score DESC LIMIT 5"
    ).all() as Array<{ name: string; company: string; stage: string; score: number }>

    if (contacts.length === 0) return 'CRM: No active contacts.'
    const lines = ['TOP CRM CONTACTS\n']
    for (const c of contacts) {
      lines.push(`${c.name} @ ${c.company} -- ${c.stage} (score: ${c.score})`)
    }
    return lines.join('\n')
  } catch {
    return 'CRM: Could not read database.'
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

type SessionCommandContext = {
  channelStore?: ChannelStore
  threadId?: string
  sender?: string
}

function triggerAgentViaSession(
  agentId: string,
  messageText: string,
  ctx: SessionCommandContext,
): string {
  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()
    const { commandId } = createCommand(db, {
      agentId,
      source: 'telegram',
      channelStore: ctx.channelStore,
      threadId: ctx.threadId,
      messagePreview: messageText,
      sender: ctx.sender,
    })
    return `Triggered ${agentId} (${commandId.slice(0, 8)}). It will run within the next scheduled cycle.`
  } catch (e) {
    return `Failed to trigger ${agentId}: ${String(e)}`
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

function handleApprovalViaSession(
  shortId: string,
  status: 'approved' | 'rejected',
  ctx: SessionCommandContext,
): string {
  if (!shortId) return 'Usage: /approve <id> or /reject <id>'
  if (shortId.length < 6) return 'Approval ID must be at least 6 characters for safety.'

  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()
    const pending = loadApprovals(db, 'pending')
    const target = pending.find(a => a.id.startsWith(shortId))
    if (!target) return `No pending approval found with ID starting: ${shortId}`

    const ok = resolveApproval(db, target.id, status)
    if (!ok) return `Failed to ${status === 'approved' ? 'approve' : 'reject'} -- may already be resolved.`

    // Record the approval action in the channel store
    if (ctx.channelStore && ctx.threadId) {
      try {
        ctx.channelStore.recordMessage({
          threadId: ctx.threadId,
          channel: 'telegram',
          direction: 'inbound',
          contentPreview: `/${status === 'approved' ? 'approve' : 'reject'} ${shortId}`,
          sender: ctx.sender,
          runId: target.run_id,
        })
      } catch { /* best-effort */ }
    }

    const icon = status === 'approved' ? '[OK]' : '[REJECTED]'
    return `${icon} ${target.action} by ${target.agent} has been ${status}.`
  } catch (e) {
    return `Failed to process approval: ${String(e)}`
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

function getHelpText(): string {
  return `JARVIS BOT COMMANDS

/status        -- All agents last-run + pending approvals
/crm           -- Top 5 active pipeline contacts
/orchestrator  -- Trigger orchestrator
/reflect       -- Trigger self-reflection
/regulatory    -- Trigger regulatory watch
/knowledge     -- Trigger knowledge curator
/proposal      -- Trigger proposal engine
/evidence      -- Trigger evidence auditor
/contract      -- Trigger contract reviewer
/staffing      -- Trigger staffing monitor
/approve <id>  -- Approve a gated action
/reject <id>   -- Reject a gated action
/help          -- This message

You can also send free-text messages and I'll understand what you need.`
}
