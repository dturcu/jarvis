import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  KnowledgeCollection,
  KnowledgeDocument,
  KnowledgeSearchResult,
  PlaybookEntry,
} from "./knowledge.js";
import type { EmbeddingPipeline } from "./embedding-pipeline.js";

/**
 * SQLite-backed knowledge store.
 *
 * Implements the same public API as the in-memory {@link KnowledgeStore} but
 * persists all data to a SQLite database.  The constructor expects the path to
 * an **already-initialised** database (created by `scripts/init-jarvis.ts`).
 *
 * When an {@link EmbeddingPipeline} is provided, documents are automatically
 * chunked and embedded on ingest for hybrid RAG retrieval.
 */
export class SqliteKnowledgeStore {
  private db: DatabaseSync;
  private embeddingPipeline?: EmbeddingPipeline;

  constructor(dbPath: string, embeddingPipeline?: EmbeddingPipeline) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.embeddingPipeline = embeddingPipeline;
    // Create FTS5 virtual table for full-text search if not exists
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
          doc_id UNINDEXED, title, content, tags,
          content='documents', content_rowid='rowid'
        )
      `);
      // Rebuild FTS index from existing documents
      this.db.exec(`
        INSERT OR IGNORE INTO documents_fts(documents_fts) VALUES('rebuild')
      `);
    } catch {
      // FTS5 may not be available in all SQLite builds — fall back to LIKE
    }
  }

  /** Attach an embedding pipeline after construction (for deferred initialization). */
  setEmbeddingPipeline(pipeline: EmbeddingPipeline): void {
    this.embeddingPipeline = pipeline;
  }

  private hasFts(): boolean {
    try {
      this.db.prepare("SELECT * FROM documents_fts LIMIT 0").all();
      return true;
    } catch { return false; }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // best-effort
    }
  }

  // ─── Document API ───────────────────────────────────────────────────────────

  addDocument(
    params: Omit<KnowledgeDocument, "doc_id" | "created_at" | "updated_at">,
  ): KnowledgeDocument {
    const now = new Date().toISOString();
    const doc: KnowledgeDocument = {
      ...params,
      doc_id: randomUUID(),
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO documents (doc_id, collection, title, content, tags, source_agent_id, source_run_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.doc_id, doc.collection, doc.title, doc.content,
      JSON.stringify(doc.tags), doc.source_agent_id ?? null,
      doc.source_run_id ?? null, doc.created_at, doc.updated_at,
    );

    // Sync FTS5 index
    if (this.hasFts()) {
      try {
        this.db.prepare("INSERT INTO documents_fts(doc_id, title, content, tags) VALUES (?, ?, ?, ?)").run(
          doc.doc_id, doc.title, doc.content, doc.tags.join(" "),
        );
      } catch { /* FTS sync failure is non-fatal */ }
    }

    // Auto-embed for hybrid RAG if pipeline is configured
    if (this.embeddingPipeline) {
      // Fire-and-forget: embedding failure must not block document storage
      this.embeddingPipeline
        .ingestDocument(doc.doc_id, doc.content, doc.collection)
        .catch(() => { /* embedding failure is non-fatal */ });
    }

    return doc;
  }

  updateDocument(
    docId: string,
    updates: Partial<Pick<KnowledgeDocument, "content" | "tags" | "title">>,
  ): KnowledgeDocument {
    const existing = this.getDocument(docId);
    if (!existing) {
      throw new Error(`Knowledge document not found: ${docId}`);
    }
    const updated: KnowledgeDocument = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    this.db.prepare(`
      UPDATE documents SET title = ?, content = ?, tags = ?, updated_at = ?
      WHERE doc_id = ?
    `).run(
      updated.title, updated.content, JSON.stringify(updated.tags),
      updated.updated_at, docId,
    );

    return updated;
  }

  getDocument(docId: string): KnowledgeDocument | undefined {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE doc_id = ?")
      .get(docId) as Record<string, unknown> | undefined;
    return row ? this.rowToDocument(row) : undefined;
  }

  listCollection(collection: KnowledgeCollection): KnowledgeDocument[] {
    const rows = this.db
      .prepare("SELECT * FROM documents WHERE collection = ? ORDER BY created_at ASC")
      .all(collection) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToDocument(r));
  }

  /**
   * Full-text search across content + title + tags.
   * Uses FTS5 when available (ranked by BM25), falls back to SQL LIKE.
   */
  search(
    query: string,
    options?: { collection?: KnowledgeCollection; limit?: number },
  ): KnowledgeSearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const limit = options?.limit ?? 10;

    // Try FTS5 first
    if (this.hasFts() && terms.length > 0) {
      try {
        const sanitizeFtsToken = (token: string): string => {
          // Strip FTS5 operators and special characters, keep only word characters
          return token.replace(/[^\w]/g, "");
        };
        const ftsQuery = terms.map(t => sanitizeFtsToken(t)).filter(Boolean).map(t => `"${t}"`).join(" OR ");
        let ftsRows: Array<Record<string, unknown>>;
        if (options?.collection) {
          ftsRows = this.db.prepare(`
            SELECT d.*, rank FROM documents_fts f
            JOIN documents d ON d.doc_id = f.doc_id
            WHERE documents_fts MATCH ? AND d.collection = ?
            ORDER BY rank LIMIT ?
          `).all(ftsQuery, options.collection, limit) as Array<Record<string, unknown>>;
        } else {
          ftsRows = this.db.prepare(`
            SELECT d.*, rank FROM documents_fts f
            JOIN documents d ON d.doc_id = f.doc_id
            WHERE documents_fts MATCH ?
            ORDER BY rank LIMIT ?
          `).all(ftsQuery, limit) as Array<Record<string, unknown>>;
        }
        if (ftsRows.length > 0) {
          return ftsRows.map((r, i) => ({ doc: this.rowToDocument(r), score: ftsRows.length - i }));
        }
      } catch { /* fall through to LIKE search */ }
    }

    // Fallback: LIKE search
    let rows: Array<Record<string, unknown>>;
    if (options?.collection) {
      rows = this.db
        .prepare("SELECT * FROM documents WHERE collection = ?")
        .all(options.collection) as Array<Record<string, unknown>>;
    } else {
      rows = this.db
        .prepare("SELECT * FROM documents")
        .all() as Array<Record<string, unknown>>;
    }

    const results: KnowledgeSearchResult[] = [];

    for (const row of rows) {
      const doc = this.rowToDocument(row);
      const haystack = `${doc.title} ${doc.content} ${doc.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        // Title matches are worth double
        if (doc.title.toLowerCase().includes(term)) score += 2;
        // Content matches
        const count = (haystack.match(new RegExp(term, "g")) ?? []).length;
        score += count;
      }
      if (score > 0) results.push({ doc, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  deleteDocument(docId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM documents WHERE doc_id = ?")
      .run(docId);

    // Clean up embeddings if pipeline is configured
    if (result.changes > 0 && this.embeddingPipeline) {
      this.embeddingPipeline.deleteDocument(docId);
    }

    return result.changes > 0;
  }

  // ─── Playbook API ───────────────────────────────────────────────────────────

  addPlaybook(
    params: Omit<PlaybookEntry, "playbook_id" | "use_count" | "created_at">,
  ): PlaybookEntry {
    const entry: PlaybookEntry = {
      ...params,
      playbook_id: randomUUID(),
      use_count: 0,
      created_at: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO playbooks (playbook_id, title, category, body, tags, use_count, last_used_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.playbook_id, entry.title, entry.category, entry.body,
      JSON.stringify(entry.tags), entry.use_count,
      entry.last_used_at ?? null, entry.created_at,
    );

    return entry;
  }

  getPlaybook(playbookId: string): PlaybookEntry | undefined {
    const row = this.db
      .prepare("SELECT * FROM playbooks WHERE playbook_id = ?")
      .get(playbookId) as Record<string, unknown> | undefined;
    return row ? this.rowToPlaybook(row) : undefined;
  }

  listPlaybooks(category?: PlaybookEntry["category"]): PlaybookEntry[] {
    if (category) {
      const rows = this.db
        .prepare("SELECT * FROM playbooks WHERE category = ? ORDER BY created_at ASC")
        .all(category) as Array<Record<string, unknown>>;
      return rows.map((r) => this.rowToPlaybook(r));
    }
    const rows = this.db
      .prepare("SELECT * FROM playbooks ORDER BY created_at ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToPlaybook(r));
  }

  touchPlaybook(playbookId: string): PlaybookEntry {
    const existing = this.getPlaybook(playbookId);
    if (!existing) {
      throw new Error(`Playbook not found: ${playbookId}`);
    }
    const now = new Date().toISOString();
    const newCount = existing.use_count + 1;

    this.db.prepare(`
      UPDATE playbooks SET use_count = ?, last_used_at = ? WHERE playbook_id = ?
    `).run(newCount, now, playbookId);

    return {
      ...existing,
      use_count: newCount,
      last_used_at: now,
    };
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────

  getStats(): {
    document_count: number;
    playbook_count: number;
    collections: Record<string, number>;
  } {
    const docRow = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM documents")
      .get() as { cnt: number };
    const pbRow = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM playbooks")
      .get() as { cnt: number };

    const collRows = this.db
      .prepare("SELECT collection, COUNT(*) AS cnt FROM documents GROUP BY collection")
      .all() as Array<{ collection: string; cnt: number }>;

    const collections: Record<string, number> = {};
    for (const r of collRows) {
      collections[r.collection] = r.cnt;
    }

    return {
      document_count: docRow.cnt,
      playbook_count: pbRow.cnt,
      collections,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private rowToDocument(row: Record<string, unknown>): KnowledgeDocument {
    let tags: string[] = [];
    try {
      tags = JSON.parse((row.tags as string) ?? "[]") as string[];
    } catch {
      tags = [];
    }

    return {
      doc_id: row.doc_id as string,
      collection: row.collection as KnowledgeCollection,
      title: row.title as string,
      content: row.content as string,
      tags,
      source_agent_id: (row.source_agent_id as string) ?? undefined,
      source_run_id: (row.source_run_id as string) ?? undefined,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private rowToPlaybook(row: Record<string, unknown>): PlaybookEntry {
    let tags: string[] = [];
    try {
      tags = JSON.parse((row.tags as string) ?? "[]") as string[];
    } catch {
      tags = [];
    }

    return {
      playbook_id: row.playbook_id as string,
      title: row.title as string,
      category: row.category as PlaybookEntry["category"],
      body: row.body as string,
      tags,
      use_count: (row.use_count as number) ?? 0,
      last_used_at: (row.last_used_at as string) ?? undefined,
      created_at: row.created_at as string,
    };
  }
}
