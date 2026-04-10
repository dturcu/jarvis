import { beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, resetJarvisState } from "@jarvis/shared";
import {
  CrmStore,
  MockCrmAdapter,
  createMockCrmAdapter,
  createCrmWorker,
  executeCrmJob,
  isCrmJobType,
  CRM_JOB_TYPES,
  CRM_WORKER_ID,
  CrmWorkerError
} from "@jarvis/crm-worker";
import type { JobEnvelope } from "@jarvis/shared";

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:main:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 60,
    attempt: 1,
    input,
    artifacts_in: [],
    retry_policy: { mode: "manual", max_attempts: 3 },
    metadata: {
      agent_id: "main",
      thread_key: null
    },
    ...overrides
  };
}

// ── CRM_JOB_TYPES ─────────────────────────────────────────────────────────────

describe("CRM_JOB_TYPES", () => {
  it("contains all 7 CRM job types", () => {
    expect(CRM_JOB_TYPES).toHaveLength(7);
    expect(CRM_JOB_TYPES).toContain("crm.add_contact");
    expect(CRM_JOB_TYPES).toContain("crm.update_contact");
    expect(CRM_JOB_TYPES).toContain("crm.list_pipeline");
    expect(CRM_JOB_TYPES).toContain("crm.move_stage");
    expect(CRM_JOB_TYPES).toContain("crm.add_note");
    expect(CRM_JOB_TYPES).toContain("crm.search");
    expect(CRM_JOB_TYPES).toContain("crm.digest");
  });
});

// ── isCrmJobType ──────────────────────────────────────────────────────────────

describe("isCrmJobType", () => {
  it("returns true for known CRM job types", () => {
    for (const type of CRM_JOB_TYPES) {
      expect(isCrmJobType(type)).toBe(true);
    }
  });

  it("returns false for unknown job types", () => {
    expect(isCrmJobType("system.monitor_cpu")).toBe(false);
    expect(isCrmJobType("device.snapshot")).toBe(false);
    expect(isCrmJobType("crm.nonexistent")).toBe(false);
    expect(isCrmJobType("")).toBe(false);
  });
});

// ── CrmStore ──────────────────────────────────────────────────────────────────

