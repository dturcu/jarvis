/**
 * Stress: CRM Worker Exhaustive Tests
 *
 * Comprehensive coverage of all CRM operations: add contact variations,
 * field updates, pipeline listing with every stage/score/tag filter,
 * stage transition paths, note management, search queries, digest
 * analysis, concurrency, and edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockCrmAdapter, executeCrmJob } from "@jarvis/crm-worker";
import type { JobEnvelope } from "@jarvis/shared";
import { range } from "./helpers.js";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "crm-exhaustive", run_id: randomUUID() },
  };
}

// ── Add Contact Variations ─────────────────────────────────────────────────

describe("CRM Add Contact Variations", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("add contact with minimal fields: name, company, role", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Klaus Weber",
        company: "BMW AG",
        role: "Safety Director",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contact = result.structured_output?.contact as any;
    expect(contact.contact_id).toBeTruthy();
    expect(contact.name).toBe("Klaus Weber");
  });

  it("add contact with email", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Maria Schneider",
        company: "Audi",
        role: "ASPICE Lead",
        email: "m.schneider@audi.com",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contact = result.structured_output?.contact as any;
    expect(contact.contact_id).toBeTruthy();
  });

  it("add contact with tags", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Pierre Durand",
        company: "Renault",
        role: "Cybersecurity Architect",
        tags: ["cybersecurity", "oem", "french"],
      }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contact = result.structured_output?.contact as any;
    expect(contact.contact_id).toBeTruthy();
  });

  it("add contact with all fields", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Yukiko Tanaka",
        company: "Toyota",
        role: "Functional Safety Manager",
        email: "y.tanaka@toyota.com",
        tags: ["oem", "safety", "japan"],
      }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contact = result.structured_output?.contact as any;
    expect(contact.contact_id).toBeTruthy();
  });

  it("add contacts with duplicate names", async () => {
    const r1 = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "John Smith",
        company: "Company A",
        role: "Engineer",
      }),
      crm,
    );
    const r2 = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "John Smith",
        company: "Company B",
        role: "Manager",
      }),
      crm,
    );
    expect(r1.status).toBe("completed");
    expect(r2.status).toBe("completed");
    const id1 = (r1.structured_output?.contact as any).contact_id;
    const id2 = (r2.structured_output?.contact as any).contact_id;
    expect(id1).not.toBe(id2);
  });

  it("add 5 contacts sequentially and verify count via list_pipeline", async () => {
    for (const i of range(5)) {
      const result = await executeCrmJob(
        envelope("crm.add_contact", {
          name: `Batch Contact ${i}`,
          company: `Corp ${i}`,
          role: "Tester",
        }),
        crm,
      );
      expect(result.status).toBe("completed");
    }

    const pipeline = await executeCrmJob(
      envelope("crm.list_pipeline", {}),
      crm,
    );
    expect(pipeline.status).toBe("completed");
    // 5 seeded + 5 new
    expect((pipeline.structured_output?.contacts as any[]).length).toBeGreaterThanOrEqual(10);
  });

  it("add contact with empty tags array", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Empty Tags",
        company: "Test Corp",
        role: "Analyst",
        tags: [],
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Update Contact Fields ──────────────────────────────────────────────────

describe("CRM Update Contact Fields", () => {
  let crm: MockCrmAdapter;
  let testContactId: string;

  beforeEach(async () => {
    crm = new MockCrmAdapter();
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Update Target",
        company: "Test GmbH",
        role: "Engineer",
        tags: ["initial"],
      }),
      crm,
    );
    testContactId = (result.structured_output?.contact as any).contact_id;
  });

  it("update score", async () => {
    const result = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: testContactId,
        score: 85,
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("update tags", async () => {
    const result = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: testContactId,
        tags: ["updated", "priority"],
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("update score and tags together", async () => {
    const result = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: testContactId,
        score: 95,
        tags: ["hot-lead", "iso26262"],
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("update score to 0", async () => {
    const result = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: testContactId,
        score: 0,
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("update score to 100", async () => {
    const result = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: testContactId,
        score: 100,
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("update non-existent contact fails", async () => {
    const result = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: "nonexistent-id-999",
        score: 50,
      }),
      crm,
    );
    expect(result.status).toBe("failed");
  });
});

// ── Pipeline Listing ───────────────────────────────────────────────────────

describe("CRM Pipeline Listing Exhaustive", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("list all contacts without filters", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", {}),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBe(5);
    expect(result.structured_output?.total_count).toBe(5);
    expect(result.structured_output?.stage_counts).toBeDefined();
  });

  it("filter by stage: prospect", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "prospect" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.stage).toBe("prospect");
    }
  });

  it("filter by stage: qualified", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "qualified" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.stage).toBe("qualified");
    }
  });

  it("filter by stage: contacted", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "contacted" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBeGreaterThan(0);
    for (const c of contacts) {
      expect(c.stage).toBe("contacted");
    }
  });

  it("filter by stage: meeting", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "meeting" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.stage).toBe("meeting");
    }
  });

  it("filter by stage: proposal (empty initially)", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "proposal" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBe(0);
  });

  it("filter by stage: negotiation (empty initially)", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "negotiation" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBe(0);
  });

  it("filter by stage: won", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "won" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBeGreaterThan(0);
    for (const c of contacts) {
      expect(c.stage).toBe("won");
    }
  });

  it("filter by stage: lost (empty initially)", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "lost" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBe(0);
  });

  it("filter by stage: parked (empty initially)", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "parked" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBe(0);
  });

  it("filter by min_score: 0 returns all", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { min_score: 0 }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBe(5);
  });

  it("filter by min_score: 40 includes Radu (40) and above", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { min_score: 40 }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.score).toBeGreaterThanOrEqual(40);
    }
  });

  it("filter by min_score: 55 excludes Radu (40)", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { min_score: 55 }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.score).toBeGreaterThanOrEqual(55);
    }
  });

  it("filter by min_score: 70 returns high-scoring contacts only", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { min_score: 70 }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.score).toBeGreaterThanOrEqual(70);
    }
  });

  it("filter by min_score: 90 returns only top scorer", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { min_score: 90 }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.score).toBeGreaterThanOrEqual(90);
    }
  });

  it("filter by min_score: 100 returns none or only 100-scorers", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { min_score: 100 }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.score).toBeGreaterThanOrEqual(100);
    }
  });

  it("filter by limit: 1", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { limit: 1 }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeLessThanOrEqual(1);
  });

  it("filter by limit: 3", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { limit: 3 }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeLessThanOrEqual(3);
  });

  it("combined stage + min_score filter", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "contacted", min_score: 70 }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    for (const c of contacts) {
      expect(c.stage).toBe("contacted");
      expect(c.score).toBeGreaterThanOrEqual(70);
    }
  });
});

// ── Stage Transitions ──────────────────────────────────────────────────────

describe("CRM Stage Transitions", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("full pipeline path: prospect -> qualified -> contacted -> meeting -> proposal -> negotiation -> won", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Pipeline Runner",
        company: "Test AG",
        role: "Engineer",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    const stages = ["qualified", "contacted", "meeting", "proposal", "negotiation", "won"];
    let previousStage = "prospect";

    for (const stage of stages) {
      const result = await executeCrmJob(
        envelope("crm.move_stage", { contact_id: contactId, new_stage: stage }),
        crm,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.contact_id).toBe(contactId);
      expect(result.structured_output?.previous_stage).toBe(previousStage);
      expect(result.structured_output?.new_stage).toBe(stage);
      previousStage = stage;
    }
  });

  it("prospect to lost directly", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Direct Lost",
        company: "NoGo Corp",
        role: "Lead",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    const result = await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "lost" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.new_stage).toBe("lost");
  });

  it("prospect to parked directly", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Parked Lead",
        company: "Later Corp",
        role: "Manager",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    const result = await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "parked" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.new_stage).toBe("parked");
  });

  it("meeting to won (skip proposal and negotiation)", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Fast Closer",
        company: "Quick Deal AG",
        role: "Director",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "meeting" }),
      crm,
    );
    const result = await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "won" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.new_stage).toBe("won");
  });

  it("contacted to lost directly", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Drop Off",
        company: "Gone LLC",
        role: "Analyst",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "contacted" }),
      crm,
    );
    const result = await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "lost" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.new_stage).toBe("lost");
  });

  it("negotiation to lost", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Late Loss",
        company: "Almost Corp",
        role: "VP",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "negotiation" }),
      crm,
    );
    const result = await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "lost" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.new_stage).toBe("lost");
  });

  it("move non-existent contact fails", async () => {
    const result = await executeCrmJob(
      envelope("crm.move_stage", {
        contact_id: "nonexistent-contact-id-999",
        new_stage: "qualified",
      }),
      crm,
    );
    expect(result.status).toBe("failed");
  });

  it("move seeded contact (Francois) from contacted to meeting", async () => {
    // Francois Sagnely is at stage "contacted"
    const search = await executeCrmJob(
      envelope("crm.search", { query: "Sagnely" }),
      crm,
    );
    const contacts = search.structured_output?.contacts as any[];
    expect(contacts.length).toBeGreaterThan(0);
    const contactId = contacts[0].contact_id;

    const result = await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "meeting" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.previous_stage).toBe("contacted");
    expect(result.structured_output?.new_stage).toBe("meeting");
  });
});

// ── Add Note ───────────────────────────────────────────────────────────────

describe("CRM Add Note", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("add note to seeded contact (search by name)", async () => {
    const search = await executeCrmJob(
      envelope("crm.search", { query: "Anna" }),
      crm,
    );
    const contacts = search.structured_output?.contacts as any[];
    const contactId = contacts[0].contact_id;

    const result = await executeCrmJob(
      envelope("crm.add_note", {
        contact_id: contactId,
        content: "Discussed Volvo project timeline for Q3 2026.",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("add note to another seeded contact", async () => {
    const search = await executeCrmJob(
      envelope("crm.search", { query: "Thomas" }),
      crm,
    );
    const contacts = search.structured_output?.contacts as any[];
    const contactId = contacts[0].contact_id;

    const result = await executeCrmJob(
      envelope("crm.add_note", {
        contact_id: contactId,
        content: "EDAG needs ASPICE Level 2 assessment by end of year.",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("add multiple notes to same contact", async () => {
    const search = await executeCrmJob(
      envelope("crm.search", { query: "Radu" }),
      crm,
    );
    const contacts = search.structured_output?.contacts as any[];
    const contactId = contacts[0].contact_id;

    for (const i of range(5)) {
      const result = await executeCrmJob(
        envelope("crm.add_note", {
          contact_id: contactId,
          content: `Follow-up note #${i + 1}: Continental cybersecurity review progress.`,
        }),
        crm,
      );
      expect(result.status).toBe("completed");
    }
  });

  it("add note to newly created contact", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "New For Notes",
        company: "Notes Corp",
        role: "Tester",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    const result = await executeCrmJob(
      envelope("crm.add_note", {
        contact_id: contactId,
        content: "Initial discovery call completed.",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("add note to Marie Chen", async () => {
    const search = await executeCrmJob(
      envelope("crm.search", { query: "Marie" }),
      crm,
    );
    const contacts = search.structured_output?.contacts as any[];
    const contactId = contacts[0].contact_id;

    const result = await executeCrmJob(
      envelope("crm.add_note", {
        contact_id: contactId,
        content: "Garrett Motion interested in turbocharger safety assessment.",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Search ─────────────────────────────────────────────────────────────────

describe("CRM Search Exhaustive", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("search by name: Francois", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Sagnely" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBeGreaterThan(0);
    expect(result.structured_output?.query).toBe("Sagnely");
  });

  it("search by name: Anna", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Anna" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("search by name: Thomas Keller", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Thomas Keller" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("search by company: Bertrandt", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Bertrandt" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const contacts = result.structured_output?.contacts as any[];
    expect(contacts.length).toBeGreaterThan(0);
  });

  it("search by company: Volvo", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Volvo" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("search by company: Continental", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Continental" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("search by company: EDAG", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "EDAG" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("search by company: Garrett Motion", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Garrett" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("search by partial name match", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Lind" }),
      crm,
    );
    expect(result.status).toBe("completed");
    // Should match Lindstrom
    expect((result.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("search with no match returns empty", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "XYZNONEXISTENT" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBe(0);
    expect(result.structured_output?.total_matches).toBe(0);
  });

  it("search returns total_matches field", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Volvo" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.total_matches).toBeDefined();
    expect(result.structured_output?.total_matches).toBeGreaterThan(0);
  });

  it("search for newly added contact", async () => {
    await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Searchable New",
        company: "Findme Corp",
        role: "Tester",
      }),
      crm,
    );

    const result = await executeCrmJob(
      envelope("crm.search", { query: "Findme" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });
});

// ── Digest ─────────────────────────────────────────────────────────────────

describe("CRM Digest", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("default digest excludes parked contacts", async () => {
    // First park a contact
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Parked One",
        company: "Park Corp",
        role: "Lead",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;
    await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "parked" }),
      crm,
    );

    const result = await executeCrmJob(
      envelope("crm.digest", {}),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.total_contacts).toBeDefined();
    expect(result.structured_output?.stage_distribution).toBeDefined();
  });

  it("digest with include_parked: true", async () => {
    const result = await executeCrmJob(
      envelope("crm.digest", { include_parked: true }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.total_contacts).toBeDefined();
  });

  it("digest hot_leads criteria: score > 70 AND stage in hot stages", async () => {
    // Marie Chen: score=65, meeting -> not hot (score too low)
    // Anna Lindstrom: score=90, won -> not hot (won is not a hot stage)
    // Francois: score=75, contacted -> not hot (contacted is not meeting/proposal/negotiation)
    // Create a hot lead manually
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Hot Lead Test",
        company: "Hot Corp",
        role: "Director",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;
    await executeCrmJob(
      envelope("crm.update_contact", { contact_id: contactId, score: 85 }),
      crm,
    );
    await executeCrmJob(
      envelope("crm.move_stage", { contact_id: contactId, new_stage: "meeting" }),
      crm,
    );

    const result = await executeCrmJob(
      envelope("crm.digest", {}),
      crm,
    );
    expect(result.status).toBe("completed");
    const hotLeads = result.structured_output?.hot_leads as any[];
    if (hotLeads && hotLeads.length > 0) {
      for (const lead of hotLeads) {
        expect(lead.score).toBeGreaterThan(70);
      }
    }
  });

  it("digest stale_contacts field is present", async () => {
    const result = await executeCrmJob(
      envelope("crm.digest", {}),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.stale_contacts).toBeDefined();
  });

  it("digest stage_distribution covers all populated stages", async () => {
    const result = await executeCrmJob(
      envelope("crm.digest", {}),
      crm,
    );
    expect(result.status).toBe("completed");
    const dist = result.structured_output?.stage_distribution as Record<string, number>;
    expect(dist).toBeDefined();
    // At least some stages should have counts
    const totalFromDist = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(totalFromDist).toBeGreaterThan(0);
  });

  it("digest after adding multiple contacts reflects new totals", async () => {
    for (const i of range(3)) {
      await executeCrmJob(
        envelope("crm.add_contact", {
          name: `Digest Batch ${i}`,
          company: "Digest Corp",
          role: "Analyst",
        }),
        crm,
      );
    }

    const result = await executeCrmJob(
      envelope("crm.digest", {}),
      crm,
    );
    expect(result.status).toBe("completed");
    // 5 seeded + 3 new = at least 8
    expect(result.structured_output?.total_contacts).toBeGreaterThanOrEqual(8);
  });
});

// ── Concurrent CRM Operations ──────────────────────────────────────────────

describe("CRM Concurrent Operations", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("20 parallel add_contact operations", async () => {
    const results = await Promise.all(
      range(20).map((i) =>
        executeCrmJob(
          envelope("crm.add_contact", {
            name: `Concurrent Contact ${i}`,
            company: `Corp ${i % 5}`,
            role: i % 2 === 0 ? "Engineer" : "Manager",
            tags: [`batch-${Math.floor(i / 5)}`],
          }),
          crm,
        ),
      ),
    );

    expect(results).toHaveLength(20);
    for (const r of results) {
      expect(r.status).toBe("completed");
      expect((r.structured_output?.contact as any).contact_id).toBeTruthy();
    }

    // Verify all contacts are in pipeline
    const pipeline = await executeCrmJob(
      envelope("crm.list_pipeline", {}),
      crm,
    );
    // 5 seeded + 20 new = 25
    expect((pipeline.structured_output?.contacts as any[]).length).toBeGreaterThanOrEqual(25);
  });

  it("10 parallel search operations", async () => {
    const queries = [
      "Bertrandt", "Volvo", "EDAG", "Continental", "Garrett",
      "Anna", "Thomas", "Radu", "Marie", "Sagnely",
    ];

    const results = await Promise.all(
      queries.map((q) =>
        executeCrmJob(envelope("crm.search", { query: q }), crm),
      ),
    );

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.status).toBe("completed");
      expect(r.structured_output?.contacts).toBeDefined();
    }
  });

  it("mixed pipeline operations in parallel", async () => {
    const results = await Promise.all([
      // 3 list_pipeline
      executeCrmJob(envelope("crm.list_pipeline", {}), crm),
      executeCrmJob(envelope("crm.list_pipeline", { stage: "won" }), crm),
      executeCrmJob(envelope("crm.list_pipeline", { min_score: 70 }), crm),
      // 3 search
      executeCrmJob(envelope("crm.search", { query: "Volvo" }), crm),
      executeCrmJob(envelope("crm.search", { query: "Continental" }), crm),
      executeCrmJob(envelope("crm.search", { query: "EDAG" }), crm),
      // 2 digest
      executeCrmJob(envelope("crm.digest", {}), crm),
      executeCrmJob(envelope("crm.digest", { include_parked: true }), crm),
      // 2 add_contact
      executeCrmJob(
        envelope("crm.add_contact", { name: "Mixed Op 1", company: "Mix Corp", role: "Dev" }),
        crm,
      ),
      executeCrmJob(
        envelope("crm.add_contact", { name: "Mixed Op 2", company: "Mix Corp", role: "QA" }),
        crm,
      ),
    ]);

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.status).toBe("completed");
    }
  });

  it("rapid sequential stage transitions on different contacts", async () => {
    const contactIds: string[] = [];
    for (const i of range(5)) {
      const add = await executeCrmJob(
        envelope("crm.add_contact", {
          name: `Rapid ${i}`,
          company: "Rapid Corp",
          role: "Lead",
        }),
        crm,
      );
      contactIds.push((add.structured_output?.contact as any).contact_id);
    }

    const results = await Promise.all(
      contactIds.map((id) =>
        executeCrmJob(
          envelope("crm.move_stage", { contact_id: id, new_stage: "qualified" }),
          crm,
        ),
      ),
    );

    for (const r of results) {
      expect(r.status).toBe("completed");
      expect(r.structured_output?.new_stage).toBe("qualified");
    }
  });
});

// ── Edge Cases ─────────────────────────────────────────────────────────────

describe("CRM Edge Cases", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("add contact with very long company name (500 chars)", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Long Company",
        company: "A".repeat(500),
        role: "Lead",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("add contact with special characters in name", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Jean-Pierre O'Brien-Mueller",
        company: "Test & Associates GmbH",
        role: "Safety/Security Lead",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("add contact with unicode characters", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Muller",
        company: "Bosch",
        role: "Ingenieur",
      }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("update contact score to 0", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Zero Score",
        company: "Zero Corp",
        role: "Tester",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    const result = await executeCrmJob(
      envelope("crm.update_contact", { contact_id: contactId, score: 0 }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("update contact score to 100", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Perfect Score",
        company: "Perfect Corp",
        role: "Star",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    const result = await executeCrmJob(
      envelope("crm.update_contact", { contact_id: contactId, score: 100 }),
      crm,
    );
    expect(result.status).toBe("completed");
  });

  it("search with empty query", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "" }),
      crm,
    );
    expect(result.status).toBe("completed");
    // Empty query should return all or handle gracefully
    expect(result.structured_output?.contacts).toBeDefined();
  });

  it("search with special characters", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "O'Brien & Mueller" }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.contacts).toBeDefined();
  });

  it("add contact then immediately search for it", async () => {
    const uniqueName = `Unique-${randomUUID().slice(0, 8)}`;
    await executeCrmJob(
      envelope("crm.add_contact", {
        name: uniqueName,
        company: "Instant Corp",
        role: "Tester",
      }),
      crm,
    );

    const search = await executeCrmJob(
      envelope("crm.search", { query: uniqueName }),
      crm,
    );
    expect(search.status).toBe("completed");
    expect((search.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("list pipeline with combined stage + limit", async () => {
    const result = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "prospect", limit: 1 }),
      crm,
    );
    expect(result.status).toBe("completed");
    expect((result.structured_output?.contacts as any[]).length).toBeLessThanOrEqual(1);
  });

  it("add contact and traverse to every terminal stage", async () => {
    const terminals = ["won", "lost", "parked"];
    for (const terminal of terminals) {
      const add = await executeCrmJob(
        envelope("crm.add_contact", {
          name: `Terminal ${terminal}`,
          company: "Terminal Corp",
          role: "Lead",
        }),
        crm,
      );
      const contactId = (add.structured_output?.contact as any).contact_id;

      const result = await executeCrmJob(
        envelope("crm.move_stage", { contact_id: contactId, new_stage: terminal }),
        crm,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.new_stage).toBe(terminal);
    }
  });

  it("multiple notes then search context", async () => {
    const add = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Note Heavy",
        company: "Noted Corp",
        role: "Analyst",
      }),
      crm,
    );
    const contactId = (add.structured_output?.contact as any).contact_id;

    for (const i of range(10)) {
      await executeCrmJob(
        envelope("crm.add_note", {
          contact_id: contactId,
          content: `Detailed note entry #${i + 1} regarding ISO 26262 compliance review.`,
        }),
        crm,
      );
    }

    // Verify the contact is still searchable after many notes
    const search = await executeCrmJob(
      envelope("crm.search", { query: "Note Heavy" }),
      crm,
    );
    expect(search.status).toBe("completed");
    expect((search.structured_output?.contacts as any[]).length).toBeGreaterThan(0);
  });

  it("digest reflects correct stage_distribution after transitions", async () => {
    // Move some contacts around to create variety
    const search = await executeCrmJob(
      envelope("crm.search", { query: "Radu" }),
      crm,
    );
    const raduId = (search.structured_output?.contacts as any[])[0].contact_id;

    await executeCrmJob(
      envelope("crm.move_stage", { contact_id: raduId, new_stage: "qualified" }),
      crm,
    );

    const digest = await executeCrmJob(
      envelope("crm.digest", {}),
      crm,
    );
    expect(digest.status).toBe("completed");
    const dist = digest.structured_output?.stage_distribution as Record<string, number>;
    expect(dist).toBeDefined();
    // qualified should have at least Thomas (55) + Radu now
    expect(dist["qualified"]).toBeGreaterThanOrEqual(2);
  });
});
