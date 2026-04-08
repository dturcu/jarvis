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
// Requires admin role because packs can mutate approval_policy and enabled_agents
packsRouter.post('/:packId/apply', (req, res) => {
  const authed = req as AuthenticatedRequest
  if (authed.user?.role !== 'admin') {
    res.status(403).json({ error: 'Applying starter packs requires admin role (modifies approval policy).' })
    return
  }

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

    // Atomic: all settings applied together or none
    db.exec('BEGIN')
    try {
      const upsert = db.prepare(
        "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)"
      )
      upsert.run('enabled_agents', JSON.stringify(pack.enabled_agents), now)
      upsert.run('adapter_mode', JSON.stringify(pack.adapter_mode), now)
      upsert.run('approval_policy', JSON.stringify(pack.approval_policy), now)
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* best-effort */ }
      throw e
    }

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
