import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CrmAdapter, ExecutionOutcome } from "./adapter.js";
import { CrmWorkerError } from "./adapter.js";
import type {
  ContactRecord,
  CrmAddContactInput,
  CrmAddContactOutput,
  CrmAddNoteInput,
  CrmAddNoteOutput,
  CrmDigestInput,
  CrmDigestOutput,
  CrmListPipelineInput,
  CrmListPipelineOutput,
  CrmMoveStageInput,
  CrmMoveStageOutput,
  CrmSearchInput,
  CrmSearchOutput,
  CrmUpdateContactInput,
  CrmUpdateContactOutput,
  NoteRecord,
  PipelineStage,
} from "./types.js";

// ── Constants ──────────────────────────────────────────────────────────────────

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

const HOT_STAGES = new Set<PipelineStage>(["meeting", "proposal", "negotiation"]);

const DEFAULT_DB_PATH = join(homedir(), ".jarvis", "crm.db");

function emptyStageRecord(): Record<PipelineStage, number> {
  return Object.fromEntries(ALL_STAGES.map((s) => [s, 0])) as Record<PipelineStage, number>;
}

// ── Row-to-type helpers ────────────────────────────────────────────────────────

function rowToContact(row: Record<string, unknown>): ContactRecord {
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

// ── SqliteCrmAdapter ────────────────────────────────────────────────────────────

export class SqliteCrmAdapter implements CrmAdapter {
  private readonly db: DatabaseSync;

  constructor(dbPath?: string) {
    this.db = new DatabaseSync(dbPath ?? DEFAULT_DB_PATH);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // best-effort
    }
  }

  // ── addContact ─────────────────────────────────────────────────────────────

  async addContact(
    input: CrmAddContactInput,
  ): Promise<ExecutionOutcome<CrmAddContactOutput>> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const stage = input.stage ?? "prospect";
    const tags = input.tags ?? [];

    this.db.prepare(`
      INSERT INTO contacts (id, name, company, role, email, linkedin_url, source, score, stage, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.company,
      input.role ?? null,
      input.email ?? null,
      input.linkedin_url ?? null,
      input.source ?? null,
      0,
      stage,
      JSON.stringify(tags),
      now,
      now,
    );

    // If an initial note was provided, insert it
    if (input.notes) {
      this.db.prepare(`
        INSERT INTO notes (id, contact_id, note, note_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), id, input.notes, "general", now);
    }

    const contact: ContactRecord = {
      contact_id: id,
      name: input.name,
      company: input.company,
      role: input.role,
      email: input.email,
      linkedin_url: input.linkedin_url,
      source: input.source,
      tags,
      stage,
      score: 0,
      created_at: now,
      updated_at: now,
    };

    return {
      summary: `Added contact ${contact.name} at ${contact.company} to stage ${contact.stage}.`,
      structured_output: { contact },
    };
  }

  // ── updateContact ──────────────────────────────────────────────────────────

  async updateContact(
    input: CrmUpdateContactInput,
  ): Promise<ExecutionOutcome<CrmUpdateContactOutput>> {
    const existing = this.getContactById(input.contact_id);
    if (!existing) {
      throw new CrmWorkerError(
        "CONTACT_NOT_FOUND",
        `Contact not found: ${input.contact_id}`,
        false,
        { contact_id: input.contact_id },
      );
    }

    const changesApplied: string[] = [];
    const updated = { ...existing };
    const now = new Date().toISOString();

    if (input.name !== undefined) { updated.name = input.name; changesApplied.push("name"); }
    if (input.company !== undefined) { updated.company = input.company; changesApplied.push("company"); }
    if (input.role !== undefined) { updated.role = input.role; changesApplied.push("role"); }
    if (input.email !== undefined) { updated.email = input.email; changesApplied.push("email"); }
    if (input.tags !== undefined) { updated.tags = input.tags; changesApplied.push("tags"); }
    if (input.score !== undefined) { updated.score = input.score; changesApplied.push("score"); }
    if (input.last_contact_at !== undefined) { updated.last_contact_at = input.last_contact_at; changesApplied.push("last_contact_at"); }

    updated.updated_at = now;

    this.db.prepare(`
      UPDATE contacts SET
        name = ?, company = ?, role = ?, email = ?, linkedin_url = ?,
        source = ?, score = ?, stage = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.company,
      updated.role ?? null,
      updated.email ?? null,
      updated.linkedin_url ?? null,
      updated.source ?? null,
      updated.score,
      updated.stage,
      JSON.stringify(updated.tags),
      updated.updated_at,
      input.contact_id,
    );

    return {
      summary: `Updated contact ${updated.name}: ${changesApplied.join(", ") || "no changes"}.`,
      structured_output: { contact: updated, changes_applied: changesApplied },
    };
  }

  // ── listPipeline ───────────────────────────────────────────────────────────

  async listPipeline(
    input: CrmListPipelineInput,
  ): Promise<ExecutionOutcome<CrmListPipelineOutput>> {
    const clauses: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.stage !== undefined) {
      clauses.push("stage = ?");
      params.push(input.stage);
    }
    if (input.min_score !== undefined) {
      clauses.push("score >= ?");
      params.push(input.min_score);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM contacts ${where} ORDER BY updated_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;

    let contacts = rows.map((r) => rowToContact(r));

    // Tag filtering done in-app since tags are stored as JSON
    if (input.tags && input.tags.length > 0) {
      const filterTags = input.tags;
      contacts = contacts.filter((c) =>
        filterTags.some((t) => c.tags.includes(t)),
      );
    }

    if (input.limit !== undefined && input.limit > 0) {
      contacts = contacts.slice(0, input.limit);
    }

    const stageCounts = this.getStageCounts();

    return {
      summary: `Listed ${contacts.length} contact(s) from pipeline${input.stage ? ` (stage: ${input.stage})` : ""}.`,
      structured_output: {
        contacts,
        total_count: contacts.length,
        stage_counts: stageCounts,
      },
    };
  }

  // ── moveStage ──────────────────────────────────────────────────────────────

  async moveStage(
    input: CrmMoveStageInput,
  ): Promise<ExecutionOutcome<CrmMoveStageOutput>> {
    const existing = this.getContactById(input.contact_id);
    if (!existing) {
      throw new CrmWorkerError(
        "CONTACT_NOT_FOUND",
        `Contact not found: ${input.contact_id}`,
        false,
        { contact_id: input.contact_id },
      );
    }

    const previousStage = existing.stage;
    const now = new Date().toISOString();

    this.db.prepare("UPDATE contacts SET stage = ?, updated_at = ? WHERE id = ?")
      .run(input.new_stage, now, input.contact_id);

    this.db.prepare(`
      INSERT INTO stage_history (id, contact_id, from_stage, to_stage, moved_at, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.contact_id,
      previousStage,
      input.new_stage,
      now,
      input.reason ?? null,
    );

    return {
      summary: `Moved contact ${existing.name} from ${previousStage} to ${input.new_stage}.`,
      structured_output: {
        contact_id: input.contact_id,
        previous_stage: previousStage,
        new_stage: input.new_stage,
        moved_at: now,
      },
    };
  }

  // ── addNote ────────────────────────────────────────────────────────────────

  async addNote(
    input: CrmAddNoteInput,
  ): Promise<ExecutionOutcome<CrmAddNoteOutput>> {
    const existing = this.getContactById(input.contact_id);
    if (!existing) {
      throw new CrmWorkerError(
        "CONTACT_NOT_FOUND",
        `Contact not found: ${input.contact_id}`,
        false,
        { contact_id: input.contact_id },
      );
    }

    const now = new Date().toISOString();
    const noteId = randomUUID();
    const noteType = input.note_type ?? "general";

    this.db.prepare(`
      INSERT INTO notes (id, contact_id, note, note_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(noteId, input.contact_id, input.content, noteType, now);

    // Touch the contact's updated_at timestamp
    this.db.prepare("UPDATE contacts SET updated_at = ? WHERE id = ?")
      .run(now, input.contact_id);

    const note: NoteRecord = {
      note_id: noteId,
      contact_id: input.contact_id,
      content: input.content,
      note_type: noteType,
      created_at: now,
    };

    return {
      summary: `Added ${note.note_type} note to contact ${existing.name}.`,
      structured_output: { note },
    };
  }

  // ── search ─────────────────────────────────────────────────────────────────

  async search(
    input: CrmSearchInput,
  ): Promise<ExecutionOutcome<CrmSearchOutput>> {
    const fields = input.fields ?? ["name", "company", "tags"];
    const needle = input.query.toLowerCase();

    const whereClauses: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.stage !== undefined) {
      whereClauses.push("stage = ?");
      params.push(input.stage);
    }

    // Build LIKE clauses for SQL-pushable fields
    const likeOr: string[] = [];
    for (const field of fields) {
      if (field === "name") likeOr.push("LOWER(name) LIKE ?");
      if (field === "company") likeOr.push("LOWER(company) LIKE ?");
      if (field === "tags") likeOr.push("LOWER(tags) LIKE ?");
    }

    if (likeOr.length > 0) {
      whereClauses.push(`(${likeOr.join(" OR ")})`);
      for (const _f of likeOr) {
        params.push(`%${needle}%`);
      }
    }

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM contacts ${where}`)
      .all(...params) as Array<Record<string, unknown>>;

    let contacts = rows.map((r) => rowToContact(r));

    // If "notes" is a search field, do a secondary lookup in notes table
    if (fields.includes("notes")) {
      const noteRows = this.db
        .prepare("SELECT DISTINCT contact_id FROM notes WHERE LOWER(note) LIKE ?")
        .all(`%${needle}%`) as Array<{ contact_id: string }>;

      const existingIds = new Set(contacts.map((c) => c.contact_id));
      for (const nr of noteRows) {
        if (!existingIds.has(nr.contact_id)) {
          const contact = this.getContactById(nr.contact_id);
          if (contact) {
            if (input.stage === undefined || contact.stage === input.stage) {
              contacts.push(contact);
            }
          }
        }
      }
    }

    // Also search email field if present (common CRM search expectation)
    // The interface allows name/company/notes/tags but the SQL also benefits
    // from matching email when those fields are used — however we stay strict
    // to the interface definition.

    return {
      summary: `Found ${contacts.length} contact(s) matching "${input.query}".`,
      structured_output: {
        contacts,
        total_matches: contacts.length,
        query: input.query,
      },
    };
  }

  // ── digest ─────────────────────────────────────────────────────────────────

  async digest(
    input: CrmDigestInput,
  ): Promise<ExecutionOutcome<CrmDigestOutput>> {
    const includeParked = input.include_parked ?? false;
    const daysSinceContact = input.days_since_contact ?? 30;

    // Get all contacts
    const allRows = this.db
      .prepare("SELECT * FROM contacts ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;

    let allContacts = allRows.map((r) => rowToContact(r));

    if (!includeParked) {
      allContacts = allContacts.filter((c) => c.stage !== "parked");
    }

    // Stage distribution
    const stageDistribution = this.getStageCounts();

    // Hot leads: score > 70 and in meeting/proposal/negotiation
    const hotLeads = allContacts.filter(
      (c) => c.score > 70 && HOT_STAGES.has(c.stage),
    );

    // Stale contacts: no contact in N days
    const cutoff = new Date(
      Date.now() - daysSinceContact * 24 * 60 * 60 * 1000,
    ).toISOString();
    const staleContacts = allContacts.filter(
      (c) => !c.last_contact_at || c.last_contact_at < cutoff,
    );

    // Recent stage movements
    const movementRows = this.db
      .prepare(`
        SELECT sh.contact_id, c.name, sh.from_stage, sh.to_stage, sh.moved_at
        FROM stage_history sh
        LEFT JOIN contacts c ON c.id = sh.contact_id
        ORDER BY sh.moved_at DESC
        LIMIT 10
      `)
      .all() as Array<{
        contact_id: string;
        name: string | null;
        from_stage: string;
        to_stage: string;
        moved_at: string;
      }>;

    const recentMovements = movementRows.map((r) => ({
      contact_id: r.contact_id,
      name: r.name ?? "Unknown",
      from: r.from_stage as PipelineStage,
      to: r.to_stage as PipelineStage,
      moved_at: r.moved_at,
    }));

    const digestAt = new Date().toISOString();

    return {
      summary: `Pipeline digest: ${allContacts.length} contacts, ${hotLeads.length} hot lead(s), ${staleContacts.length} stale.`,
      structured_output: {
        total_contacts: allContacts.length,
        stage_distribution: stageDistribution,
        hot_leads: hotLeads,
        stale_contacts: staleContacts,
        recent_movements: recentMovements,
        digest_at: digestAt,
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private getContactById(id: string): ContactRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToContact(row) : undefined;
  }

  private getStageCounts(): Record<PipelineStage, number> {
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
}

export function createSqliteCrmAdapter(dbPath?: string): CrmAdapter {
  return new SqliteCrmAdapter(dbPath);
}
