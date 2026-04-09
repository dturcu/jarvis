import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import { RunStore, ChannelStore, createCommand } from '@jarvis/runtime'

function getRuntimeDb() {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

/** Human-readable agent labels for explanation summaries. */
const AGENT_LABELS: Record<string, string> = {
  'orchestrator': 'Orchestrator',
  'self-reflection': 'Self-Reflection & Improvement',
  'regulatory-watch': 'Regulatory Intelligence Watch',
  'knowledge-curator': 'Knowledge Curator',
  'proposal-engine': 'Proposal & Quote Engine',
  'evidence-auditor': 'ISO 26262 / ASPICE Evidence Auditor',
  'contract-reviewer': 'Contract Reviewer',
  'staffing-monitor': 'Staffing Monitor',
}

/** Build a human-readable trigger description from trigger_kind. */
function describeTrigger(triggerKind: string | null): { kind: string; source: string; description: string } {
  if (!triggerKind) {
    return { kind: 'unknown', source: 'unknown', description: 'an unknown trigger' }
  }
  switch (triggerKind) {
    case 'schedule':
      return { kind: 'schedule', source: 'cron schedule', description: 'a scheduled job' }
    case 'manual':
      return { kind: 'manual', source: 'dashboard', description: 'a manual trigger from the dashboard' }
    case 'event':
      return { kind: 'event', source: 'event', description: 'an incoming event' }
    case 'threshold':
      return { kind: 'threshold', source: 'alert threshold', description: 'a threshold alert' }
    default:
      return { kind: triggerKind, source: triggerKind, description: `a ${triggerKind} trigger` }
  }
}

/** Map run status to a plain-language outcome. */
function describeOutcome(status: string): string {
  switch (status) {
    case 'completed': return 'Completed successfully'
    case 'failed': return 'Failed with errors'
    case 'cancelled': return 'Was cancelled by an operator'
    case 'planning': return 'Currently planning'
    case 'executing': return 'Currently executing'
    case 'awaiting_approval': return 'Waiting for approval'
    case 'queued': return 'Queued for execution'
    default: return `Status: ${status}`
  }
}

export const runsRouter = Router()

// GET / — list recent runs from runtime.db, paginated, optional agent filter
runsRouter.get('/', (req, res) => {
  const { agent, limit = '50', offset = '0' } = req.query as {
    agent?: string; limit?: string; offset?: string
  }
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    let sql = 'SELECT * FROM runs WHERE 1=1'
    const params: SQLInputValue[] = []
    if (agent && agent !== 'all') {
      sql += ' AND agent_id = ?'
      params.push(agent)
    }
    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), Number(offset))
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
    res.json(rows)
  } catch {
    res.json([])
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /active — currently running or approval-blocked runs
runsRouter.get('/active', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const rows = db.prepare(
      `SELECT * FROM runs WHERE status IN ('planning', 'executing', 'awaiting_approval') ORDER BY started_at DESC`
    ).all() as Record<string, unknown>[]
    res.json(rows)
  } catch {
    res.json([])
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /failed — recent failures and cancellations
runsRouter.get('/failed', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const rows = db.prepare(
      `SELECT * FROM runs WHERE status IN ('failed', 'cancelled') ORDER BY completed_at DESC LIMIT 50`
    ).all() as Record<string, unknown>[]
    res.json(rows)
  } catch {
    res.json([])
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /:runId — full run detail with events from runtime.db
runsRouter.get('/:runId', (req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId) as Record<string, unknown> | undefined
    if (!run) {
      res.status(404).json({ error: 'Run not found' })
      return
    }
    const events = db.prepare(
      'SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC'
    ).all(req.params.runId)
    res.json({ ...run, events })
  } catch {
    res.status(500).json({ error: 'Database error' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /:runId/explain — plain-language explanation of why and how a run executed
runsRouter.get('/:runId/explain', (req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId) as {
      run_id: string; agent_id: string; status: string;
      trigger_kind: string | null; goal: string | null;
      total_steps: number | null; current_step: number;
      started_at: string; completed_at: string | null;
      error: string | null;
    } | undefined

    if (!run) {
      res.status(404).json({ error: 'Run not found' })
      return
    }

    // Query all events for this run
    const events = db.prepare(
      'SELECT event_type, step_no, action, payload_json, created_at FROM run_events WHERE run_id = ? ORDER BY created_at ASC'
    ).all(run.run_id) as Array<{
      event_type: string; step_no: number | null;
      action: string | null; payload_json: string | null;
      created_at: string;
    }>

    // Count decisions (step_completed events)
    const decisionsMade = events.filter(e => e.event_type === 'step_completed').length
    // Count approvals requested
    const approvalsRequired = events.filter(e => e.event_type === 'approval_requested').length
    // Count completed steps vs total
    const stepsCompleted = run.current_step ?? 0
    const stepsTotal = run.total_steps ?? stepsCompleted

    // Build trigger description
    const trigger = describeTrigger(run.trigger_kind)

    // Build data sources from event payloads (best-effort extraction)
    const dataSources: string[] = []
    for (const event of events) {
      if (event.payload_json) {
        try {
          const payload = JSON.parse(event.payload_json) as Record<string, unknown>
          if (payload.data_source && typeof payload.data_source === 'string') {
            dataSources.push(payload.data_source)
          }
          if (payload.collection && typeof payload.collection === 'string') {
            dataSources.push(`Knowledge: ${payload.collection}`)
          }
        } catch { /* skip unparseable payloads */ }
      }
    }

    // Format the start time in a readable way
    const startDate = new Date(run.started_at)
    const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

    // Agent label
    const agentLabel = AGENT_LABELS[run.agent_id] ?? run.agent_id

    // Build summary sentence
    const summary = `This ${agentLabel} run was triggered by ${trigger.description} at ${timeStr} on ${dateStr}.`

    const explanation: Record<string, unknown> = {
      summary,
      trigger: trigger.source,
      data_sources: dataSources.length > 0 ? dataSources : [],
      decisions_made: decisionsMade,
      approvals_required: approvalsRequired,
      steps_completed: stepsCompleted,
      steps_total: stepsTotal,
      outcome: describeOutcome(run.status),
    }

    // C2.1: Check for preview-skipped actions
    const previewSteps = events.filter(e => {
      if (!e.payload_json) return false;
      try {
        const p = JSON.parse(e.payload_json);
        return p.preview === true || p.skipped === true;
      } catch { return false; }
    });

    if (previewSteps.length > 0) {
      explanation.preview_mode = true;
      // Use event.action column (set by orchestrator), not payload.action
      explanation.skipped_actions = previewSteps.map(e => e.action ?? 'unknown');
      explanation.preview_warning = `This was a preview run. ${previewSteps.length} outbound action(s) were simulated and not executed. Results may be incomplete.`;
    }

    // C3.1: Failure explanations
    if (run.status === 'failed') {
      // Check both completed AND failed outbound steps — a failed step may have partially executed
      const outboundSet = ['email.send', 'social.post', 'crm.move_stage'];
      const hadOutbound = events.some(e =>
        (e.event_type === 'step_completed' || e.event_type === 'step_failed') &&
        e.action && outboundSet.includes(e.action)
      );
      explanation.failure = {
        probable_cause: run.error || 'Unknown error',
        outbound_effects_may_have_occurred: hadOutbound,
        retry_recommendation: hadOutbound
          ? 'Review completed/failed outbound actions before retrying — some side effects may have occurred.'
          : 'Safe to retry — no outbound actions were attempted.',
      };
    }

    res.json(explanation)
  } catch {
    res.status(500).json({ error: 'Failed to build run explanation' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// POST /:runId/retry — retry a failed run by queuing a new command for the same agent
runsRouter.post('/:runId/retry', (req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId) as
      { run_id: string; agent_id: string; status: string } | undefined

    if (!run) {
      res.status(404).json({ error: 'Run not found' })
      return
    }
    if (run.status !== 'failed' && run.status !== 'cancelled') {
      res.status(400).json({ error: `Cannot retry run in status '${run.status}' — only failed or cancelled runs can be retried` })
      return
    }

    // Check if original run had outbound side effects (email, social, CRM moves)
    // to warn operators that retrying may re-trigger those actions
    const outboundActions = ['email.send', 'social.post', 'crm.move_stage', 'document.generate_report']
    // Check both completed AND failed steps — a failed outbound step may have triggered side effects
    const executedSteps = db.prepare(
      "SELECT action FROM run_events WHERE run_id = ? AND event_type IN ('step_completed', 'step_failed') AND action IS NOT NULL"
    ).all(run.run_id) as Array<{ action: string }>
    const hadOutbound = executedSteps.some(s => outboundActions.includes(s.action))
    const retrySafety = hadOutbound ? 'warn_outbound_effects' : 'safe'

    const { commandId } = createCommand(db, {
      agentId: run.agent_id,
      source: 'dashboard',
      payload: { retry_of: run.run_id },
      idempotencyKey: `retry-${run.run_id}-${Date.now()}`,
    })
    res.json({ ok: true, command_id: commandId, agent_id: run.agent_id, retry_of: run.run_id, retry_safety: retrySafety })
  } catch {
    res.status(500).json({ error: 'Failed to queue retry command' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /:runId/timeline — unified timeline merging run events, channel messages, and deliveries
runsRouter.get('/:runId/timeline', (req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const run = db.prepare('SELECT run_id FROM runs WHERE run_id = ?').get(req.params.runId)
    if (!run) {
      res.status(404).json({ error: 'Run not found' })
      return
    }
    const channelStore = new ChannelStore(db)
    res.json(channelStore.getRunTimeline(req.params.runId))
  } catch {
    res.status(500).json({ error: 'Failed to build run timeline' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// POST /:runId/cancel — cancel a non-terminal run
runsRouter.post('/:runId/cancel', (req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId) as
      { run_id: string; agent_id: string; status: string } | undefined

    if (!run) {
      res.status(404).json({ error: 'Run not found' })
      return
    }

    const terminalStatuses = ['completed', 'failed', 'cancelled']
    if (terminalStatuses.includes(run.status)) {
      res.status(400).json({ error: `Run is already in terminal status '${run.status}'` })
      return
    }

    const runStore = new RunStore(db)
    runStore.transition(run.run_id, run.agent_id, 'cancelled', 'run_cancelled', {
      details: { reason: 'operator_cancel' }
    })
    // Also complete the associated command so it doesn't get re-claimed
    runStore.completeCommand(run.run_id, 'cancelled')

    // Note: The live orchestrator checks durable status before each step and will
    // detect the cancellation at its next checkpoint. The current step may still
    // complete, but no further steps will execute.
    res.json({ ok: true, run_id: run.run_id, status: 'cancelled', note: 'The current step may still complete; no further steps will execute.' })
  } catch {
    res.status(500).json({ error: 'Failed to cancel run' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
