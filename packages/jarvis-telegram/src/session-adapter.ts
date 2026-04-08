import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  sendSessionMessage,
  type GatewayCallOptions,
} from '@jarvis/shared'
import { ChannelStore } from '@jarvis/runtime'
import type { ApprovalEntry } from './approvals.js'
import { claimUnnotifiedPending, formatApprovalMessage } from './approvals.js'
import { openRuntimeDb } from './config.js'
import { handleFreeText, type ChatContext } from './chat-handler.js'
import {
  getStatus,
  getCrmTop5,
  triggerAgent,
  handleApproval,
  getHelpText,
  COMMAND_TO_AGENT,
  TRIGGER_AGENTS,
  type TriggerAgentId,
} from './command-handlers.js'

// ─── Types ──────────────────────────────────────────────────────────────────

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
  /**
   * When true, free-text messages are routed through the OpenClaw gateway
   * session instead of the legacy HTTP loopback to /api/chat/telegram.
   * This removes one network hop and proves the Epic 5 operator chat path.
   */
  sessionChat?: boolean
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
  private readonly config: SessionAdapterConfig

  constructor(config: SessionAdapterConfig) {
    this.config = config
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
    const contentHash = createHash('sha256').update(truncated).digest('hex').slice(0, 12)
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

    const handlerCtx = {
      channelStore: this.channelStore,
      threadId: this.threadId,
      sender,
    }

    switch (command.kind) {
      case 'status':
        return getStatus()

      case 'crm':
        return getCrmTop5()

      case 'approve':
        return handleApproval(command.shortId, 'approved', handlerCtx)

      case 'reject':
        return handleApproval(command.shortId, 'rejected', handlerCtx)

      case 'help':
        return getHelpText()

      case 'agent_trigger':
        return triggerAgent(command.agentId, command.rawText, handlerCtx)

      case 'free_text': {
        // When sessionChat is enabled, route free-text through the OpenClaw
        // gateway session directly — no HTTP loopback to /api/chat/telegram.
        if (this.config.sessionChat) {
          try {
            const result = await sendSessionMessage(
              { sessionKey: this.sessionKey, message: command.text },
              undefined,
              this.gatewayOverrides,
            )
            // Normalize response — gateway may return reply, content, or text
            if (typeof result === 'object' && result !== null) {
              const r = result as Record<string, unknown>
              const text = r.reply ?? r.content ?? r.text
              if (typeof text === 'string' && text.length > 0) return text
            }
            return 'Session responded but no reply text was returned.'
          } catch {
            // Fall back to legacy HTTP relay on session failure
          }
        }

        // Legacy path: HTTP relay to /api/chat/telegram
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

