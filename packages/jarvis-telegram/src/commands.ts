import { DatabaseSync } from 'node:sqlite'
import { createCommand, ChannelStore } from '@jarvis/runtime'
import { CRM_DB, openRuntimeDb } from './config.js'
import { loadApprovals, resolveApproval } from './approvals.js'
import { handleFreeText, type ParsedAction } from './chat-handler.js'

const AGENTS = [
  'bd-pipeline', 'proposal-engine', 'evidence-auditor', 'contract-reviewer',
  'staffing-monitor', 'content-engine', 'portfolio-monitor', 'garden-calendar',
  'email-campaign', 'social-engagement', 'security-monitor', 'drive-watcher',
  'invoice-generator', 'meeting-transcriber'
]

export type CommandContext = {
  channelStore?: ChannelStore
  threadId?: string
  telegramMessageId?: string
  chatId?: string
  sender?: string
}

export async function handleCommand(text: string, ctx?: CommandContext): Promise<string> {
  const parts = text.trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase() ?? ''
  const arg = parts[1] ?? ''

  // Slash commands — fast path, no LLM needed
  if (cmd.startsWith('/')) {
    switch (cmd) {
      case '/status': return getStatus()
      case '/crm': return getCrmTop5()
      case '/portfolio': return triggerAgent('portfolio-monitor', text, ctx)
      case '/garden': return triggerAgent('garden-calendar', text, ctx)
      case '/bd': return triggerAgent('bd-pipeline', text, ctx)
      case '/content': return triggerAgent('content-engine', text, ctx)
      case '/approve': return handleApproval(arg, 'approved', ctx)
      case '/reject': return handleApproval(arg, 'rejected', ctx)
      case '/help': return getHelp()
      default: return `Unknown command: ${cmd}\n\nSend /help for available commands.`
    }
  }

  // Free-text — route through LLM
  return handleFreeTextMessage(text, ctx)
}

async function handleFreeTextMessage(text: string, ctx?: CommandContext): Promise<string> {
  const { text: reply, actions } = await handleFreeText(text)
  const parts: string[] = []

  // Execute any actions the LLM requested
  for (const action of actions) {
    parts.push(await executeAction(action, text, ctx))
  }

  // Combine LLM reply with action results
  if (parts.length > 0) {
    return `${reply}\n\n${parts.join('\n\n')}`
  }
  return reply
}

async function executeAction(action: ParsedAction, text: string, ctx?: CommandContext): Promise<string> {
  switch (action.type) {
    case 'trigger':
      return triggerAgent(action.agentId, text, ctx)
    case 'status':
      return getStatus()
    case 'crm':
      return getCrmTop5()
  }
}

function getStatus(): string {
  const lines = ['JARVIS STATUS\n']
  let db: DatabaseSync | undefined

  try {
    db = openRuntimeDb()

    // Last run per agent from runtime.db runs table
    for (const agentId of AGENTS) {
      const row = db.prepare(
        'SELECT started_at, status FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1'
      ).get(agentId) as { started_at: string; status: string } | undefined
      const ts = row ? new Date(row.started_at).toLocaleDateString() : 'never'
      const status = row?.status ?? ''
      lines.push(`${agentId}: ${ts}${status ? ` (${status})` : ''}`)
    }

    // Pending approvals from runtime.db
    const pending = loadApprovals(db, 'pending')
    lines.push(`\nPending approvals: ${pending.length}`)
  } catch {
    lines.push('(could not read runtime.db)')
  } finally {
    try { db?.close() } catch {}
  }

  return lines.join('\n')
}

function getCrmTop5(): string {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(CRM_DB)
    const contacts = db.prepare(
      "SELECT name, company, stage, score FROM contacts WHERE stage NOT IN ('won','lost','parked') ORDER BY score DESC LIMIT 5"
    ).all() as Array<{ name: string; company: string; stage: string; score: number }>

    if (contacts.length === 0) return 'CRM: No active contacts.'
    const lines = ['TOP CRM CONTACTS\n']
    for (const c of contacts) {
      lines.push(`${c.name} @ ${c.company} — ${c.stage} (score: ${c.score})`)
    }
    return lines.join('\n')
  } catch {
    return 'CRM: Could not read database.'
  } finally {
    db?.close()
  }
}

/**
 * Trigger an agent via the centralized command factory.
 * Records the inbound message in the channel store if available.
 */
function triggerAgent(agentId: string, messageText: string, ctx?: CommandContext): string {
  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()
    const { commandId } = createCommand(db, {
      agentId,
      source: 'telegram',
      channelStore: ctx?.channelStore,
      threadId: ctx?.threadId,
      messagePreview: messageText,
      sender: ctx?.sender,
    })
    return `Triggered ${agentId} (${commandId.slice(0, 8)}). It will run within the next scheduled cycle.`
  } catch (e) {
    return `Failed to trigger ${agentId}: ${String(e)}`
  } finally {
    try { db?.close() } catch {}
  }
}

/**
 * Approve or reject a pending approval via runtime.db.
 * Records the action as a channel message if tracking is available.
 */
function handleApproval(shortId: string, status: 'approved' | 'rejected', ctx?: CommandContext): string {
  if (!shortId) return `Usage: /approve <id> or /reject <id>`
  if (shortId.length < 6) return 'Approval ID must be at least 6 characters for safety.'

  let db: DatabaseSync | undefined
  try {
    db = openRuntimeDb()
    const pending = loadApprovals(db, 'pending')
    const target = pending.find(a => a.id.startsWith(shortId))
    if (!target) return `No pending approval found with ID starting: ${shortId}`

    const ok = resolveApproval(db, target.id, status)
    if (!ok) return `Failed to ${status === 'approved' ? 'approve' : 'reject'} — may already be resolved.`

    // Record the approval action as a channel message
    if (ctx?.channelStore && ctx?.threadId) {
      try {
        ctx.channelStore.recordMessage({
          threadId: ctx.threadId,
          channel: 'telegram',
          externalId: ctx.telegramMessageId,
          direction: 'inbound',
          contentPreview: `/${status === 'approved' ? 'approve' : 'reject'} ${shortId}`,
          sender: ctx.sender,
          runId: target.run_id,
        })
      } catch { /* best-effort */ }
    }

    return `${status === 'approved' ? '✅' : '❌'} ${target.action} by ${target.agent} has been ${status}.`
  } catch (e) {
    return `Failed to process approval: ${String(e)}`
  } finally {
    try { db?.close() } catch {}
  }
}

function getHelp(): string {
  return `JARVIS BOT COMMANDS

/status        — All agents last-run + pending approvals
/crm           — Top 5 active pipeline contacts
/portfolio     — Trigger portfolio-monitor
/garden        — Trigger garden-calendar
/bd            — Trigger BD pipeline
/content       — Trigger content engine
/approve <id>  — Approve a gated action
/reject <id>   — Reject a gated action
/help          — This message

You can also send free-text messages and I'll understand what you need. Try:
• "check my portfolio"
• "what's the system status?"
• "run the evidence auditor"`
}
