import { Router } from 'express'
import fs from 'node:fs'
import os from 'node:os'
import { basename, join, win32 } from 'node:path'
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

type PortalDocumentRow = Record<string, unknown> & {
  id?: unknown
  title?: unknown
  type?: unknown
  source_path?: unknown
  created_at?: unknown
  content_size?: unknown
  tags?: unknown
  collection?: unknown
}

function normalizePortalValue(value: string): string {
  return value.trim().toLowerCase()
}

function parsePortalTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string')
  }
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

function safePortalBasename(sourcePath: string): string {
  return sourcePath.includes('\\') ? win32.basename(sourcePath) : basename(sourcePath)
}

export function sanitizePortalFilePath(sourcePath: unknown, title: string, id: string): string {
  if (typeof sourcePath === 'string' && sourcePath.trim()) {
    return safePortalBasename(sourcePath.trim())
  }
  const trimmedTitle = title.trim()
  return trimmedTitle || `${id}.document`
}

export function portalDocumentMatchesClient(row: PortalDocumentRow, client: PortalClient): boolean {
  const clientId = normalizePortalValue(client.client_id)
  const company = normalizePortalValue(client.company)
  const exactMatches = new Set<string>([
    clientId,
    company,
    `client:${clientId}`,
    `client_id:${clientId}`,
    `company:${company}`,
  ])

  const collection = typeof row.collection === 'string' ? normalizePortalValue(row.collection) : ''
  if (collection && exactMatches.has(collection)) {
    return true
  }

  return parsePortalTags(row.tags)
    .map(normalizePortalValue)
    .some(tag => exactMatches.has(tag))
}

function getDocumentsTableColumns(db: DatabaseSync): Set<string> {
  const columns = db.prepare('PRAGMA table_info(documents)').all() as Array<{ name?: unknown }>
  return new Set(
    columns
      .map(column => (typeof column.name === 'string' ? column.name : ''))
      .filter(Boolean)
  )
}

function selectDocumentColumn(columns: Set<string>, ...candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (columns.has(candidate)) {
      return candidate
    }
  }
  return null
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function portalAuth(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined

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
    const columns = getDocumentsTableColumns(db)
    const idColumn = selectDocumentColumn(columns, 'doc_id', 'id')
    const createdAtColumn = selectDocumentColumn(columns, 'indexed_at', 'created_at', 'updated_at')

    if (!idColumn || !columns.has('title') || !createdAtColumn) {
      db.close()
      res.json({ documents: [], total: 0 })
      return
    }

    const typeColumn = selectDocumentColumn(columns, 'doc_type')
    const sourcePathColumn = selectDocumentColumn(columns, 'source_path')
    const collectionColumn = selectDocumentColumn(columns, 'collection')
    const tagsColumn = selectDocumentColumn(columns, 'tags')
    const contentSizeExpression = columns.has('content') ? 'length(content)' : '0'

    const docs = db.prepare(
      `SELECT ${idColumn} AS id,
              title,
              ${typeColumn ? `${typeColumn} AS type` : `'document' AS type`},
              ${sourcePathColumn ? `${sourcePathColumn} AS source_path` : 'NULL AS source_path'},
              ${createdAtColumn} AS created_at,
              ${collectionColumn ? `${collectionColumn} AS collection` : 'NULL AS collection'},
              ${tagsColumn ? `${tagsColumn} AS tags` : 'NULL AS tags'},
              ${contentSizeExpression} AS content_size
       FROM documents
       ORDER BY ${createdAtColumn} DESC
       LIMIT 200`
    ).all() as PortalDocumentRow[]

    db.close()

    const documents: PortalDocument[] = docs
      .filter(doc => portalDocumentMatchesClient(doc, client))
      .slice(0, 50)
      .map(doc => {
        const id = String(doc.id ?? '')
        const title = String(doc.title ?? 'Document')
        return {
          id,
          title,
          type: typeof doc.type === 'string' && doc.type.trim() ? doc.type : 'document',
          file_path: sanitizePortalFilePath(doc.source_path, title, id),
          created_at: typeof doc.created_at === 'string' ? doc.created_at : new Date().toISOString(),
          size_bytes: typeof doc.content_size === 'number' ? doc.content_size : 0,
        }
      })

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
