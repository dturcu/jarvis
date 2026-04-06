import { randomUUID } from "node:crypto";
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
  "parked"
];

function emptyStageRecord(): Record<PipelineStage, number> {
  return Object.fromEntries(ALL_STAGES.map((s) => [s, 0])) as Record<PipelineStage, number>;
}

export class CrmStore {
  private contacts = new Map<string, ContactRecord>();
  private notes = new Map<string, NoteRecord>();
  private stageHistory: {
    contact_id: string;
    name: string;
    from: PipelineStage;
    to: PipelineStage;
    moved_at: string;
  }[] = [];

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
      last_contact_at: params.last_contact_at
    };
    this.contacts.set(record.contact_id, record);
    return record;
  }

  updateContact(id: string, updates: Partial<ContactRecord>): ContactRecord {
    const existing = this.contacts.get(id);
    if (!existing) {
      throw new Error(`Contact not found: ${id}`);
    }
    const updated: ContactRecord = {
      ...existing,
      ...updates,
      contact_id: existing.contact_id,
      created_at: existing.created_at,
      updated_at: new Date().toISOString()
    };
    this.contacts.set(id, updated);
    return updated;
  }

  getContact(id: string): ContactRecord | undefined {
    return this.contacts.get(id);
  }

  listContacts(filter?: {
    stage?: PipelineStage;
    tags?: string[];
    min_score?: number;
  }): ContactRecord[] {
    let records = Array.from(this.contacts.values());
    if (filter?.stage !== undefined) {
      records = records.filter((c) => c.stage === filter.stage);
    }
    if (filter?.tags && filter.tags.length > 0) {
      const filterTags = filter.tags;
      records = records.filter((c) =>
        filterTags.some((t) => c.tags.includes(t))
      );
    }
    if (filter?.min_score !== undefined) {
      records = records.filter((c) => c.score >= filter.min_score!);
    }
    return records;
  }

  moveStage(
    id: string,
    newStage: PipelineStage,
    _reason?: string,
  ): { previous: PipelineStage; current: PipelineStage } {
    const existing = this.contacts.get(id);
    if (!existing) {
      throw new Error(`Contact not found: ${id}`);
    }
    const previous = existing.stage;
    const now = new Date().toISOString();
    existing.stage = newStage;
    existing.updated_at = now;
    this.contacts.set(id, existing);
    this.stageHistory.push({
      contact_id: id,
      name: existing.name,
      from: previous,
      to: newStage,
      moved_at: now
    });
    return { previous, current: newStage };
  }

  addNote(
    params: Omit<NoteRecord, "note_id" | "created_at">,
  ): NoteRecord {
    const now = new Date().toISOString();
    const note: NoteRecord = {
      note_id: randomUUID(),
      contact_id: params.contact_id,
      content: params.content,
      note_type: params.note_type,
      created_at: now
    };
    this.notes.set(note.note_id, note);
    return note;
  }

  searchContacts(
    query: string,
    fields: string[],
    stage?: PipelineStage,
  ): ContactRecord[] {
    const needle = query.toLowerCase();
    const searchFields = fields.length > 0 ? fields : ["name", "company", "tags"];
    let records = Array.from(this.contacts.values());
    if (stage !== undefined) {
      records = records.filter((c) => c.stage === stage);
    }
    return records.filter((c) => {
      for (const field of searchFields) {
        if (field === "name" && c.name.toLowerCase().includes(needle)) return true;
        if (field === "company" && c.company.toLowerCase().includes(needle)) return true;
        if (field === "tags" && c.tags.some((t) => t.toLowerCase().includes(needle))) return true;
        if (field === "notes") {
          const contactNotes = Array.from(this.notes.values()).filter(
            (n) => n.contact_id === c.contact_id
          );
          if (contactNotes.some((n) => n.content.toLowerCase().includes(needle))) return true;
        }
      }
      return false;
    });
  }

  getStageCounts(): Record<PipelineStage, number> {
    const counts = emptyStageRecord();
    for (const contact of this.contacts.values()) {
      counts[contact.stage] += 1;
    }
    return counts;
  }

  getRecentMovements(limit = 20): {
    contact_id: string;
    name: string;
    from: PipelineStage;
    to: PipelineStage;
    moved_at: string;
  }[] {
    return this.stageHistory.slice(-limit);
  }

  getStats(): { total: number; by_stage: Record<PipelineStage, number> } {
    return {
      total: this.contacts.size,
      by_stage: this.getStageCounts()
    };
  }
}
