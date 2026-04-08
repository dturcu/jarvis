import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import { join } from 'node:path'
import { ProvenanceSigner, type ProvenanceRecord } from '@jarvis/observability'

function getRuntimeDb(): DatabaseSync {
  const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}

export const provenanceRouter = Router()

// GET / — list recent provenance records
provenanceRouter.get('/', (req, res) => {
  const parsed = parseInt(req.query.limit as string, 10)
  const limit = Number.isFinite(parsed) ? Math.min(parsed, 200) : 50
  const agentId = req.query.agent as string | undefined
  const db = getRuntimeDb()
  try {
    let sql = 'SELECT * FROM provenance_traces'
    const params: (string | number)[] = []
    if (agentId) {
      sql += ' WHERE agent_id = ?'
      params.push(agentId)
    }
    sql += ' ORDER BY signed_at DESC LIMIT ?'
    params.push(limit)
    const rows = db.prepare(sql).all(...params)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    try { db.close() } catch {}
  }
})

// GET /run/:runId — get provenance chain for a specific run
provenanceRouter.get('/run/:runId', (req, res) => {
  const db = getRuntimeDb()
  try {
    const rows = db.prepare(
      'SELECT * FROM provenance_traces WHERE run_id = ? ORDER BY sequence ASC'
    ).all(req.params.runId)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    try { db.close() } catch {}
  }
})

// POST /verify — verify a provenance chain for a run
provenanceRouter.post('/verify', (req, res) => {
  const { run_id, signing_key } = req.body as { run_id?: string; signing_key?: string }
  if (!run_id) {
    res.status(400).json({ error: 'run_id is required' })
    return
  }

  const key = signing_key ?? process.env.JARVIS_SIGNING_KEY
  if (!key || key.length < 32) {
    res.status(400).json({ error: 'Valid signing key required (env JARVIS_SIGNING_KEY or body signing_key)' })
    return
  }

  const signer = new ProvenanceSigner(key)
  const db = getRuntimeDb()
  try {
    const rows = db.prepare(
      'SELECT * FROM provenance_traces WHERE run_id = ? ORDER BY sequence ASC'
    ).all(run_id) as ProvenanceRecord[]

    if (rows.length === 0) {
      res.json({ run_id, verified: false, reason: 'No provenance records found', records: 0 })
      return
    }

    const chainResult = signer.verifyChain(rows)
    res.json({
      run_id,
      verified: chainResult.valid,
      reason: chainResult.valid ? 'Chain is intact' : chainResult.errors.join('; '),
      records: rows.length,
      errors: chainResult.errors,
    })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    try { db.close() } catch {}
  }
})

// GET /stats — provenance coverage statistics
provenanceRouter.get('/stats', (_req, res) => {
  const db = getRuntimeDb()
  try {
    const total = (db.prepare('SELECT COUNT(*) as n FROM provenance_traces').get() as { n: number }).n
    const byType = db.prepare(
      'SELECT job_type, COUNT(*) as n FROM provenance_traces GROUP BY job_type ORDER BY n DESC'
    ).all() as Array<{ job_type: string; n: number }>
    const byAgent = db.prepare(
      'SELECT agent_id, COUNT(*) as n FROM provenance_traces WHERE agent_id IS NOT NULL GROUP BY agent_id ORDER BY n DESC'
    ).all() as Array<{ agent_id: string; n: number }>
    const recent = db.prepare(
      'SELECT signed_at FROM provenance_traces ORDER BY signed_at DESC LIMIT 1'
    ).get() as { signed_at: string } | undefined

    res.json({
      total_records: total,
      by_job_type: byType,
      by_agent: byAgent,
      latest_signed_at: recent?.signed_at ?? null,
    })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    try { db.close() } catch {}
  }
})
