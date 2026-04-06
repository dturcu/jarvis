import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { existsSync } from 'node:fs'
import os from 'os'
import { join } from 'path'

function getRuntimeDb(): DatabaseSync {
  const dbPath = join(os.homedir(), '.jarvis', 'runtime.db')
  if (!existsSync(dbPath)) throw new Error('runtime.db not found')
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

const AGENT_LABELS: Record<string, string> = {
  'bd-pipeline': 'BD Pipeline',
  'proposal-engine': 'Proposal Engine',
  'evidence-auditor': 'Evidence Auditor',
  'contract-reviewer': 'Contract Reviewer',
  'staffing-monitor': 'Staffing Monitor',
  'content-engine': 'Content Engine',
  'portfolio-monitor': 'Portfolio Monitor',
  'garden-calendar': 'Garden Calendar',
  'email-campaign': 'Email Campaign',
  'social-engagement': 'Social Engagement',
  'security-monitor': 'Security Monitor',
  'drive-watcher': 'Drive Watcher',
  'invoice-generator': 'Invoice Generator',
  'meeting-transcriber': 'Meeting Transcriber',
}

/** Audit log actions that map to settings_change events. */
const SETTINGS_ACTIONS = new Set([
  'settings.updated',
  'agent.toggled',
  'model.toggled',
  'mode.changed',
])

/** Audit log actions that map to backup events. */
const BACKUP_ACTIONS = new Set([
  'backup.created',
  'backup.restored',
  'backup.restore_rollback',
])

/** Audit log actions that map to system events. */
const SYSTEM_ACTIONS = new Set([
  'service.restart_requested',
  'service.restart_failed',
])

/** Audit log actions already covered by the approvals table (skip). */
const APPROVAL_AUDIT_ACTIONS = new Set([
  'approval.approved',
  'approval.rejected',
])

/** Classify an audit_log action into a history event type, or null to skip. */
function classifyAuditAction(action: string): string | null {
  if (APPROVAL_AUDIT_ACTIONS.has(action)) return null
  if (SETTINGS_ACTIONS.has(action)) return 'settings_change'
  if (BACKUP_ACTIONS.has(action)) return 'backup'
  if (SYSTEM_ACTIONS.has(action)) return 'system'
  return 'system' // default bucket for unrecognized audit entries
}

/** Map a run status to a normalized history event status. */
function runStatusToEventStatus(status: string): string {
  switch (status) {
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'failed'
    case 'queued':
    case 'planning':
    case 'executing':
    case 'awaiting_approval': return 'pending'
    default: return status
  }
}

/** Map an approval status to a normalized history event status. */
function approvalStatusToEventStatus(status: string): string {
  switch (status) {
    case 'approved': return 'completed'
    case 'rejected':
    case 'expired': return 'failed'
    case 'pending': return 'pending'
    default: return status
  }
}

interface HistoryEvent {
  id: string
  type: string
  title: string
  subtitle?: string
  status: string
  source: string
  timestamp: string
  agent_id?: string
  run_id?: string
  approval_id?: string
  outcome?: string
  payload?: Record<string, unknown>
}

interface HistoryQueryParams {
  type?: string
  status?: string
  limit?: string
  offset?: string
  since?: string
  agent?: string
}

export const historyRouter = Router()

// GET / — unified timeline across runs, approvals, and audit_log
historyRouter.get('/', (req, res) => {
  const {
    type = 'all',
    status = 'all',
    limit: limitStr = '50',
    offset: offsetStr = '0',
    since,
    agent,
  } = req.query as HistoryQueryParams

  const limit = Math.min(Math.max(1, Number(limitStr) || 50), 200)
  const offset = Math.max(0, Number(offsetStr) || 0)

  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()

    // Build UNION ALL query across the three tables.
    // Each sub-select emits a common set of columns:
    //   id, event_type, agent_id, run_id, approval_id, title, subtitle, status, source, timestamp, payload_json
    const unions: string[] = []
    const params: SQLInputValue[] = []

    // Determine which event types to include
    const includeRuns = type === 'all' || type === 'run'
    const includeApprovals = type === 'all' || type === 'approval'
    const includeAudit = type === 'all' || type === 'settings_change' || type === 'backup' || type === 'system'

    // --- runs ---
    if (includeRuns) {
      let runWhere = '1=1'
      if (since) {
        runWhere += ' AND r.started_at >= ?'
        params.push(since)
      }
      if (agent && agent !== 'all') {
        runWhere += ' AND r.agent_id = ?'
        params.push(agent)
      }
      unions.push(`
        SELECT
          r.run_id AS id,
          'run' AS event_type,
          r.agent_id,
          r.run_id,
          NULL AS approval_id,
          r.agent_id AS title_key,
          r.goal AS subtitle,
          r.status AS raw_status,
          COALESCE(r.trigger_kind, 'manual') AS source,
          r.started_at AS timestamp,
          NULL AS payload_json,
          r.error AS error_text,
          NULL AS action_text,
          NULL AS severity_text,
          NULL AS resolved_by_text
        FROM runs r
        WHERE ${runWhere}
      `)
    }

    // --- approvals ---
    if (includeApprovals) {
      let apprWhere = '1=1'
      if (since) {
        apprWhere += ' AND a.requested_at >= ?'
        params.push(since)
      }
      if (agent && agent !== 'all') {
        apprWhere += ' AND a.agent_id = ?'
        params.push(agent)
      }
      unions.push(`
        SELECT
          a.approval_id AS id,
          'approval' AS event_type,
          a.agent_id,
          a.run_id,
          a.approval_id,
          a.action AS title_key,
          NULL AS subtitle,
          a.status AS raw_status,
          'agent' AS source,
          a.requested_at AS timestamp,
          NULL AS payload_json,
          NULL AS error_text,
          a.action AS action_text,
          a.severity AS severity_text,
          a.resolved_by AS resolved_by_text
        FROM approvals a
        WHERE ${apprWhere}
      `)
    }

    // --- audit_log ---
    if (includeAudit) {
      let auditWhere = '1=1'
      if (since) {
        auditWhere += ' AND al.created_at >= ?'
        params.push(since)
      }
      // Filter out approval-related audit entries (already covered by approvals table)
      auditWhere += " AND al.action NOT IN ('approval.approved', 'approval.rejected')"

      // If a specific audit sub-type is requested, filter to those actions
      if (type === 'settings_change') {
        const placeholders = [...SETTINGS_ACTIONS].map(() => '?').join(',')
        auditWhere += ` AND al.action IN (${placeholders})`
        params.push(...SETTINGS_ACTIONS)
      } else if (type === 'backup') {
        const placeholders = [...BACKUP_ACTIONS].map(() => '?').join(',')
        auditWhere += ` AND al.action IN (${placeholders})`
        params.push(...BACKUP_ACTIONS)
      } else if (type === 'system') {
        const placeholders = [...SYSTEM_ACTIONS].map(() => '?').join(',')
        auditWhere += ` AND al.action IN (${placeholders})`
        params.push(...SYSTEM_ACTIONS)
      }

      // Agent filter doesn't apply to audit_log entries (they don't have agent_id)
      // but we can filter by actor_id if agent is specified
      if (agent && agent !== 'all') {
        auditWhere += ' AND al.actor_id = ?'
        params.push(agent)
      }

      unions.push(`
        SELECT
          al.audit_id AS id,
          al.action AS event_type,
          al.actor_id AS agent_id,
          NULL AS run_id,
          NULL AS approval_id,
          al.action AS title_key,
          al.target_type AS subtitle,
          'completed' AS raw_status,
          COALESCE(al.actor_type, 'system') AS source,
          al.created_at AS timestamp,
          al.payload_json,
          NULL AS error_text,
          al.action AS action_text,
          NULL AS severity_text,
          NULL AS resolved_by_text
        FROM audit_log al
        WHERE ${auditWhere}
      `)
    }

    if (unions.length === 0) {
      res.json({ events: [], total: 0, has_more: false })
      return
    }

    const unionQuery = unions.join(' UNION ALL ')

    // Count total matching rows (before pagination)
    const countSql = `SELECT COUNT(*) AS total FROM (${unionQuery})`
    const totalRow = db.prepare(countSql).get(...params) as { total: number }
    const total = totalRow.total

    // Fetch paginated results
    const dataSql = `SELECT * FROM (${unionQuery}) ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    const dataParams = [...params, limit, offset]
    const rows = db.prepare(dataSql).all(...dataParams) as Array<{
      id: string
      event_type: string
      agent_id: string | null
      run_id: string | null
      approval_id: string | null
      title_key: string | null
      subtitle: string | null
      raw_status: string
      source: string
      timestamp: string
      payload_json: string | null
      error_text: string | null
      action_text: string | null
      severity_text: string | null
      resolved_by_text: string | null
    }>

    // Transform rows into HistoryEvent objects
    const events: HistoryEvent[] = []
    for (const row of rows) {
      // Determine the normalized type for audit_log entries
      let eventType = row.event_type
      if (eventType !== 'run' && eventType !== 'approval') {
        const classified = classifyAuditAction(eventType)
        if (classified === null) continue // skip approval-related audit entries
        eventType = classified
      }

      // Apply type filter for the 'all' case (audit sub-types are already filtered in SQL for specific types)
      if (type !== 'all' && eventType !== type) continue

      // Build title
      let title: string
      if (eventType === 'run') {
        const agentLabel = AGENT_LABELS[row.title_key ?? ''] ?? row.title_key ?? 'Unknown Agent'
        const goal = row.subtitle
        title = goal ? `${agentLabel}: ${goal}` : agentLabel
      } else if (eventType === 'approval') {
        title = `Approval: ${row.action_text ?? 'unknown action'}`
      } else {
        // audit_log-based events: use a human-readable title from the action
        title = formatAuditTitle(row.event_type, row.title_key)
      }

      // Normalize status
      let eventStatus: string
      if (eventType === 'run') {
        eventStatus = runStatusToEventStatus(row.raw_status)
      } else if (eventType === 'approval') {
        eventStatus = approvalStatusToEventStatus(row.raw_status)
      } else {
        eventStatus = 'completed' // audit entries are always completed facts
      }

      // Apply status filter
      if (status !== 'all' && eventStatus !== status) continue

      // Build the event
      const event: HistoryEvent = {
        id: row.id,
        type: eventType,
        title,
        status: eventStatus,
        source: row.source,
        timestamp: row.timestamp,
      }

      // Optional fields
      if (row.subtitle && eventType === 'run') {
        event.subtitle = row.subtitle
      } else if (eventType === 'approval' && row.severity_text) {
        event.subtitle = `Severity: ${row.severity_text}`
        if (row.resolved_by_text) {
          event.subtitle += ` | Resolved by: ${row.resolved_by_text}`
        }
      } else if (row.subtitle && eventType !== 'run') {
        event.subtitle = row.subtitle
      }

      if (row.agent_id) event.agent_id = row.agent_id
      if (row.run_id) event.run_id = row.run_id
      if (row.approval_id) event.approval_id = row.approval_id

      // Outcome
      if (eventType === 'run') {
        event.outcome = row.error_text
          ? `Failed: ${row.error_text}`
          : row.raw_status === 'completed' ? 'Completed successfully' : undefined
      } else if (eventType === 'approval') {
        event.outcome = row.raw_status === 'approved' ? 'Approved'
          : row.raw_status === 'rejected' ? 'Rejected'
          : row.raw_status === 'expired' ? 'Expired'
          : undefined
      }

      // Payload (only for audit_log events that carry data)
      if (row.payload_json) {
        try {
          event.payload = JSON.parse(row.payload_json) as Record<string, unknown>
        } catch { /* skip unparseable payloads */ }
      }

      events.push(event)
    }

    res.json({
      events,
      total,
      has_more: offset + limit < total,
    })
  } catch {
    res.json({ events: [], total: 0, has_more: false })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

/** Format an audit_log action into a human-readable title. */
function formatAuditTitle(action: string, titleKey: string | null): string {
  switch (action) {
    case 'settings.updated': return 'Settings updated'
    case 'agent.toggled': return `Agent toggled: ${titleKey ?? 'unknown'}`
    case 'model.toggled': return `Model toggled: ${titleKey ?? 'unknown'}`
    case 'mode.changed': return 'Operating mode changed'
    case 'backup.created': return 'Backup created'
    case 'backup.restored': return 'Backup restored'
    case 'backup.restore_rollback': return 'Backup restore rolled back'
    case 'service.restart_requested': return 'Service restart requested'
    case 'service.restart_failed': return 'Service restart failed'
    default: return action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}
