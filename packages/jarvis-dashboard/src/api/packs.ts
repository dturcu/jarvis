import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'
import fs from 'fs'
import { STARTER_PACKS } from '@jarvis/runtime'
import { writeAuditLog, getActor } from './middleware/audit.js'
import type { AuthenticatedRequest } from './middleware/auth.js'

function getDb(): DatabaseSync {
  const dbPath = join(os.homedir(), '.jarvis', 'runtime.db')
  if (!fs.existsSync(dbPath)) {
    throw new Error('runtime.db not found')
  }
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const packsRouter = Router()

// GET / — list all starter packs
packsRouter.get('/', (_req, res) => {
  res.json(STARTER_PACKS)
})

// POST /:packId/apply — apply a starter pack
packsRouter.post('/:packId/apply', (req, res) => {
  const { packId } = req.params
  const pack = STARTER_PACKS.find(p => p.pack_id === packId)

  if (!pack) {
    res.status(404).json({ error: `Unknown starter pack: ${packId}` })
    return
  }

  let db: DatabaseSync | null = null
  try {
    db = getDb()
    const now = new Date().toISOString()
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)"
    )

    upsert.run('enabled_agents', JSON.stringify(pack.enabled_agents), now)
    upsert.run('adapter_mode', JSON.stringify(pack.adapter_mode), now)
    upsert.run('approval_policy', JSON.stringify(pack.approval_policy), now)

    const actor = getActor(req as AuthenticatedRequest)
    writeAuditLog(actor.type, actor.id, 'pack.applied', 'pack', packId, {
      enabled_agents: pack.enabled_agents,
      adapter_mode: pack.adapter_mode,
      approval_policy: pack.approval_policy,
    })

    res.json({ ok: true, applied: packId })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    try { db?.close() } catch { /* best-effort */ }
  }
})
