import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import os from 'os'
import { join } from 'path'
import { V1_WORKFLOWS } from '@jarvis/runtime'

function getRuntimeDb() {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
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

  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const commands = []
    for (const agentId of wf.agent_ids) {
      const commandId = randomUUID()
      db.prepare(`
        INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key)
        VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?, 'workflow', ?)
      `).run(commandId, agentId, JSON.stringify({ ...req.body, workflow_id: wf.workflow_id, preview: req.body?.preview ?? false }), new Date().toISOString(), `workflow-${wf.workflow_id}-${agentId}-${Date.now()}`)
      commands.push({ command_id: commandId, agent_id: agentId })
    }
    res.json({ ok: true, workflow_id: wf.workflow_id, commands })
  } catch {
    res.status(500).json({ error: 'Failed to start workflow' })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
