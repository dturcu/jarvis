import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'

type QueueEntry = {
  job_id: string
  agent_id: string | null
  job_type: string
  priority: string
  queued_at: string | null
  approval_state: string
}

function openStateDb(): DatabaseSync | null {
  const dbPath = join(os.homedir(), '.jarvis', 'jarvis-state.sqlite')
  if (!fs.existsSync(dbPath)) return null
  try {
    const db = new DatabaseSync(dbPath)
    db.exec("PRAGMA journal_mode = WAL;")
    db.exec("PRAGMA busy_timeout = 5000;")
    return db
  } catch {
    return null
  }
}

export const queueRouter = Router()

// GET / — list queued jobs from JarvisState, ordered by priority
queueRouter.get('/', (_req, res) => {
  const db = openStateDb()
  if (!db) {
    res.json([])
    return
  }

  try {
    const rows = db.prepare(`
      SELECT job_id, job_type, priority, queued_at, approval_state, record_json
      FROM jobs
      WHERE status = 'queued'
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        updated_at ASC
    `).all() as Array<{
      job_id: string
      job_type: string
      priority: string
      queued_at: string | null
      approval_state: string
      record_json: string
    }>

    const entries: QueueEntry[] = rows.map(r => {
      let agentId: string | null = null
      try {
        const record = JSON.parse(r.record_json) as { envelope?: { metadata?: { agent_id?: string } } }
        agentId = record?.envelope?.metadata?.agent_id ?? null
      } catch { /* ok */ }
      return {
        job_id: r.job_id,
        agent_id: agentId,
        job_type: r.job_type,
        priority: r.priority,
        queued_at: r.queued_at,
        approval_state: r.approval_state,
      }
    })

    res.json(entries)
  } catch {
    res.json([])
  } finally {
    try { db.close() } catch { /* best-effort */ }
  }
})
