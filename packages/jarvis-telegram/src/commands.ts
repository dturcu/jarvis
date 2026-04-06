import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { configureJarvisStatePersistence, getJarvisState } from '@jarvis/shared'
import { CRM_DB, JARVIS_DIR } from './config.js'
import { loadApprovals, saveApprovals, setApprovalStatus } from './approvals.js'

const RUNTIME_DB_PATH = join(JARVIS_DIR, 'runtime.sqlite')

// Ensure JarvisState is configured for this process
configureJarvisStatePersistence({ databasePath: RUNTIME_DB_PATH })

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

  // Last completed job per agent from JarvisState
  try {
    const state = getJarvisState()
    const db = (state as unknown as { db: DatabaseSync }).db
    if (db) {
      const rows = db.prepare(`
        SELECT job_id, status, updated_at, record_json
        FROM jobs
        WHERE job_type = 'agent.start'
          AND status IN ('completed', 'failed')
        ORDER BY updated_at DESC
      `).all() as Array<{ job_id: string; status: string; updated_at: string; record_json: string }>

      const seen = new Set<string>()
      for (const row of rows) {
        try {
          const record = JSON.parse(row.record_json) as { envelope: { input: { agent_id?: string } } }
          const agentId = record.envelope?.input?.agent_id
          if (typeof agentId === 'string' && !seen.has(agentId)) {
            seen.add(agentId)
            const ts = new Date(row.updated_at).toLocaleDateString()
            lines.push(`${agentId}: ${ts} (${row.status})`)
          }
        } catch { /* skip */ }
      }

      // Show agents with no runs
      for (const id of AGENTS) {
        if (!seen.has(id)) {
          lines.push(`${id}: never`)
        }
      }
    }
  } catch {
    lines.push('(could not read runtime DB)')
  }

  // Pending approvals from JarvisState
  try {
    const state = getJarvisState()
    const db = (state as unknown as { db: DatabaseSync }).db
    if (db) {
      const row = db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE state = 'pending'").get() as { count: number }
      lines.push(`\nPending approvals: ${row.count}`)
    }
  } catch {
    // Fall back to legacy
    const approvals = loadApprovals().filter(a => a.status === 'pending')
    lines.push(`\nPending approvals: ${approvals.length}`)
  }

  return lines.join('\n')
}

function getCrmTop5(): string {
  try {
    const db = new DatabaseSync(CRM_DB)
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
    // Submit to JarvisState instead of writing trigger file
    const result = getJarvisState().submitJob({
      type: "agent.start",
      input: {
        agent_id: agentId,
        trigger_kind: "manual",
        triggered_by: "telegram",
      },
    })
    return `Triggered ${agentId} (job: ${result.job_id ?? 'submitted'}). It will run within the next poll cycle.`
  } catch (e) {
    return `Failed to trigger ${agentId}: ${String(e)}`
  }
}

function handleApproval(shortId: string, status: 'approved' | 'rejected'): string {
  if (!shortId) return `Usage: /approve <id> or /reject <id>`

  // Try JarvisState first
  try {
    const result = getJarvisState().resolveApproval(shortId, status)
    if (result) {
      const emoji = status === 'approved' ? '✅' : '❌'
      return `${emoji} Approval ${shortId} has been ${status}.`
    }
  } catch { /* fall through to legacy */ }

  // Fall back to legacy approvals file
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
