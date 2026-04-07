import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'os'
import { join } from 'path'
import { V1_WORKFLOWS, createCommand } from '@jarvis/runtime'

function getRuntimeDb(): DatabaseSync {
  const dbPath = join(os.homedir(), '.jarvis', 'runtime.db')
  if (!existsSync(dbPath)) throw new Error('runtime.db not found')
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const workflowsRouter = Router()

// GET / — list available workflows
workflowsRouter.get('/', (_req, res) => {
  res.json(V1_WORKFLOWS)
})

// GET /:workflowId — get specific workflow
workflowsRouter.get('/:workflowId', (req, res) => {
  const wf = V1_WORKFLOWS.find(w => w.workflow_id === req.params.workflowId)
  if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return }
  res.json(wf)
})

// POST /:workflowId/start — start a workflow
workflowsRouter.post('/:workflowId/start', (req, res) => {
  const wf = V1_WORKFLOWS.find(w => w.workflow_id === req.params.workflowId)
  if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return }

  // Validate inputs against workflow definition (field-level errors)
  const errors: Array<{ field: string; message: string }> = []
  for (const input of wf.inputs) {
    const value = req.body?.[input.name]
    if (input.required && (value === undefined || value === null || value === '')) {
      errors.push({ field: input.name, message: `${input.label} is required` })
    }
    if (value !== undefined && value !== null && value !== '') {
      if (input.type === 'select' && input.options && !input.options.includes(String(value))) {
        errors.push({ field: input.name, message: `${input.label} must be one of: ${input.options.join(', ')}` })
      }
    }
  }
  if (errors.length > 0) {
    res.status(400).json({ ok: false, errors })
    return
  }

  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const commands: Array<{ command_id: string; agent_id: string }> = []

    // Wrap in transaction so workflow starts are all-or-nothing
    db.exec("BEGIN IMMEDIATE")
    try {
      for (const agentId of wf.agent_ids) {
        const { commandId } = createCommand(db, {
          agentId,
          source: 'workflow',
          payload: { ...req.body, workflow_id: wf.workflow_id, preview: req.body?.preview ?? false },
          idempotencyKey: randomUUID(),
        })
        commands.push({ command_id: commandId, agent_id: agentId })
      }
      db.exec("COMMIT")
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }

    res.json({
      ok: true,
      workflow_id: wf.workflow_id,
      workflow_name: wf.name,
      commands,
      preview: req.body?.preview ?? false,
      safety: wf.safety_rules ?? null,
      expected_output: wf.expected_output,
      message: req.body?.preview
        ? `Preview of "${wf.name}" started. Outbound actions will be simulated.`
        : `"${wf.name}" started. ${commands.length} agent(s) queued.`,
    })
  } catch {
    res.status(500).json({ error: 'Failed to start workflow' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /:workflowId/results — recent runs for a workflow's agents
workflowsRouter.get('/:workflowId/results', (req, res) => {
  const wf = V1_WORKFLOWS.find(w => w.workflow_id === req.params.workflowId)
  if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return }

  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    // Find recent runs for this workflow's agents
    const placeholders = wf.agent_ids.map(() => '?').join(',')
    const runs = db.prepare(`
      SELECT run_id, agent_id, status, goal, current_step, total_steps, error, started_at, completed_at
      FROM runs WHERE agent_id IN (${placeholders})
      ORDER BY started_at DESC LIMIT 20
    `).all(...wf.agent_ids) as Record<string, unknown>[]

    res.json({
      workflow_id: wf.workflow_id,
      workflow_name: wf.name,
      expected_output: wf.expected_output,
      output_fields: wf.output_fields ?? [],
      safety_rules: wf.safety_rules ?? null,
      runs,
    })
  } catch {
    res.json({ workflow_id: wf.workflow_id, runs: [] })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /:workflowId/retry-guidance — retry rules for a workflow
workflowsRouter.get('/:workflowId/retry-guidance', (req, res) => {
  const wf = V1_WORKFLOWS.find(w => w.workflow_id === req.params.workflowId)
  if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return }

  const rules = wf.safety_rules
  res.json({
    workflow_id: wf.workflow_id,
    retry_safe: rules?.retry_safe ?? true,
    retry_requires_approval: rules?.retry_requires_approval ?? false,
    preview_recommended: rules?.preview_recommended ?? false,
    outbound_default: rules?.outbound_default ?? 'draft',
    guidance: rules?.retry_safe === false
      ? `This workflow may have produced outbound effects. Review the previous run before retrying.`
      : rules?.preview_recommended
        ? `Consider using preview mode for the retry to review before committing.`
        : `Safe to retry — no special precautions needed.`,
  })
})
