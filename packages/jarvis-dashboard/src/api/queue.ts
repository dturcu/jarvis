import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'

function getRuntimeDb() {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const queueRouter = Router()

// GET / — list queued and claimed commands, ordered by priority then creation time
queueRouter.get('/', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const rows = db.prepare(`
      SELECT command_id, target_agent_id, command_type, status, priority, created_at, created_by, claimed_at
      FROM agent_commands
      WHERE status IN ('queued', 'claimed')
      ORDER BY CASE priority WHEN 0 THEN 1 ELSE 0 END, priority DESC, created_at ASC
    `).all() as Record<string, unknown>[]
    res.json(rows)
  } catch {
    res.json([])
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// GET /history — list completed, failed, and cancelled commands with duration
queueRouter.get('/history', (req, res) => {
  let db: DatabaseSync | undefined
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  try {
    db = getRuntimeDb()
    const rows = db.prepare(`
      SELECT
        c.command_id, c.target_agent_id, c.command_type, c.status, c.priority,
        c.created_at, c.completed_at, c.created_by, c.claimed_at,
        r.run_id, r.goal, r.error, r.current_step, r.total_steps,
        r.started_at AS run_started_at, r.completed_at AS run_completed_at
      FROM agent_commands c
      LEFT JOIN runs r ON r.command_id = c.command_id
      WHERE c.status IN ('completed', 'failed', 'cancelled')
      ORDER BY c.completed_at DESC, c.created_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[]
    res.json(rows)
  } catch (e) {
    res.json([])
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// PATCH /:commandId — cancel a queued or claimed command
queueRouter.patch('/:commandId', (req, res) => {
  const { commandId } = req.params
  const { status } = req.body as { status?: string }

  if (status !== 'cancelled') {
    res.status(400).json({ error: 'Only status: "cancelled" is supported' })
    return
  }

  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const result = db.prepare(`
      UPDATE agent_commands
      SET status = 'cancelled', completed_at = datetime('now')
      WHERE command_id = ? AND status IN ('queued', 'claimed')
    `).run(commandId) as { changes: number }

    if (result.changes === 0) {
      res.status(404).json({ error: 'Command not found or already completed' })
      return
    }

    // Also cancel any linked run
    db.prepare(`
      UPDATE runs SET status = 'cancelled', completed_at = datetime('now')
      WHERE command_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
    `).run(commandId)

    res.json({ ok: true, command_id: commandId, status: 'cancelled' })
  } catch (e) {
    res.status(500).json({ error: `Failed to cancel: ${e instanceof Error ? e.message : String(e)}` })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})

// DELETE /all — cancel all queued commands (batch cleanup)
queueRouter.delete('/all', (_req, res) => {
  let db: DatabaseSync | undefined
  try {
    db = getRuntimeDb()
    const result = db.prepare(`
      UPDATE agent_commands
      SET status = 'cancelled', completed_at = datetime('now')
      WHERE status IN ('queued', 'claimed')
    `).run() as { changes: number }
    res.json({ ok: true, cancelled: result.changes })
  } catch (e) {
    res.status(500).json({ error: `Failed to cancel: ${e instanceof Error ? e.message : String(e)}` })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
