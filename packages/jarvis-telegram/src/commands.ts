import fs from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { TRIGGER_DIR, CRM_DB, KNOWLEDGE_DB } from './config.js'
import { loadApprovals, saveApprovals, setApprovalStatus } from './approvals.js'

const AGENTS = [
  'bd-pipeline', 'proposal-engine', 'evidence-auditor', 'contract-reviewer',
  'staffing-monitor', 'content-engine', 'portfolio-monitor', 'garden-calendar'
]

export async function handleCommand(text: string): Promise<string> {
  const parts = text.trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase() ?? ''
  const arg = parts[1] ?? ''

  switch (cmd) {
    case '/status': return getStatus()
    case '/crm': return getCrmTop5()
    case '/portfolio': return triggerAgent('portfolio-monitor')
    case '/garden': return triggerAgent('garden-calendar')
    case '/bd': return triggerAgent('bd-pipeline')
    case '/content': return triggerAgent('content-engine')
    case '/approve': return handleApproval(arg, 'approved')
    case '/reject': return handleApproval(arg, 'rejected')
    case '/help': return getHelp()
    default: return `Unknown command: ${cmd}\n\nSend /help for available commands.`
  }
}

function getStatus(): string {
  const lines = ['JARVIS STATUS\n']

  // Last decision per agent
  try {
    const kb = new DatabaseSync(join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.jarvis', 'knowledge.db'))
    for (const agentId of AGENTS) {
      const row = kb.prepare(
        'SELECT created_at, outcome FROM decisions WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(agentId) as { created_at: string; outcome: string } | undefined
      const ts = row ? new Date(row.created_at).toLocaleDateString() : 'never'
      lines.push(`${agentId}: ${ts}`)
    }
    kb.close()
  } catch {
    lines.push('(could not read knowledge.db)')
  }

  // Pending approvals
  const approvals = loadApprovals().filter(a => a.status === 'pending')
  lines.push(`\nPending approvals: ${approvals.length}`)

  return lines.join('\n')
}

function getCrmTop5(): string {
  try {
    const db = new DatabaseSync(join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.jarvis', 'crm.db'))
    const contacts = db.prepare(
      "SELECT name, company, stage, score FROM contacts WHERE stage NOT IN ('won','lost','parked') ORDER BY score DESC LIMIT 5"
    ).all() as Array<{ name: string; company: string; stage: string; score: number }>
    db.close()

    if (contacts.length === 0) return 'CRM: No active contacts.'
    const lines = ['TOP CRM CONTACTS\n']
    for (const c of contacts) {
      lines.push(`${c.name} @ ${c.company} — ${c.stage} (score: ${c.score})`)
    }
    return lines.join('\n')
  } catch {
    return 'CRM: Could not read database.'
  }
}

function triggerAgent(agentId: string): string {
  try {
    const triggerFile = join(TRIGGER_DIR, `trigger-${agentId}.json`)
    fs.writeFileSync(triggerFile, JSON.stringify({
      agent: agentId,
      triggered_at: new Date().toISOString(),
      source: 'telegram'
    }, null, 2))
    return `Triggered ${agentId}. It will run within the next scheduled cycle.`
  } catch (e) {
    return `Failed to trigger ${agentId}: ${String(e)}`
  }
}

function handleApproval(shortId: string, status: 'approved' | 'rejected'): string {
  if (!shortId) return `Usage: /approve <id> or /reject <id>`
  const approvals = loadApprovals()
  const target = approvals.find(a => a.id.startsWith(shortId) && a.status === 'pending')
  if (!target) return `No pending approval found with ID starting: ${shortId}`
  const updated = setApprovalStatus(approvals, target.id, status)
  saveApprovals(updated)
  return `${status === 'approved' ? '✅' : '❌'} ${target.action} by ${target.agent} has been ${status}.`
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
/help          — This message`
}