describe("CrmStore", () => {
  let store: CrmStore;

  beforeEach(() => {
    store = new CrmStore();
  });

  it("addContact defaults stage to prospect", () => {
    const contact = store.addContact({ name: "Test User", company: "Acme" });
    expect(contact.stage).toBe("prospect");
  });

  it("addContact respects explicit stage", () => {
    const contact = store.addContact({ name: "Test User", company: "Acme", stage: "qualified" });
    expect(contact.stage).toBe("qualified");
  });

  it("addContact defaults tags to empty array", () => {
    const contact = store.addContact({ name: "Test User", company: "Acme" });
    expect(contact.tags).toEqual([]);
  });

  it("getContact returns the created contact", () => {
    const created = store.addContact({ name: "Alice", company: "Corp" });
    const fetched = store.getContact(created.contact_id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Alice");
  });

  it("updateContact applies changes", () => {
    const contact = store.addContact({ name: "Bob", company: "Inc" });
    const updated = store.updateContact(contact.contact_id, { name: "Robert" });
    expect(updated.name).toBe("Robert");
    expect(updated.company).toBe("Inc");
  });

  it("updateContact throws for unknown id", () => {
    expect(() => store.updateContact("nonexistent-id", { name: "X" })).toThrow("Contact not found");
  });

  it("listContacts returns all contacts by default", () => {
    store.addContact({ name: "A", company: "X" });
    store.addContact({ name: "B", company: "Y" });
    const contacts = store.listContacts();
    expect(contacts.length).toBe(2);
  });

  it("listContacts filters by stage", () => {
    store.addContact({ name: "A", company: "X", stage: "qualified" });
    store.addContact({ name: "B", company: "Y", stage: "prospect" });
    const qualified = store.listContacts({ stage: "qualified" });
    expect(qualified.length).toBe(1);
    expect(qualified[0]!.name).toBe("A");
  });

  it("listContacts filters by min_score", () => {
    store.addContact({ name: "A", company: "X", score: 30 });
    store.addContact({ name: "B", company: "Y", score: 70 });
    const highScore = store.listContacts({ min_score: 60 });
    expect(highScore.length).toBe(1);
    expect(highScore[0]!.name).toBe("B");
  });

  it("moveStage changes stage and records history", () => {
    const contact = store.addContact({ name: "A", company: "X", stage: "prospect" });
    const result = store.moveStage(contact.contact_id, "qualified");
    expect(result.previous).toBe("prospect");
    expect(result.current).toBe("qualified");
    const updated = store.getContact(contact.contact_id);
    expect(updated!.stage).toBe("qualified");
    const history = store.getRecentMovements();
    expect(history.length).toBe(1);
    expect(history[0]!.from).toBe("prospect");
    expect(history[0]!.to).toBe("qualified");
  });

  it("moveStage throws for unknown id", () => {
    expect(() => store.moveStage("nonexistent-id", "qualified")).toThrow("Contact not found");
  });

  it("addNote attaches to a contact", () => {
    const contact = store.addContact({ name: "A", company: "X" });
    const note = store.addNote({
      contact_id: contact.contact_id,
      content: "Test note",
      note_type: "call"
    });
    expect(note.note_id).toBeDefined();
    expect(note.contact_id).toBe(contact.contact_id);
    expect(note.note_type).toBe("call");
  });

  it("searchContacts finds by name", () => {
    store.addContact({ name: "Luca Bianchi", company: "Meridian Engineering" });
    store.addContact({ name: "Ingrid Dahl", company: "Nordic Auto" });
    const results = store.searchContacts("Bianchi", ["name"], undefined);
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("Luca Bianchi");
  });

  it("searchContacts finds by company", () => {
    store.addContact({ name: "Test", company: "Zentral Automotive" });
    store.addContact({ name: "Other", company: "Nordic Auto" });
    const results = store.searchContacts("Zentral Automotive", ["company"], undefined);
    expect(results.length).toBe(1);
    expect(results[0]!.company).toBe("Zentral Automotive");
  });

  it("searchContacts returns empty when no match", () => {
    store.addContact({ name: "Nobody", company: "Unknown" });
    const results = store.searchContacts("zzznomatch", ["name", "company"], undefined);
    expect(results.length).toBe(0);
  });

  it("getStageCounts reflects actual distribution", () => {
    store.addContact({ name: "A", company: "X", stage: "prospect" });
    store.addContact({ name: "B", company: "Y", stage: "prospect" });
    store.addContact({ name: "C", company: "Z", stage: "qualified" });
    const counts = store.getStageCounts();
    expect(counts.prospect).toBe(2);
    expect(counts.qualified).toBe(1);
    expect(counts.meeting).toBe(0);
  });
});

// ── MockCrmAdapter ────────────────────────────────────────────────────────────

describe("MockCrmAdapter", () => {
  let adapter: MockCrmAdapter;

  beforeEach(() => {
    adapter = new MockCrmAdapter();
  });

  it("pre-seeds 5 mock contacts", () => {
    const contacts = adapter.store.listContacts();
    expect(contacts.length).toBe(5);
  });

  it("Luca Bianchi is in contacted stage", () => {
    const contacts = adapter.store.listContacts({ stage: "contacted" });
    const bianchi = contacts.find((c) => c.name === "Luca Bianchi");
    expect(bianchi).toBeDefined();
    expect(bianchi!.company).toBe("Meridian Engineering");
    expect(bianchi!.score).toBe(75);
    expect(bianchi!.tags).toContain("AUTOSAR");
  });

  it("Ingrid Dahl is in won stage with score 90", () => {
    const contacts = adapter.store.listContacts({ stage: "won" });
    const anna = contacts.find((c) => c.name === "Ingrid Dahl");
    expect(anna).toBeDefined();
    expect(anna!.company).toBe("Nordic Auto AB");
    expect(anna!.score).toBe(90);
  });

  it("Thomas Keller is in qualified stage", () => {
    const contacts = adapter.store.listContacts({ stage: "qualified" });
    const keller = contacts.find((c) => c.name === "Thomas Keller");
    expect(keller).toBeDefined();
    expect(keller!.score).toBe(55);
    expect(keller!.tags).toContain("ISO 26262");
  });

  it("Mihai Popov is in prospect stage", () => {
    const contacts = adapter.store.listContacts({ stage: "prospect" });
    const radu = contacts.find((c) => c.name === "Mihai Popov");
    expect(radu).toBeDefined();
    expect(radu!.company).toBe("Zentral Automotive");
  });

  it("Marie Chen is in meeting stage", () => {
    const contacts = adapter.store.listContacts({ stage: "meeting" });
    const marie = contacts.find((c) => c.name === "Marie Chen");
    expect(marie).toBeDefined();
    expect(marie!.tags).toContain("timing");
    expect(marie!.tags).toContain("MPU");
  });

  describe("addContact", () => {
    it("creates contact with default stage prospect", async () => {
      const result = await adapter.addContact({ name: "New Contact", company: "Test Corp" });
      expect(result.structured_output.contact.stage).toBe("prospect");
      expect(result.structured_output.contact.name).toBe("New Contact");
    });

    it("creates contact with custom stage", async () => {
      const result = await adapter.addContact({
        name: "Senior Contact",
        company: "Big Corp",
        stage: "meeting"
      });
      expect(result.structured_output.contact.stage).toBe("meeting");
    });
  });

  describe("updateContact", () => {
    it("updates contact fields and returns changes_applied", async () => {
      const contacts = adapter.store.listContacts();
      const contact = contacts[0]!;
      const result = await adapter.updateContact({
        contact_id: contact.contact_id,
        score: 80
      });
      expect(result.structured_output.contact.score).toBe(80);
      expect(result.structured_output.changes_applied).toContain("score");
    });

    it("throws CrmWorkerError for unknown contact_id", async () => {
      await expect(
        adapter.updateContact({ contact_id: "nonexistent-id", score: 50 })
      ).rejects.toThrow(CrmWorkerError);
    });
  });

  describe("listPipeline", () => {
    it("returns all contacts when no filter", async () => {
      const result = await adapter.listPipeline({});
      expect(result.structured_output.contacts.length).toBe(5);
      expect(result.structured_output.total_count).toBe(5);
    });

    it("filters by stage", async () => {
      const result = await adapter.listPipeline({ stage: "prospect" });
      expect(result.structured_output.contacts.every((c) => c.stage === "prospect")).toBe(true);
    });

    it("filters by min_score", async () => {
      const result = await adapter.listPipeline({ min_score: 70 });
      expect(result.structured_output.contacts.every((c) => c.score >= 70)).toBe(true);
    });

    it("returns stage_counts in output", async () => {
      const result = await adapter.listPipeline({});
      const counts = result.structured_output.stage_counts;
      expect(typeof counts.prospect).toBe("number");
      expect(typeof counts.won).toBe("number");
      expect(typeof counts.meeting).toBe("number");
    });
  });

  describe("moveStage", () => {
    it("moves contact to new stage", async () => {
      const contacts = adapter.store.listContacts({ stage: "prospect" });
      const contact = contacts[0]!;
      const result = await adapter.moveStage({
        contact_id: contact.contact_id,
        new_stage: "qualified"
      });
      expect(result.structured_output.previous_stage).toBe("prospect");
      expect(result.structured_output.new_stage).toBe("qualified");
      const updated = adapter.store.getContact(contact.contact_id);
      expect(updated!.stage).toBe("qualified");
    });

    it("returns failed result for unknown contact_id in executeCrmJob", async () => {
      const envelope = makeEnvelope("crm.move_stage", {
        contact_id: "nonexistent-xyz",
        new_stage: "qualified"
      });
      const result = await executeCrmJob(envelope, adapter);
      expect(result.status).toBe("failed");
    });
  });

  describe("addNote", () => {
    it("adds a note to an existing contact", async () => {
      const contacts = adapter.store.listContacts();
      const contact = contacts[0]!;
      const result = await adapter.addNote({
        contact_id: contact.contact_id,
        content: "Discussed project scope",
        note_type: "call"
      });
      expect(result.structured_output.note.note_type).toBe("call");
      expect(result.structured_output.note.contact_id).toBe(contact.contact_id);
    });

    it("defaults note_type to general", async () => {
      const contacts = adapter.store.listContacts();
      const contact = contacts[0]!;
      const result = await adapter.addNote({
        contact_id: contact.contact_id,
        content: "General note"
      });
      expect(result.structured_output.note.note_type).toBe("general");
    });
  });

  describe("search", () => {
    it("finds contacts by name", async () => {
      const result = await adapter.search({ query: "Bianchi", fields: ["name"] });
      expect(result.structured_output.total_matches).toBeGreaterThan(0);
      expect(result.structured_output.contacts.some((c) => c.name === "Luca Bianchi")).toBe(true);
    });

    it("finds contacts by company", async () => {
      const result = await adapter.search({ query: "Meridian Engineering", fields: ["company"] });
      expect(result.structured_output.contacts.every((c) => c.company === "Meridian Engineering")).toBe(true);
    });

    it("returns empty array when no match", async () => {
      const result = await adapter.search({ query: "zzznomatchquery999" });
      expect(result.structured_output.total_matches).toBe(0);
      expect(result.structured_output.contacts).toHaveLength(0);
    });

    it("returns the query string in output", async () => {
      const result = await adapter.search({ query: "Nordic Auto" });
      expect(result.structured_output.query).toBe("Nordic Auto");
    });
  });

  describe("digest", () => {
    it("total_contacts counts non-parked contacts by default", async () => {
      const result = await adapter.digest({});
      expect(result.structured_output.total_contacts).toBe(5);
    });

    it("hot_leads includes contacts with score > 70 in meeting/proposal/negotiation stages", async () => {
      // Add a hot lead in meeting stage
      adapter.store.addContact({ name: "Hot Lead", company: "X", stage: "meeting", score: 85 });
      const result = await adapter.digest({});
      const hot = result.structured_output.hot_leads;
      expect(hot.every((c) => c.score > 70)).toBe(true);
      expect(hot.every((c) => ["meeting", "proposal", "negotiation"].includes(c.stage))).toBe(true);
    });

    it("stale_contacts includes contacts not touched within days_since_contact", async () => {
      // All seeded contacts have no last_contact_at — should be stale
      const result = await adapter.digest({ days_since_contact: 1 });
      expect(result.structured_output.stale_contacts.length).toBeGreaterThan(0);
    });

    it("stage_distribution covers all pipeline stages", async () => {
      const result = await adapter.digest({});
      const dist = result.structured_output.stage_distribution;
      expect(typeof dist.prospect).toBe("number");
      expect(typeof dist.qualified).toBe("number");
      expect(typeof dist.contacted).toBe("number");
      expect(typeof dist.meeting).toBe("number");
      expect(typeof dist.won).toBe("number");
    });

    it("digest_at is an ISO string", async () => {
      const result = await adapter.digest({});
      expect(typeof result.structured_output.digest_at).toBe("string");
      expect(() => new Date(result.structured_output.digest_at)).not.toThrow();
    });
  });
});

// ── executeCrmJob ─────────────────────────────────────────────────────────────

describe("executeCrmJob", () => {
  let adapter: MockCrmAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockCrmAdapter();
  });

  it("worker ID is crm-worker", () => {
    const worker = createCrmWorker({ adapter });
    expect(worker.workerId).toBe(CRM_WORKER_ID);
    expect(worker.workerId).toBe("crm-worker");
  });

  it("produces a completed JobResult for crm.add_contact with default stage prospect", async () => {
    const envelope = makeEnvelope("crm.add_contact", {
      name: "Martin Fischer",
      company: "Meridian Engineering"
    });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("crm.add_contact");
    const out = result.structured_output as Record<string, unknown>;
    const contact = out.contact as Record<string, unknown>;
    expect(contact.stage).toBe("prospect");
    expect(contact.name).toBe("Martin Fischer");
  });

  it("produces a completed JobResult for crm.add_contact with custom stage", async () => {
    const envelope = makeEnvelope("crm.add_contact", {
      name: "Senior Lead",
      company: "Corp",
      stage: "meeting"
    });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const contact = out.contact as Record<string, unknown>;
    expect(contact.stage).toBe("meeting");
  });

  it("produces a completed JobResult for crm.update_contact", async () => {
    const contacts = adapter.store.listContacts();
    const contact = contacts[0]!;
    const envelope = makeEnvelope("crm.update_contact", {
      contact_id: contact.contact_id,
      score: 88
    });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const updatedContact = out.contact as Record<string, unknown>;
    expect(updatedContact.score).toBe(88);
    const changesApplied = out.changes_applied as string[];
    expect(changesApplied).toContain("score");
  });

  it("returns failed for crm.update_contact with unknown contact_id", async () => {
    const envelope = makeEnvelope("crm.update_contact", {
      contact_id: "nonexistent-id",
      score: 50
    });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("CONTACT_NOT_FOUND");
  });

  it("produces a completed JobResult for crm.list_pipeline (all)", async () => {
    const envelope = makeEnvelope("crm.list_pipeline", {});
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.contacts)).toBe(true);
    expect(typeof out.total_count).toBe("number");
  });

  it("produces a completed JobResult for crm.list_pipeline filtered by stage", async () => {
    const envelope = makeEnvelope("crm.list_pipeline", { stage: "prospect" });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const contacts = out.contacts as Array<Record<string, unknown>>;
    expect(contacts.every((c) => c.stage === "prospect")).toBe(true);
  });

  it("produces a completed JobResult for crm.list_pipeline filtered by min_score", async () => {
    const envelope = makeEnvelope("crm.list_pipeline", { min_score: 70 });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const contacts = out.contacts as Array<Record<string, unknown>>;
    expect(contacts.every((c) => (c.score as number) >= 70)).toBe(true);
  });

  it("produces a completed JobResult for crm.move_stage", async () => {
    const contacts = adapter.store.listContacts({ stage: "prospect" });
    const contact = contacts[0]!;
    const envelope = makeEnvelope("crm.move_stage", {
      contact_id: contact.contact_id,
      new_stage: "qualified"
    });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.previous_stage).toBe("prospect");
    expect(out.new_stage).toBe("qualified");
    expect(typeof out.moved_at).toBe("string");
  });

  it("returns failed for crm.move_stage with unknown contact_id", async () => {
    const envelope = makeEnvelope("crm.move_stage", {
      contact_id: "nonexistent-xyz",
      new_stage: "qualified"
    });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("failed");
  });

  it("produces a completed JobResult for crm.add_note", async () => {
    const contacts = adapter.store.listContacts();
    const contact = contacts[0]!;
    const envelope = makeEnvelope("crm.add_note", {
      contact_id: contact.contact_id,
      content: "Good conversation",
      note_type: "call"
    });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const note = out.note as Record<string, unknown>;
    expect(note.note_type).toBe("call");
  });

  it("produces a completed JobResult for crm.search finding by name", async () => {
    const envelope = makeEnvelope("crm.search", { query: "Bianchi" });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect((out.total_matches as number)).toBeGreaterThan(0);
    expect(out.query).toBe("Bianchi");
  });

  it("produces a completed JobResult for crm.search returning empty", async () => {
    const envelope = makeEnvelope("crm.search", { query: "zzznomatchquery999" });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.total_matches).toBe(0);
  });

  it("produces a completed JobResult for crm.digest", async () => {
    const envelope = makeEnvelope("crm.digest", { days_since_contact: 7 });
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.total_contacts).toBe("number");
    expect(Array.isArray(out.hot_leads)).toBe(true);
    expect(Array.isArray(out.stale_contacts)).toBe(true);
    expect(typeof out.digest_at).toBe("string");
  });

  it("digest hot_leads includes contacts with score > 70 in late stages", async () => {
    // Add a contact with high score in negotiation
    adapter.store.addContact({ name: "Hot", company: "Deal", stage: "negotiation", score: 85 });
    const envelope = makeEnvelope("crm.digest", {});
    const result = await executeCrmJob(envelope, adapter);
    const out = result.structured_output as Record<string, unknown>;
    const hotLeads = out.hot_leads as Array<Record<string, unknown>>;
    const hotEntry = hotLeads.find((c) => c.name === "Hot");
    expect(hotEntry).toBeDefined();
  });

  it("stage_counts reflect actual distribution", async () => {
    const envelope = makeEnvelope("crm.list_pipeline", {});
    const result = await executeCrmJob(envelope, adapter);
    const out = result.structured_output as Record<string, unknown>;
    const stageCounts = out.stage_counts as Record<string, number>;
    const contacts = out.contacts as Array<Record<string, unknown>>;
    const total = Object.values(stageCounts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(contacts.length);
  });

  it("move stage updates stage history", async () => {
    const contacts = adapter.store.listContacts({ stage: "prospect" });
    const contact = contacts[0]!;
    await executeCrmJob(
      makeEnvelope("crm.move_stage", {
        contact_id: contact.contact_id,
        new_stage: "qualified"
      }),
      adapter
    );
    const history = adapter.store.getRecentMovements();
    expect(history.length).toBeGreaterThan(0);
    const movement = history.find((m) => m.contact_id === contact.contact_id);
    expect(movement).toBeDefined();
    expect(movement!.from).toBe("prospect");
    expect(movement!.to).toBe("qualified");
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("device.snapshot", {});
    const result = await executeCrmJob(envelope, adapter);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.retryable).toBe(false);
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("crm.list_pipeline", {});
    const result = await executeCrmJob(envelope, adapter, { workerId: "custom-crm-worker" });
    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("custom-crm-worker");
  });

  it("metrics include worker_id and timestamps", async () => {
    const envelope = makeEnvelope("crm.list_pipeline", {});
    const result = await executeCrmJob(envelope, adapter);
    expect(result.metrics?.worker_id).toBe("crm-worker");
    expect(result.metrics?.started_at).toBeTruthy();
    expect(result.metrics?.finished_at).toBeTruthy();
  });
});

// ── createCrmWorker ───────────────────────────────────────────────────────────

describe("createCrmWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId of crm-worker", () => {
    const worker = createCrmWorker({ adapter: createMockCrmAdapter() });
    expect(worker.workerId).toBe("crm-worker");
  });

  it("uses the provided workerId", () => {
    const worker = createCrmWorker({
      adapter: createMockCrmAdapter(),
      workerId: "my-crm-worker"
    });
    expect(worker.workerId).toBe("my-crm-worker");
  });

  it("executes a job via the worker facade", async () => {
    const worker = createCrmWorker({ adapter: createMockCrmAdapter() });
    const envelope = makeEnvelope("crm.list_pipeline", {});
    const result = await worker.execute(envelope);
    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("crm-worker");
  });
});
