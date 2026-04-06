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
