import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import os from 'os'
import { join } from 'path'

function getDb() {
  return new DatabaseSync(join(os.homedir(), '.jarvis', 'crm.db'))
}

export const crmRouter = Router()

// GET / — list contacts with optional ?stage=&q= filters
crmRouter.get('/', (_req, res) => {
  const { stage, q } = _req.query as { stage?: string; q?: string }
  try {
    const db = getDb()
    let sql = 'SELECT * FROM contacts WHERE 1=1'
    const params: SQLInputValue[] = []
    if (stage) {
      sql += ' AND stage = ?'
      params.push(stage)
    }
    if (q) {
      sql += ' AND (name LIKE ? OR company LIKE ? OR email LIKE ?)'
      const like = `%${q}%`
      params.push(like, like, like)
    }
    sql += ' ORDER BY updated_at DESC'
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
    db.close()
    const contacts = rows.map(r => ({
      ...r,
      tags: typeof r.tags === 'string' ? (() => { try { return JSON.parse(r.tags) } catch { return [] } })() : (r.tags ?? [])
    }))
    res.json(contacts)
  } catch (err) {
    res.json([])
  }
})

// GET /contacts — alias for GET / (same contact list)
crmRouter.get('/contacts', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM contacts ORDER BY updated_at DESC').all() as Record<string, unknown>[]
    db.close()
    const contacts = rows.map(r => ({
      ...r,
      tags: typeof r.tags === 'string' ? (() => { try { return JSON.parse(r.tags) } catch { return [] } })() : (r.tags ?? [])
    }))
    res.json(contacts)
  } catch {
    res.json([])
  }
})

// GET /:id — get contact + notes + stage_history
crmRouter.get('/:id', (req, res) => {
  try {
    const db = getDb()
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!contact) {
      db.close()
      res.status(404).json({ error: 'Not found' })
      return
    }
    contact.tags = typeof contact.tags === 'string'
      ? (() => { try { return JSON.parse(contact.tags as string) } catch { return [] } })()
      : (contact.tags ?? [])

    const notes = db.prepare('SELECT * FROM notes WHERE contact_id = ? ORDER BY created_at DESC').all(req.params.id)
    const history = db.prepare('SELECT * FROM stage_history WHERE contact_id = ? ORDER BY moved_at DESC').all(req.params.id)
    db.close()
    res.json({ ...contact, notes, stage_history: history })
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})

// POST / — create contact
crmRouter.post('/', (req, res) => {
  const { name, company, role, stage = 'prospect', email, linkedin_url, source, score, tags } = req.body as {
    name?: string; company?: string; role?: string; stage?: string; email?: string;
    linkedin_url?: string; source?: string; score?: number; tags?: string[]
  }
  if (!name || !company) {
    res.status(400).json({ error: 'name and company are required' })
    return
  }
  try {
    const db = getDb()
    const now = new Date().toISOString()
    const id = randomUUID()
    db.prepare(
      `INSERT INTO contacts (id, name, company, role, stage, email, linkedin_url, source, score, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, name, company, role ?? null, stage,
      email ?? null, linkedin_url ?? null, source ?? null,
      score ?? null,
      tags ? JSON.stringify(tags) : '[]',
      now, now
    )
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)
    db.close()
    res.status(201).json(contact)
  } catch (err) {
    res.status(500).json({ error: 'Database error' })
  }
})

// PATCH /:id — update contact fields
crmRouter.patch('/:id', (req, res) => {
  const allowed = ['name', 'company', 'role', 'stage', 'email', 'linkedin_url', 'source', 'score', 'tags']
  const updates = req.body as Record<string, unknown>
  const fields = Object.keys(updates).filter(k => allowed.includes(k))
  if (fields.length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }
  try {
    const db = getDb()
    const now = new Date().toISOString()
    const setClauses = [...fields.map(f => `${f} = ?`), 'updated_at = ?'].join(', ')
    const values: SQLInputValue[] = fields.map(f => {
      if (f === 'tags' && Array.isArray(updates[f])) return JSON.stringify(updates[f])
      return updates[f] as SQLInputValue
    })
    values.push(now)
    values.push(req.params.id)
    db.prepare(`UPDATE contacts SET ${setClauses} WHERE id = ?`).run(...values)
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id)
    db.close()
    res.json(contact)
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})

// POST /:id/note — add note { note, note_type }
crmRouter.post('/:id/note', (req, res) => {
  const { note, note_type = 'general' } = req.body as { note?: string; note_type?: string }
  if (!note) {
    res.status(400).json({ error: 'note is required' })
    return
  }
  try {
    const db = getDb()
    const now = new Date().toISOString()
    const noteId = randomUUID()
    db.prepare(
      'INSERT INTO notes (id, contact_id, note, note_type, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(noteId, req.params.id, note, note_type, now)
    db.prepare('UPDATE contacts SET updated_at = ? WHERE id = ?').run(now, req.params.id)
    const inserted = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId)
    db.close()
    res.status(201).json(inserted)
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})

// POST /:id/stage — move stage { stage, note }
crmRouter.post('/:id/stage', (req, res) => {
  const { stage, note } = req.body as { stage?: string; note?: string }
  if (!stage) {
    res.status(400).json({ error: 'stage is required' })
    return
  }
  const validStages = ['prospect', 'qualified', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost', 'parked']
  if (!validStages.includes(stage)) {
    res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` })
    return
  }
  try {
    const db = getDb()
    const contact = db.prepare('SELECT stage FROM contacts WHERE id = ?').get(req.params.id) as { stage: string } | undefined
    if (!contact) {
      db.close()
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO stage_history (id, contact_id, from_stage, to_stage, note, moved_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), req.params.id, contact.stage, stage, note ?? null, now)
    db.prepare('UPDATE contacts SET stage = ?, updated_at = ? WHERE id = ?').run(stage, now, req.params.id)
    const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id)
    db.close()
    res.json(updated)
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})
