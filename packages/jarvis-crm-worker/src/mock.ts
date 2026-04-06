import type { CrmAdapter, ExecutionOutcome } from "./adapter.js";
import { CrmWorkerError } from "./adapter.js";
import { CrmStore } from "./store.js";
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
  PipelineStage
} from "./types.js";

const HOT_STAGES = new Set<PipelineStage>(["meeting", "proposal", "negotiation"]);

export class MockCrmAdapter implements CrmAdapter {
  readonly store: CrmStore;

  constructor(store?: CrmStore) {
    this.store = store ?? new CrmStore();
    this._seed();
  }

  private _seed(): void {
    // François Sagnely, Bertrandt, VP Engineering, stage: contacted, score: 75
    this.store.addContact({
      name: "François Sagnely",
      company: "Bertrandt",
      role: "VP Engineering",
      tags: ["AUTOSAR", "safety"],
      stage: "contacted",
      score: 75
    });

    // Anna Lindström, Volvo Cars, Safety Architect, stage: won, score: 90
    this.store.addContact({
      name: "Anna Lindström",
      company: "Volvo Cars",
      role: "Safety Architect",
      tags: [],
      stage: "won",
      score: 90
    });

    // Thomas Keller, EDAG, Project Manager, stage: qualified, score: 55
    this.store.addContact({
      name: "Thomas Keller",
      company: "EDAG",
      role: "Project Manager",
      tags: ["ISO 26262"],
      stage: "qualified",
      score: 55
    });

    // Radu Ionescu, Continental, ASPICE Lead, stage: prospect, score: 40
    this.store.addContact({
      name: "Radu Ionescu",
      company: "Continental",
      role: "ASPICE Lead",
      tags: [],
      stage: "prospect",
      score: 40
    });

    // Marie Chen, Garrett Motion, Systems Engineer, stage: meeting, score: 65
    this.store.addContact({
      name: "Marie Chen",
      company: "Garrett Motion",
      role: "Systems Engineer",
      tags: ["timing", "MPU"],
      stage: "meeting",
      score: 65
    });
  }

  async addContact(
    input: CrmAddContactInput,
  ): Promise<ExecutionOutcome<CrmAddContactOutput>> {
    const contact = this.store.addContact({
      name: input.name,
      company: input.company,
      role: input.role,
      email: input.email,
      linkedin_url: input.linkedin_url,
      source: input.source,
      tags: input.tags,
      stage: input.stage,
      score: 0
    });
    return {
      summary: `Added contact ${contact.name} at ${contact.company} to stage ${contact.stage}.`,
      structured_output: { contact }
    };
  }

  async updateContact(
    input: CrmUpdateContactInput,
  ): Promise<ExecutionOutcome<CrmUpdateContactOutput>> {
    const existing = this.store.getContact(input.contact_id);
    if (!existing) {
      throw new CrmWorkerError(
        "CONTACT_NOT_FOUND",
        `Contact not found: ${input.contact_id}`,
        false,
        { contact_id: input.contact_id }
      );
    }

    const updates: Partial<ContactRecord> = {};
    const changesApplied: string[] = [];

    if (input.name !== undefined) { updates.name = input.name; changesApplied.push("name"); }
    if (input.company !== undefined) { updates.company = input.company; changesApplied.push("company"); }
    if (input.role !== undefined) { updates.role = input.role; changesApplied.push("role"); }
    if (input.email !== undefined) { updates.email = input.email; changesApplied.push("email"); }
    if (input.tags !== undefined) { updates.tags = input.tags; changesApplied.push("tags"); }
    if (input.score !== undefined) { updates.score = input.score; changesApplied.push("score"); }
    if (input.last_contact_at !== undefined) {
      updates.last_contact_at = input.last_contact_at;
      changesApplied.push("last_contact_at");
    }

    const contact = this.store.updateContact(input.contact_id, updates);
    return {
      summary: `Updated contact ${contact.name}: ${changesApplied.join(", ") || "no changes"}.`,
      structured_output: { contact, changes_applied: changesApplied }
    };
  }

