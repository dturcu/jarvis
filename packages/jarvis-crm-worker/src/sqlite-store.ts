import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ContactRecord, NoteRecord, PipelineStage } from "./types.js";

const ALL_STAGES: PipelineStage[] = [
  "prospect",
  "qualified",
  "contacted",
  "meeting",
  "proposal",
  "negotiation",
  "won",
  "lost",
  "parked",
];

function emptyStageRecord(): Record<PipelineStage, number> {
  return Object.fromEntries(ALL_STAGES.map((s) => [s, 0])) as Record<PipelineStage, number>;
}

/**
 * SQLite-backed CRM store.
 *
 * Implements the same public API as the in-memory {@link CrmStore} but persists
 * all data to a SQLite database on disk.  The constructor expects the path to an
 * **already-initialised** database (created by `scripts/init-jarvis.ts`).
 */
export class SqliteCrmStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // best-effort
    }
  }

  // ─── Contact API ────────────────────────────────────────────────────────────

  addContact(
    params: Omit<ContactRecord, "contact_id" | "created_at" | "updated_at" | "score" | "stage" | "tags"> & {
      stage?: PipelineStage;
      tags?: string[];
      score?: number;
    },
  ): ContactRecord {
    const now = new Date().toISOString();
    const record: ContactRecord = {
      contact_id: randomUUID(),
      name: params.name,
      company: params.company,
      role: params.role,
      email: params.email,
      linkedin_url: params.linkedin_url,
      source: params.source,
      tags: params.tags ?? [],
      stage: params.stage ?? "prospect",
      score: params.score ?? 0,
      created_at: now,
      updated_at: now,
      last_contact_at: params.last_contact_at,
    };

    this.db.prepare(`
      INSERT INTO contacts (id, name, company, role, email, linkedin_url, source, score, stage, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.contact_id, record.name, record.company, record.role ?? null,
      record.email ?? null, record.linkedin_url ?? null, record.source ?? null,
      record.score, record.stage, JSON.stringify(record.tags),
      record.created_at, record.updated_at,
    );

    return record;
  }

  updateContact(id: string, updates: Partial<ContactRecord>): ContactRecord {
    const existing = this.getContact(id);
    if (!existing) {
      throw new Error(`Contact not found: ${id}`);
    }
    const updated: ContactRecord = {
      ...existing,
      ...updates,
      contact_id: existing.contact_id,
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };

    this.db.prepare(`
      UPDATE contacts SET
        name = ?, company = ?, role = ?, email = ?, linkedin_url = ?,
        source = ?, score = ?, stage = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.name, updated.company, updated.role ?? null,
      updated.email ?? null, updated.linkedin_url ?? null,
      updated.source ?? null, updated.score, updated.stage,
      JSON.stringify(updated.tags), updated.updated_at, id,
    );

    return updated;
  }

  getContact(id: string): ContactRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToContact(row) : undefined;
  }

  listContacts(filter?: {
    stage?: PipelineStage;
    tags?: string[];
    min_score?: number;
  }): ContactRecord[] {
    const clauses: string[] = [];
    const params: (string | number | null)[] = [];

    if (filter?.stage !== undefined) {
      clauses.push("stage = ?");
      params.push(filter.stage);
    }
    if (filter?.min_score !== undefined) {
      clauses.push("score >= ?");
      params.push(filter.min_score);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM contacts ${where} ORDER BY updated_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;

    let records = rows.map((r) => this.rowToContact(r));

    // Tag filtering is done in-app since tags are stored as JSON
    if (filter?.tags && filter.tags.length > 0) {
      const filterTags = filter.tags;
      records = records.filter((c) =>
        filterTags.some((t) => c.tags.includes(t)),
      );
    }

    return records;
  }

  moveStage(
    id: string,
    newStage: PipelineStage,
    reason?: string,
  ): { previous: PipelineStage; current: PipelineStage } {
    const existing = this.getContact(id);
    if (!existing) {
      throw new Error(`Contact not found: ${id}`);
    }
    const previous = existing.stage;
    const now = new Date().toISOString();

    this.db.prepare("UPDATE contacts SET stage = ?, updated_at = ? WHERE id = ?")
      .run(newStage, now, id);

    this.db.prepare(`
      INSERT INTO stage_history (id, contact_id, from_stage, to_stage, moved_at, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), id, previous, newStage, now, reason ?? null);

    return { previous, current: newStage };
  }

  // ─── Notes API ──────────────────────────────────────────────────────────────

  addNote(
    params: Omit<NoteRecord, "note_id" | "created_at">,
  ): NoteRecord {
    const now = new Date().toISOString();
    const note: NoteRecord = {
      note_id: randomUUID(),
      contact_id: params.contact_id,
      content: params.content,
      note_type: params.note_type,
      created_at: now,
    };

    this.db.prepare(`
      INSERT INTO notes (id, contact_id, note, note_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(note.note_id, note.contact_id, note.content, note.note_type, note.created_at);

    return note;
  }

  getNotes(contactId: string): NoteRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM notes WHERE contact_id = ? ORDER BY created_at DESC")
      .all(contactId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      note_id: r.id as string,
      contact_id: r.contact_id as string,
      content: r.note as string,
      note_type: (r.note_type as string) ?? "general",
      created_at: r.created_at as string,
    }));
  }

  // ─── Search API ─────────────────────────────────────────────────────────────

  searchContacts(
    query: string,
    fields: string[],
    stage?: PipelineStage,
  ): ContactRecord[] {
    const needle = query.toLowerCase();
    const searchFields = fields.length > 0 ? fields : ["name", "company", "tags"];

    const clauses: string[] = [];
    const params: (string | number | null)[] = [];

    if (stage !== undefined) {
      clauses.push("stage = ?");
      params.push(stage);
    }

    // Build LIKE clauses for SQL-pushable fields
    const likeOr: string[] = [];
    for (const field of searchFields) {
      if (field === "name") likeOr.push("LOWER(name) LIKE ?");
      if (field === "company") likeOr.push("LOWER(company) LIKE ?");
      if (field === "tags") likeOr.push("LOWER(tags) LIKE ?");
    }

    if (likeOr.length > 0) {
      clauses.push(`(${likeOr.join(" OR ")})`);
      for (const _f of likeOr) {
        params.push(`%${needle}%`);
      }
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM contacts ${where}`)
      .all(...params) as Array<Record<string, unknown>>;

    let records = rows.map((r) => this.rowToContact(r));

    // If "notes" is a search field, do a secondary in-app check
    if (searchFields.includes("notes")) {
      const contactsFromNotes = this.searchNotes(needle);
      const existingIds = new Set(records.map((c) => c.contact_id));
      for (const cid of contactsFromNotes) {
        if (!existingIds.has(cid)) {
          const contact = this.getContact(cid);
          if (contact) {
            if (stage === undefined || contact.stage === stage) {
              records.push(contact);
            }
          }
        }
      }
    }

    return records;
  }

  // ─── Stage History ──────────────────────────────────────────────────────────

  getStageHistory(contactId?: string, limit = 20): Array<{
    contact_id: string;
    from_stage: string;
    to_stage: string;
    moved_at: string;
    note: string | null;
  }> {
    if (contactId) {
      return this.db
        .prepare("SELECT * FROM stage_history WHERE contact_id = ? ORDER BY moved_at DESC LIMIT ?")
        .all(contactId, limit) as Array<{
          contact_id: string;
          from_stage: string;
          to_stage: string;
          moved_at: string;
          note: string | null;
        }>;
    }

    return this.db
      .prepare("SELECT * FROM stage_history ORDER BY moved_at DESC LIMIT ?")
      .all(limit) as Array<{
        contact_id: string;
        from_stage: string;
        to_stage: string;
        moved_at: string;
        note: string | null;
      }>;
  }

  // ─── Pipeline / Stats ───────────────────────────────────────────────────────

  listPipeline(filter?: {
    stage?: PipelineStage;
    tags?: string[];
    min_score?: number;
  }): { contacts: ContactRecord[]; stage_counts: Record<PipelineStage, number> } {
    const contacts = this.listContacts(filter);
    return {
      contacts,
      stage_counts: this.getStageCounts(),
    };
  }

  getStageCounts(): Record<PipelineStage, number> {
    const counts = emptyStageRecord();
    const rows = this.db
      .prepare("SELECT stage, COUNT(*) AS cnt FROM contacts GROUP BY stage")
      .all() as Array<{ stage: string; cnt: number }>;
    for (const row of rows) {
      if (row.stage in counts) {
        counts[row.stage as PipelineStage] = row.cnt;
      }
    }
    return counts;
  }

  getRecentMovements(limit = 20): Array<{
    contact_id: string;
    name: string;
    from: PipelineStage;
    to: PipelineStage;
    moved_at: string;
  }> {
    const rows = this.db
      .prepare(`
        SELECT sh.contact_id, c.name, sh.from_stage, sh.to_stage, sh.moved_at
        FROM stage_history sh
        LEFT JOIN contacts c ON c.id = sh.contact_id
        ORDER BY sh.moved_at DESC
        LIMIT ?
      `)
      .all(limit) as Array<{
        contact_id: string;
        name: string;
        from_stage: string;
        to_stage: string;
        moved_at: string;
      }>;

    return rows.map((r) => ({
      contact_id: r.contact_id,
      name: r.name ?? "Unknown",
      from: r.from_stage as PipelineStage,
      to: r.to_stage as PipelineStage,
      moved_at: r.moved_at,
    }));
  }

  getStats(): { total: number; by_stage: Record<PipelineStage, number> } {
    const row = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM contacts")
      .get() as { cnt: number };
    return {
      total: row.cnt,
      by_stage: this.getStageCounts(),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private rowToContact(row: Record<string, unknown>): ContactRecord {
    let tags: string[] = [];
    try {
      tags = JSON.parse((row.tags as string) ?? "[]") as string[];
    } catch {
      tags = [];
    }

    return {
      contact_id: row.id as string,
      name: row.name as string,
      company: row.company as string,
      role: (row.role as string) ?? undefined,
      email: (row.email as string) ?? undefined,
      linkedin_url: (row.linkedin_url as string) ?? undefined,
      source: (row.source as string) ?? undefined,
      tags,
      stage: (row.stage as PipelineStage) ?? "prospect",
      score: (row.score as number) ?? 0,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private searchNotes(needle: string): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT contact_id FROM notes WHERE LOWER(note) LIKE ?")
      .all(`%${needle}%`) as Array<{ contact_id: string }>;
    return rows.map((r) => r.contact_id);
  }
}
