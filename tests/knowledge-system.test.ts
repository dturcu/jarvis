import { describe, expect, it, beforeEach } from "vitest";
import {
  KnowledgeStore,
  type KnowledgeDocument,
  type KnowledgeCollection,
} from "../packages/jarvis-agent-framework/src/knowledge.ts";
import {
  EntityGraph,
  type GraphEntity,
  type EntityType,
} from "../packages/jarvis-agent-framework/src/entity-graph.ts";
import {
  LessonCapture,
} from "../packages/jarvis-agent-framework/src/lesson-capture.ts";
import { AgentMemoryStore } from "../packages/jarvis-agent-framework/src/memory.ts";
import { AgentRuntime, type AgentRun } from "../packages/jarvis-agent-framework/src/runtime.ts";
import { bdPipelineAgent } from "../packages/jarvis-agents/src/definitions/bd-pipeline.ts";

// ─── KnowledgeStore ───────────────────────────────────────────────────────────

describe("KnowledgeStore", () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    store = new KnowledgeStore();
  });

  it("is pre-seeded with documents across multiple collections", () => {
    const stats = store.getStats();
    expect(stats.document_count).toBeGreaterThan(0);
    expect(stats.playbook_count).toBeGreaterThan(0);
    expect(stats.collections["lessons"]).toBeGreaterThan(0);
    expect(stats.collections["iso26262"]).toBeGreaterThan(0);
    expect(stats.collections["garden"]).toBeGreaterThan(0);
  });

  it("adds a document and retrieves it", () => {
    const doc = store.addDocument({
      collection: "lessons",
      title: "Test lesson",
      content: "This is a test lesson body.",
      tags: ["test"],
      source_agent_id: "bd-pipeline",
    });

    expect(doc.doc_id).toBeTruthy();
    expect(doc.created_at).toBeTruthy();
    expect(doc.updated_at).toBeTruthy();

    const found = store.getDocument(doc.doc_id);
    expect(found).toBeDefined();
    expect(found?.title).toBe("Test lesson");
  });

  it("lists all documents in a collection", () => {
    store.addDocument({ collection: "proposals", title: "Proposal A", content: "body", tags: [] });
    store.addDocument({ collection: "proposals", title: "Proposal B", content: "body", tags: [] });

    const proposals = store.listCollection("proposals");
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals.every(d => d.collection === "proposals")).toBe(true);
  });

  it("updates a document content and timestamp", () => {
    const doc = store.addDocument({ collection: "lessons", title: "Old title", content: "old", tags: [] });
    const updated = store.updateDocument(doc.doc_id, { content: "updated content", title: "New title" });
    expect(updated.title).toBe("New title");
    expect(updated.content).toBe("updated content");
    expect(updated.updated_at >= doc.updated_at).toBe(true);
  });

  it("throws when updating a non-existent document", () => {
    expect(() => store.updateDocument("nonexistent-id", { content: "x" })).toThrow();
  });

  it("deletes a document", () => {
    const doc = store.addDocument({ collection: "lessons", title: "To delete", content: "x", tags: [] });
    expect(store.deleteDocument(doc.doc_id)).toBe(true);
    expect(store.getDocument(doc.doc_id)).toBeUndefined();
    expect(store.deleteDocument(doc.doc_id)).toBe(false);
  });

  it("searches documents by keyword and returns scored results", () => {
    store.addDocument({ collection: "lessons", title: "AUTOSAR migration lesson", content: "Classic to Adaptive migration involves service-oriented architecture.", tags: ["autosar"] });
    store.addDocument({ collection: "lessons", title: "ISO 26262 gap analysis", content: "SWE.1 gaps are common blockers.", tags: ["iso26262"] });

    const results = store.search("AUTOSAR migration");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.doc.title).toContain("AUTOSAR");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("search respects collection filter", () => {
    store.addDocument({ collection: "proposals", title: "AUTOSAR proposal draft", content: "AUTOSAR migration scope.", tags: [] });

    const all = store.search("AUTOSAR");
    const filtered = store.search("AUTOSAR", { collection: "lessons" });

    // Filtered results should only contain lessons-collection docs
    expect(filtered.every(r => r.collection === "lessons" || r.doc.collection === "lessons")).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });

  it("search respects limit parameter", () => {
    for (let i = 0; i < 20; i++) {
      store.addDocument({ collection: "lessons", title: `AUTOSAR lesson ${i}`, content: "AUTOSAR", tags: [] });
    }
    const results = store.search("AUTOSAR", { limit: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("search returns results sorted by score descending", () => {
    const results = store.search("iso26262 ASIL requirements");
    if (results.length >= 2) {
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    }
  });

  it("adds and retrieves a playbook entry", () => {
    const pb = store.addPlaybook({
      title: "Test playbook",
      category: "delivery",
      body: "Always review gate criteria before commit.",
      tags: ["delivery", "gate"],
    });
    expect(pb.playbook_id).toBeTruthy();
    expect(pb.use_count).toBe(0);

    const found = store.getPlaybook(pb.playbook_id);
    expect(found?.title).toBe("Test playbook");
  });

  it("touchPlaybook increments use_count and sets last_used_at", () => {
    const pb = store.addPlaybook({ title: "Use me", category: "sales", body: "body", tags: [] });
    const touched = store.touchPlaybook(pb.playbook_id);
    expect(touched.use_count).toBe(1);
    expect(touched.last_used_at).toBeTruthy();
  });

  it("lists playbooks filtered by category", () => {
    store.addPlaybook({ title: "Delivery A", category: "delivery", body: "b", tags: [] });
    store.addPlaybook({ title: "Sales A", category: "sales", body: "b", tags: [] });

    const delivery = store.listPlaybooks("delivery");
    expect(delivery.every(p => p.category === "delivery")).toBe(true);
  });
});

// ─── EntityGraph ──────────────────────────────────────────────────────────────

describe("EntityGraph", () => {
  let graph: EntityGraph;

  beforeEach(() => {
    graph = new EntityGraph();
  });

  it("starts empty", () => {
    const stats = graph.getStats();
    expect(stats.entity_count).toBe(0);
    expect(stats.relation_count).toBe(0);
  });

  it("upserts a new entity and retrieves it", () => {
    const entity = graph.upsertEntity(
      { entity_type: "company", name: "Volvo Cars", attributes: { industry: "automotive" } },
      "bd-pipeline"
    );
    expect(entity.entity_id).toBeTruthy();
    expect(entity.seen_by).toContain("bd-pipeline");

    const found = graph.getEntity(entity.entity_id);
    expect(found?.name).toBe("Volvo Cars");
  });

  it("merges attributes when upserting the same entity by name+type", () => {
    graph.upsertEntity({ entity_type: "company", name: "Volvo Cars", attributes: { industry: "automotive" } }, "bd-pipeline");
    const updated = graph.upsertEntity({ entity_type: "company", name: "Volvo Cars", attributes: { revenue: "€20B" } }, "proposal-engine");

    expect(updated.attributes["industry"]).toBe("automotive");
    expect(updated.attributes["revenue"]).toBe("€20B");
    expect(updated.seen_by).toContain("bd-pipeline");
    expect(updated.seen_by).toContain("proposal-engine");
    expect(graph.getStats().entity_count).toBe(1); // No duplicate
  });

  it("deduplicates via canonical_key", () => {
    graph.upsertEntity({ entity_type: "contact", name: "Anna L", canonical_key: "anna@volvo.com", attributes: {} }, "bd-pipeline");
    const deduped = graph.upsertEntity({ entity_type: "contact", name: "Anna Lindstrom", canonical_key: "anna@volvo.com", attributes: { role: "Safety Lead" } }, "evidence-auditor");

    expect(graph.getStats().entity_count).toBe(1);
    expect(deduped.seen_by).toContain("bd-pipeline");
    expect(deduped.seen_by).toContain("evidence-auditor");
    expect(deduped.attributes["role"]).toBe("Safety Lead");
  });

  it("findByCanonicalKey returns the correct entity", () => {
    graph.upsertEntity({ entity_type: "contact", name: "Anna", canonical_key: "anna@volvo.com", attributes: {} }, "bd-pipeline");
    const found = graph.findByCanonicalKey("anna@volvo.com");
    expect(found?.name).toBe("Anna");
  });

  it("findByName returns partial matches", () => {
    graph.upsertEntity({ entity_type: "company", name: "Volvo Cars AB", attributes: {} }, "bd-pipeline");
    graph.upsertEntity({ entity_type: "company", name: "Volvo Trucks AB", attributes: {} }, "bd-pipeline");
    graph.upsertEntity({ entity_type: "company", name: "BMW Group", attributes: {} }, "bd-pipeline");

    const volvoResults = graph.findByName("Volvo");
    expect(volvoResults.length).toBe(2);

    const typedResults = graph.findByName("Volvo", "company");
    expect(typedResults.length).toBe(2);

    const contactResults = graph.findByName("Volvo", "contact");
    expect(contactResults.length).toBe(0);
  });

  it("adds a relation and retrieves it", () => {
    const contact = graph.upsertEntity({ entity_type: "contact", name: "Anna", attributes: {} }, "bd-pipeline");
    const company = graph.upsertEntity({ entity_type: "company", name: "Volvo", attributes: {} }, "bd-pipeline");

    const rel = graph.addRelation(contact.entity_id, company.entity_id, "works_at");
    expect(rel.relation_id).toBeTruthy();
    expect(rel.kind).toBe("works_at");
  });

  it("deduplicates relations with same from+to+kind", () => {
    const a = graph.upsertEntity({ entity_type: "contact", name: "A", attributes: {} }, "x");
    const b = graph.upsertEntity({ entity_type: "company", name: "B", attributes: {} }, "x");

    graph.addRelation(a.entity_id, b.entity_id, "works_at");
    graph.addRelation(a.entity_id, b.entity_id, "works_at");

    expect(graph.getStats().relation_count).toBe(1);
  });

  it("getRelations filters by direction", () => {
    const a = graph.upsertEntity({ entity_type: "contact", name: "A", attributes: {} }, "x");
    const b = graph.upsertEntity({ entity_type: "company", name: "B", attributes: {} }, "x");
    const c = graph.upsertEntity({ entity_type: "project", name: "C", attributes: {} }, "x");

    graph.addRelation(a.entity_id, b.entity_id, "works_at");
    graph.addRelation(c.entity_id, a.entity_id, "references");

    expect(graph.getRelations(a.entity_id, "from").length).toBe(1);
    expect(graph.getRelations(a.entity_id, "to").length).toBe(1);
    expect(graph.getRelations(a.entity_id, "both").length).toBe(2);
  });

  it("neighborhood returns center + neighbors + relations", () => {
    const anna = graph.upsertEntity({ entity_type: "contact", name: "Anna", attributes: {} }, "x");
    const volvo = graph.upsertEntity({ entity_type: "company", name: "Volvo", attributes: {} }, "x");
    const project = graph.upsertEntity({ entity_type: "project", name: "ASIL-D Analysis", attributes: {} }, "x");

    graph.addRelation(anna.entity_id, volvo.entity_id, "works_at");
    graph.addRelation(anna.entity_id, project.entity_id, "leads");

    const nb = graph.neighborhood(anna.entity_id);
    expect(nb.center?.name).toBe("Anna");
    expect(nb.neighbors.length).toBe(2);
    expect(nb.relations.length).toBe(2);
  });

  it("entitiesSeenBy filters correctly", () => {
    graph.upsertEntity({ entity_type: "company", name: "Volvo", attributes: {} }, "bd-pipeline");
    graph.upsertEntity({ entity_type: "company", name: "Garrett", attributes: {} }, "proposal-engine");
    graph.upsertEntity({ entity_type: "company", name: "Continental", attributes: {} }, "bd-pipeline");

    const bdEntities = graph.entitiesSeenBy("bd-pipeline");
    expect(bdEntities.length).toBe(2);
    expect(bdEntities.every(e => e.seen_by.includes("bd-pipeline"))).toBe(true);
  });

  it("getStats reports by_type breakdown", () => {
    graph.upsertEntity({ entity_type: "company", name: "Co1", attributes: {} }, "x");
    graph.upsertEntity({ entity_type: "company", name: "Co2", attributes: {} }, "x");
    graph.upsertEntity({ entity_type: "contact", name: "P1", attributes: {} }, "x");

    const stats = graph.getStats();
    expect(stats.by_type["company"]).toBe(2);
    expect(stats.by_type["contact"]).toBe(1);
  });
});

// ─── LessonCapture ────────────────────────────────────────────────────────────

describe("LessonCapture", () => {
  let store: KnowledgeStore;
  let capture: LessonCapture;
  let memory: AgentMemoryStore;
  let runtime: AgentRuntime;

  beforeEach(() => {
    store = new KnowledgeStore();
    capture = new LessonCapture(store);
    memory = new AgentMemoryStore();
    runtime = new AgentRuntime(memory);
    runtime.registerAgent(bdPipelineAgent);
  });

  function makeCompletedRun(overrides: Partial<AgentRun> = {}): AgentRun {
    return {
      run_id: "run-001",
      agent_id: "bd-pipeline",
      trigger: { kind: "manual" },
      goal: "Scan for BD signals",
      status: "completed",
      current_step: 3,
      total_steps: 10,
      started_at: "2026-04-04T08:00:00.000Z",
      updated_at: "2026-04-04T08:05:00.000Z",
      completed_at: "2026-04-04T08:05:00.000Z",
      ...overrides,
    };
  }

  it("returns empty array for non-terminal run", () => {
    const run = makeCompletedRun({ status: "executing" });
    const lessons = capture.captureFromRun(run, []);
    expect(lessons).toHaveLength(0);
  });

  it("captures a run-completion lesson for completed runs", () => {
    const countBefore = store.getStats().document_count;
    const run = makeCompletedRun();
    const lessons = capture.captureFromRun(run, []);

    expect(lessons.length).toBeGreaterThanOrEqual(1);
    expect(store.getStats().document_count).toBeGreaterThan(countBefore);
    expect(lessons[0]!.severity).toBe("observation");
    expect(lessons[0]!.collection).toBe("lessons"); // bd-pipeline maps to lessons
  });

  it("captures a critical failure lesson for failed runs", () => {
    const run = makeCompletedRun({ status: "failed", error: "CRM unreachable" });
    const lessons = capture.captureFromRun(run, []);

    expect(lessons.some(l => l.severity === "critical")).toBe(true);
    expect(lessons.some(l => l.title.includes("failed"))).toBe(true);
  });

  it("captures per-step lessons from decision log", () => {
    const run = makeCompletedRun({ current_step: 2 });
    const decisions = [
      {
        decision_id: "d1",
        agent_id: "bd-pipeline",
        run_id: "run-001",
        step: 1,
        action: "crm.list_pipeline",
        reasoning: "Need current pipeline state",
        outcome: "Retrieved 5 contacts",
        created_at: "2026-04-04T08:01:00.000Z",
      },
      {
        decision_id: "d2",
        agent_id: "bd-pipeline",
        run_id: "run-001",
        step: 2,
        action: "email.draft",
        reasoning: "Draft outreach for top 3 leads",
        outcome: "error: template not found",
        created_at: "2026-04-04T08:02:00.000Z",
      },
    ];

    const lessons = capture.captureFromRun(run, decisions);
    expect(lessons.length).toBeGreaterThanOrEqual(3); // run summary + 2 step lessons

    const errorLesson = lessons.find(l => l.title.includes("email.draft"));
    expect(errorLesson?.severity).toBe("recommendation");
  });

  it("persists all lessons to the knowledge store", () => {
    const countBefore = store.getStats().document_count;
    const run = makeCompletedRun();
    const decisions = [
      {
        decision_id: "d1",
        agent_id: "bd-pipeline",
        run_id: "run-001",
        step: 1,
        action: "web.search_news",
        reasoning: "Scan for signals",
        outcome: "Found 3 new RFQ signals",
        created_at: "2026-04-04T08:01:00.000Z",
      },
    ];
    capture.captureFromRun(run, decisions);
    expect(store.getStats().document_count).toBeGreaterThan(countBefore);
  });

  it("captureCasestudy adds a case-studies document", () => {
    capture.captureCasestudy({
      agent_id: "evidence-auditor",
      run_id: "run-002",
      client: "Volvo Cars",
      scope: "ASIL-D HARA + FSC",
      outcome: "Gate review passed",
      key_challenges: ["Late requirement changes", "Cross-domain ASIL conflicts"],
      collection: "case-studies",
    });

    const casestudies = store.listCollection("case-studies");
    expect(casestudies.length).toBeGreaterThan(0);
    const doc = casestudies.find(d => d.title.startsWith("Case study: Volvo Cars"));
    expect(doc).toBeDefined();
    expect(doc?.content).toContain("Late requirement changes");
    expect(doc?.tags).toContain("volvo-cars");
  });

  it("captureManual persists a lesson without a full run", () => {
    const countBefore = store.getStats().document_count;
    capture.captureManual({
      agent_id: "proposal-engine",
      run_id: "run-003",
      title: "Ad-hoc insight: always include exclusions",
      body: "Three proposals renegotiated due to missing exclusion scope.",
      severity: "recommendation",
      tags: ["proposal", "scope"],
    });
    expect(store.getStats().document_count).toBe(countBefore + 1);
    const found = store.search("always include exclusions");
    expect(found.length).toBeGreaterThan(0);
  });

  it("routes evidence-auditor lessons to iso26262 collection", () => {
    const run: AgentRun = {
      run_id: "run-audit",
      agent_id: "evidence-auditor",
      trigger: { kind: "manual" },
      goal: "Audit project",
      status: "completed",
      current_step: 2,
      total_steps: 5,
      started_at: "2026-04-04T09:00:00.000Z",
      updated_at: "2026-04-04T09:10:00.000Z",
      completed_at: "2026-04-04T09:10:00.000Z",
    };
    const lessons = capture.captureFromRun(run, []);
    expect(lessons.every(l => l.collection === "iso26262")).toBe(true);
  });

  it("routes garden-calendar lessons to garden collection", () => {
    const run: AgentRun = {
      run_id: "run-garden",
      agent_id: "garden-calendar",
      trigger: { kind: "manual" },
      goal: "Generate garden brief",
      status: "completed",
      current_step: 3,
      total_steps: 5,
      started_at: "2026-04-04T07:00:00.000Z",
      updated_at: "2026-04-04T07:05:00.000Z",
      completed_at: "2026-04-04T07:05:00.000Z",
    };
    const lessons = capture.captureFromRun(run, []);
    expect(lessons.every(l => l.collection === "garden")).toBe(true);
  });
});
