import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import os from 'os'
import { join } from 'path'

function getDb() {
  return new DatabaseSync(join(os.homedir(), '.jarvis', 'knowledge.db'))
}

export const entitiesRouter = Router()

// GET / — list all entities, paginated
entitiesRouter.get('/', (req, res) => {
  const { limit = '100', offset = '0', type } = req.query as {
    limit?: string; offset?: string; type?: string
  }
  try {
    const db = getDb()
    let sql = 'SELECT * FROM entities WHERE 1=1'
    const params: SQLInputValue[] = []
    if (type && type !== 'all') {
      sql += ' AND entity_type = ?'
      params.push(type)
    }
    sql += ' ORDER BY entity_type, name LIMIT ? OFFSET ?'
    params.push(Number(limit), Number(offset))
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
    db.close()
    // Parse attributes JSON
    const entities = rows.map(r => {
      let attributes = null
      if (r.attributes && typeof r.attributes === 'string') {
        try { attributes = JSON.parse(r.attributes as string) } catch {}
      }
      return { ...r, attributes: attributes ?? r.attributes }
    })
    res.json(entities)
  } catch {
    res.json([])
  }
})

// GET /graph — full graph data: nodes + edges, capped at 200 nodes
entitiesRouter.get('/graph', (_req, res) => {
  try {
    const db = getDb()
    const nodes = db.prepare('SELECT * FROM entities LIMIT 200').all() as Record<string, unknown>[]
    let edges: Record<string, unknown>[] = []
    try {
      edges = db.prepare('SELECT * FROM relations LIMIT 500').all() as Record<string, unknown>[]
    } catch {
      // relations table may not exist
    }
    db.close()
    const parsedNodes = nodes.map(r => {
      let attributes = null
      if (r.attributes && typeof r.attributes === 'string') {
        try { attributes = JSON.parse(r.attributes as string) } catch {}
      }
      return { ...r, attributes: attributes ?? r.attributes }
    })
    res.json({ nodes: parsedNodes, edges })
  } catch {
    res.json({ nodes: [], edges: [] })
  }
})

// GET /:id — single entity with full attributes
entitiesRouter.get('/:id', (req, res) => {
  try {
    const db = getDb()
    const entity = db.prepare('SELECT * FROM entities WHERE entity_id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!entity) {
      db.close()
      res.status(404).json({ error: 'Entity not found' })
      return
    }
    if (entity.attributes && typeof entity.attributes === 'string') {
      try { entity.attributes = JSON.parse(entity.attributes as string) } catch {}
    }
    db.close()
    res.json(entity)
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})

// GET /:id/neighborhood — entity + connected entities + relations
entitiesRouter.get('/:id/neighborhood', (req, res) => {
  try {
    const db = getDb()
    const entity = db.prepare('SELECT * FROM entities WHERE entity_id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!entity) {
      db.close()
      res.status(404).json({ error: 'Entity not found' })
      return
    }
    if (entity.attributes && typeof entity.attributes === 'string') {
      try { entity.attributes = JSON.parse(entity.attributes as string) } catch {}
    }

    // Get relations where this entity is source or target
    let relations: Record<string, unknown>[] = []
    let connectedEntities: Record<string, unknown>[] = []
    try {
      relations = db.prepare(
        'SELECT * FROM relations WHERE from_entity_id = ? OR to_entity_id = ?'
      ).all(req.params.id, req.params.id) as Record<string, unknown>[]

      // Get connected entity IDs
      const connectedIds = new Set<string>()
      for (const rel of relations) {
        if (rel.from_entity_id !== req.params.id) connectedIds.add(rel.from_entity_id as string)
        if (rel.to_entity_id !== req.params.id) connectedIds.add(rel.to_entity_id as string)
      }

      if (connectedIds.size > 0) {
        const placeholders = Array.from(connectedIds).map(() => '?').join(',')
        connectedEntities = db.prepare(
          `SELECT * FROM entities WHERE entity_id IN (${placeholders})`
        ).all(...Array.from(connectedIds)) as Record<string, unknown>[]
        // Parse attributes
        connectedEntities = connectedEntities.map(r => {
          if (r.attributes && typeof r.attributes === 'string') {
            try { r.attributes = JSON.parse(r.attributes as string) } catch {}
          }
          return r
        })
      }
    } catch {
      // relations table may not exist
    }

    db.close()
    res.json({ entity, relations, connectedEntities })
  } catch {
    res.status(500).json({ error: 'Database error' })
  }
})
