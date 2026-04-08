/**
 * Unified command handler implementations shared by both the legacy bot
 * (commands.ts) and the session adapter (session-adapter.ts).
 *
 * Each handler accepts its dependencies as parameters rather than importing
 * them directly, keeping this module free of side-effects and easy to test.
 */
import { DatabaseSync } from 'node:sqlite'
import { createCommand, ChannelStore } from '@jarvis/runtime'
import { loadApprovals, resolveApproval } from './approvals.js'
import { openRuntimeDb, CRM_DB } from './config.js'

// ─── Constants ─────────────────────────────────────────────────────────────

/** Agents that can be triggered via slash commands. */
export const TRIGGER_AGENTS = [
  'orchestrator', 'self-reflection', 'regulatory-watch', 'knowledge-curator',
  'proposal-engine', 'evidence-auditor', 'contract-reviewer', 'staffing-monitor',
] as const

export type TriggerAgentId = (typeof TRIGGER_AGENTS)[number]

/** Map of Telegram slash commands to agent IDs. */
export const COMMAND_TO_AGENT: Record<string, TriggerAgentId> = {
  '/orchestrator': 'orchestrator',
  '/reflect': 'self-reflection',
  '/regulatory': 'regulatory-watch',
  '/knowledge': 'knowledge-curator',
  '/proposal': 'proposal-engine',
  '/evidence': 'evidence-auditor',
  '/contract': 'contract-reviewer',
  '/staffing': 'staffing-monitor',
}

// ─── Handler Options ───────────────────────────────────────────────────────

export type HandlerContext = {
  db?: DatabaseSync
  channelStore?: ChannelStore
  threadId?: string
  telegramMessageId?: string
  sender?: string
}

// ─── Handlers ──────────────────────────────────────────────────────────────

/**
 * Return a status summary: last run per agent + pending approval count.
 * If `opts.db` is provided it is used (and NOT closed); otherwise a
 * temporary connection to runtime.db is opened and closed automatically.
 */
export function getStatus(opts?: { db?: DatabaseSync }): string {
  const lines = ['JARVIS STATUS\n']
  let db = opts?.db
  const ownsDb = !db

  try {
    if (!db) db = openRuntimeDb()

    for (const agentId of TRIGGER_AGENTS) {
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
    if (ownsDb) {
      try { db?.close() } catch { /* ignore */ }
    }
  }

  return lines.join('\n')
}

/**
 * Return the top 5 active CRM contacts by score.
 * `crmDbPath` defaults to the configured CRM_DB location.
 */
export function getCrmTop5(crmDbPath: string = CRM_DB): string {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(crmDbPath)
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
    try { db?.close() } catch { /* ignore */ }
  }
}

/**
 * Trigger an agent via the centralized command factory.
 * Records the inbound message in the channel store if available.
 */
export function triggerAgent(
  agentId: string,
  messageText: string,
  opts?: HandlerContext,
): string {
  let db = opts?.db
  const ownsDb = !db

  try {
    if (!db) db = openRuntimeDb()
    const { commandId } = createCommand(db, {
      agentId,
      source: 'telegram',
      channelStore: opts?.channelStore,
      threadId: opts?.threadId,
      messagePreview: messageText,
      sender: opts?.sender,
    })
    return `Triggered ${agentId} (${commandId.slice(0, 8)}). It will run within the next scheduled cycle.`
  } catch (e) {
    return `Failed to trigger ${agentId}: ${String(e)}`
  } finally {
    if (ownsDb) {
      try { db?.close() } catch { /* ignore */ }
    }
  }
}

/**
 * Approve or reject a pending approval via runtime.db.
 * Records the action as a channel message if tracking is available.
 */
export function handleApproval(
  shortId: string,
  status: 'approved' | 'rejected',
  opts?: HandlerContext,
): string {
  if (!shortId) return 'Usage: /approve <id> or /reject <id>'
  if (shortId.length < 6) return 'Approval ID must be at least 6 characters for safety.'

  let db = opts?.db
  const ownsDb = !db

  try {
    if (!db) db = openRuntimeDb()
    const pending = loadApprovals(db, 'pending')
    const target = pending.find(a => a.id.startsWith(shortId))
    if (!target) return `No pending approval found with ID starting: ${shortId}`

    const ok = resolveApproval(db, target.id, status)
    if (!ok) return `Failed to ${status === 'approved' ? 'approve' : 'reject'} — may already be resolved.`

    // Record the approval action in the channel store
    if (opts?.channelStore && opts?.threadId) {
      try {
        opts.channelStore.recordMessage({
          threadId: opts.threadId,
          channel: 'telegram',
          externalId: opts.telegramMessageId,
          direction: 'inbound',
          contentPreview: `/${status === 'approved' ? 'approve' : 'reject'} ${shortId}`,
          sender: opts.sender,
          runId: target.run_id,
        })
      } catch { /* best-effort */ }
    }

    return `${status === 'approved' ? '✅' : '❌'} ${target.action} by ${target.agent} has been ${status}.`
  } catch (e) {
    return `Failed to process approval: ${String(e)}`
  } finally {
    if (ownsDb) {
      try { db?.close() } catch { /* ignore */ }
    }
  }
}

/**
 * Return the help text listing all available bot commands.
 */
export function getHelpText(): string {
  return `JARVIS BOT COMMANDS

/status        — All agents last-run + pending approvals
/crm           — Top 5 active pipeline contacts
/orchestrator  — Trigger orchestrator
/reflect       — Trigger self-reflection
/regulatory    — Trigger regulatory watch
/knowledge     — Trigger knowledge curator
/proposal      — Trigger proposal engine
/evidence      — Trigger evidence auditor
/contract      — Trigger contract reviewer
/staffing      — Trigger staffing monitor
/approve <id>  — Approve a gated action
/reject <id>   — Reject a gated action
/help          — This message

You can also send free-text messages and I'll understand what you need. Try:
• "what's the system status?"
• "run the evidence auditor"
• "check staffing for next quarter"`
}