  async listPipeline(
    input: CrmListPipelineInput,
  ): Promise<ExecutionOutcome<CrmListPipelineOutput>> {
    let contacts = this.store.listContacts({
      stage: input.stage,
      tags: input.tags,
      min_score: input.min_score
    });

    if (input.limit !== undefined && input.limit > 0) {
      contacts = contacts.slice(0, input.limit);
    }

    const stage_counts = this.store.getStageCounts();

    return {
      summary: `Listed ${contacts.length} contact(s) from pipeline${input.stage ? ` (stage: ${input.stage})` : ""}.`,
      structured_output: {
        contacts,
        total_count: contacts.length,
        stage_counts
      }
    };
  }

  async moveStage(
    input: CrmMoveStageInput,
  ): Promise<ExecutionOutcome<CrmMoveStageOutput>> {
    const existing = this.store.getContact(input.contact_id);
    if (!existing) {
      throw new CrmWorkerError(
        "CONTACT_NOT_FOUND",
        `Contact not found: ${input.contact_id}`,
        false,
        { contact_id: input.contact_id }
      );
    }

    const { previous, current } = this.store.moveStage(
      input.contact_id,
      input.new_stage,
      input.reason
    );
    const movedAt = new Date().toISOString();

    return {
      summary: `Moved contact ${existing.name} from ${previous} to ${current}.`,
      structured_output: {
        contact_id: input.contact_id,
        previous_stage: previous,
        new_stage: current,
        moved_at: movedAt
      }
    };
  }

  async addNote(
    input: CrmAddNoteInput,
  ): Promise<ExecutionOutcome<CrmAddNoteOutput>> {
    const existing = this.store.getContact(input.contact_id);
    if (!existing) {
      throw new CrmWorkerError(
        "CONTACT_NOT_FOUND",
        `Contact not found: ${input.contact_id}`,
        false,
        { contact_id: input.contact_id }
      );
    }

    const note = this.store.addNote({
      contact_id: input.contact_id,
      content: input.content,
      note_type: input.note_type ?? "general"
    });

    return {
      summary: `Added ${note.note_type} note to contact ${existing.name}.`,
      structured_output: { note }
    };
  }

  async search(
    input: CrmSearchInput,
  ): Promise<ExecutionOutcome<CrmSearchOutput>> {
    const fields = input.fields ?? ["name", "company", "tags"];
    const contacts = this.store.searchContacts(input.query, fields, input.stage);

    return {
      summary: `Found ${contacts.length} contact(s) matching "${input.query}".`,
      structured_output: {
        contacts,
        total_matches: contacts.length,
        query: input.query
      }
    };
  }

  async digest(
    input: CrmDigestInput,
  ): Promise<ExecutionOutcome<CrmDigestOutput>> {
    const includeParked = input.include_parked ?? false;
    const daysSinceContact = input.days_since_contact ?? 30;

    let allContacts = this.store.listContacts();
    if (!includeParked) {
      allContacts = allContacts.filter((c) => c.stage !== "parked");
    }

    const stageDistribution = this.store.getStageCounts();

    const hotLeads = allContacts.filter(
      (c) => c.score > 70 && HOT_STAGES.has(c.stage)
    );

    const cutoff = new Date(
      Date.now() - daysSinceContact * 24 * 60 * 60 * 1000
    ).toISOString();
    const staleContacts = allContacts.filter(
      (c) => !c.last_contact_at || c.last_contact_at < cutoff
    );

    const recentMovements = this.store.getRecentMovements(10).map((m) => ({
      contact_id: m.contact_id,
      name: m.name,
      from: m.from,
      to: m.to,
      moved_at: m.moved_at
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
        digest_at: digestAt
      }
    };
  }
}

export function createMockCrmAdapter(store?: CrmStore): CrmAdapter {
  return new MockCrmAdapter(store);
}
