import { Router } from 'express'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const portalRouter = Router()

// ── Types ────────────────────────────────────────────────────────────────────

type PortalClient = {
  client_id: string
  company: string
  contact_name: string
  email: string
}

type PortalDocument = {
  id: string
  title: string
  type: string
  file_path: string
  created_at: string
  size_bytes: number
}

type PortalMilestone = {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'overdue'
  due_date: string
  completed_at: string | null
  notes: string
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function portalAuth(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  const token = req.headers.authorization?.replace('Bearer ', '') ?? (req.query.token as string | undefined)

  const tokensFile = join(os.homedir(), '.jarvis', 'portal-tokens.json')
  if (!fs.existsSync(tokensFile)) {
    res.status(401).json({ error: 'Portal not configured' })
    return
  }

  try {
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8')) as Record<string, PortalClient>
    const client = token ? tokens[token] : undefined
    if (!client) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }

    // Attach client info to request for use in handlers
    ;(req as unknown as Record<string, unknown>).portalClient = client
    next()
  } catch {
    res.status(500).json({ error: 'Portal configuration error' })
  }
}

function getClient(req: import('express').Request): PortalClient {
  return (req as unknown as Record<string, unknown>).portalClient as PortalClient
}

portalRouter.use(portalAuth)

// ── GET /portal/api/status ───────────────────────────────────────────────────
// Client engagement summary

portalRouter.get('/status', (req, res) => {
  const client = getClient(req)

  try {
    const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'crm.db'))

    // Find contact by email or company
    const contact = db.prepare(
      'SELECT * FROM contacts WHERE email = ? OR company = ? LIMIT 1'
    ).get(client.email, client.company) as Record<string, unknown> | undefined

    if (!contact) {
      db.close()
      res.json({
        client_id: client.client_id,
        company: client.company,
        contact_name: client.contact_name,
        engagement_status: 'no_record',
        stage: null,
        last_updated: null,
        notes_count: 0,
      })
      return
    }

    // Count notes for this contact
    let notesCount = 0
    try {
      const countResult = db.prepare(
        'SELECT COUNT(*) as n FROM notes WHERE contact_id = ?'
      ).get(contact.id as string) as { n: number }
      notesCount = countResult.n
    } catch {
      // notes table may not exist
    }

    db.close()

    res.json({
      client_id: client.client_id,
      company: client.company,
      contact_name: client.contact_name,
      engagement_status: 'active',
      stage: contact.stage ?? 'unknown',
      last_updated: contact.updated_at ?? null,
      notes_count: notesCount,
      tags: typeof contact.tags === 'string'
        ? (() => { try { return JSON.parse(contact.tags as string) } catch { return [] } })()
        : [],
    })
  } catch {
    res.json({
      client_id: client.client_id,
      company: client.company,
      contact_name: client.contact_name,
      engagement_status: 'error',
      stage: null,
      last_updated: null,
      notes_count: 0,
    })
  }
})

// ── GET /portal/api/documents ────────────────────────────────────────────────
// Deliverable documents for this client

portalRouter.get('/documents', (req, res) => {
  const client = getClient(req)

  try {
    const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'knowledge.db'))

    // Search documents tagged with client company or ID
    const docs = db.prepare(
      `SELECT id, title, doc_type as type, source_path as file_path, indexed_at as created_at, chunk_count
       FROM documents
       WHERE title LIKE ? OR source_path LIKE ?
       ORDER BY indexed_at DESC
       LIMIT 50`
    ).all(`%${client.company}%`, `%${client.company}%`) as Array<Record<string, unknown>>

    db.close()

    const documents: PortalDocument[] = docs.map(d => ({
      id: d.id as string,
      title: d.title as string,
      type: d.type as string,
      file_path: d.file_path as string,
      created_at: d.created_at as string,
      size_bytes: ((d.chunk_count as number) ?? 1) * 1024, // approximate
    }))

    res.json({
      documents,
      total: documents.length,
    })
  } catch {
    res.json({ documents: [], total: 0 })
  }
})

// ── GET /portal/api/milestones ───────────────────────────────────────────────
// Key dates and statuses for the client engagement

portalRouter.get('/milestones', (req, res) => {
  const client = getClient(req)

  try {
    const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'crm.db'))

    // Find the contact
    const contact = db.prepare(
      'SELECT id FROM contacts WHERE email = ? OR company = ? LIMIT 1'
    ).get(client.email, client.company) as Record<string, unknown> | undefined

    if (!contact) {
      db.close()
      res.json({ milestones: [], total: 0 })
      return
    }

    // Get notes that look like milestones (contain dates or status keywords)
    const notes = db.prepare(
      `SELECT id, content, created_at FROM notes
       WHERE contact_id = ?
       ORDER BY created_at DESC
       LIMIT 50`
    ).all(contact.id as string) as Array<Record<string, unknown>>

    db.close()

    // Parse notes into milestone-like structures
    const milestones: PortalMilestone[] = notes
      .filter(n => {
        const content = (n.content as string).toLowerCase()
        return content.includes('milestone') ||
               content.includes('deliverable') ||
               content.includes('deadline') ||
               content.includes('phase') ||
               content.includes('gate') ||
               content.includes('review')
      })
      .map(n => ({
        id: n.id as string,
        title: (n.content as string).split('\n')[0]?.slice(0, 100) ?? 'Milestone',
        status: 'in_progress' as const,
        due_date: n.created_at as string,
        completed_at: null,
        notes: n.content as string,
      }))

    res.json({
      milestones,
      total: milestones.length,
    })
  } catch {
    res.json({ milestones: [], total: 0 })
  }
})
