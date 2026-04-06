import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import os from 'os'
import { join } from 'path'

function getDb() {
  return new DatabaseSync(join(os.homedir(), '.jarvis', 'knowledge.db'))
}

export const knowledgeRouter = Router()

// GET /search?q=&col= — search documents (LIKE on title+content)
knowledgeRouter.get('/search', (req, res) => {
  const { q, col } = req.query as { q?: string; col?: string }
  if (!q) {
    res.json([])
    return
  }
  try {
    const db = getDb()
    const like = `%${q}%`
    let sql = `SELECT doc_id, title, collection, created_at, substr(content, 1, 300) as excerpt
               FROM documents
               WHERE (title LIKE ? OR content LIKE ?)`
    const params: SQLInputValue[] = [like, like]
    if (col && col !== 'all') {
      sql += ' AND collection = ?'
      params.push(col)
    }
    sql += ' ORDER BY created_at DESC LIMIT 50'
    const rows = db.prepare(sql).all(...params)
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /collection/:name — list docs in collection
knowledgeRouter.get('/collection/:name', (req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT doc_id, title, collection, created_at, substr(content, 1, 200) as excerpt
       FROM documents WHERE collection = ? ORDER BY created_at DESC`
    ).all(req.params.name)
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /playbooks — list all playbooks
knowledgeRouter.get('/playbooks', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM playbooks ORDER BY created_at DESC').all()
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /entities — list entities (top 50 by type)
knowledgeRouter.get('/entities', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM entities ORDER BY type, name LIMIT 50').all()
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /stats — per-collection document count + total + playbook count
knowledgeRouter.get('/stats', (_req, res) => {
  try {
    const db = getDb()
    const collections = db.prepare(
      'SELECT collection, COUNT(*) as count FROM documents GROUP BY collection ORDER BY collection'
    ).all() as Array<{ collection: string; count: number }>
    const totalRow = db.prepare('SELECT COUNT(*) as total FROM documents').get() as { total: number }
    let playbookCount = 0
    try {
      const pbRow = db.prepare('SELECT COUNT(*) as count FROM playbooks').get() as { count: number }
      playbookCount = pbRow.count
    } catch {}
    db.close()
    res.json({
      total: totalRow.total,
      collections,
      playbooks: playbookCount
    })
  } catch {
    res.json({ total: 0, collections: [], playbooks: 0 })
  }
})

// GET /recent — last 20 documents across all collections
knowledgeRouter.get('/recent', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT doc_id, title, collection, created_at, substr(content, 1, 300) as excerpt
       FROM documents ORDER BY created_at DESC LIMIT 20`
    ).all()
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /document/:id — full document by doc_id
knowledgeRouter.get('/document/:id', (req, res) => {
  try {
    const db = getDb()
    const doc = db.prepare('SELECT * FROM documents WHERE doc_id = ?').get(req.params.id)
    db.close()
    if (!doc) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json(doc)
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})
