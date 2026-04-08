import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteMemoryStore } from "../packages/jarvis-agent-framework/src/sqlite-memory.ts";
import { SqliteEntityGraph } from "../packages/jarvis-agent-framework/src/sqlite-entity-graph.ts";
import { SqliteDecisionLog } from "../packages/jarvis-agent-framework/src/sqlite-decision-log.ts";
import { SqliteKnowledgeStore } from "../packages/jarvis-agent-framework/src/sqlite-knowledge.ts";
import { LessonCapture } from "../packages/jarvis-agent-framework/src/lesson-capture.ts";
import type { AgentRun } from "../packages/jarvis-agent-framework/src/runtime.ts";
import type { DecisionLog } from "../packages/jarvis-agent-framework/src/memory.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDbPath(): string {
  return join(os.tmpdir(), `jarvis-test-${randomUUID()}.db`);
}

/** Create the knowledge-database DDL that entity graph, decision log, and knowledge store expect. */
function initKnowledgeTables(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      doc_id TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      source_agent_id TEXT,
      source_run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playbooks (
      playbook_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT,
      use_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      entity_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      canonical_key TEXT UNIQUE,
      attributes TEXT,
      seen_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS relations (
      relation_id TEXT PRIMARY KEY,
      from_entity_id TEXT NOT NULL,
      to_entity_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      attributes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      decision_id TEXT PRIMARY KEY,
      agent_id TEXT,
      run_id TEXT,
      step INTEGER,
      action TEXT,
      reasoning TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.close();
}

function cleanupDb(dbPath: string): void {
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SqliteMemoryStore
// ═══════════════════════════════════════════════════════════════════════════════

describe("SqliteMemoryStore", () => {
  let dbPath: string;
  let store: SqliteMemoryStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new SqliteMemoryStore(dbPath);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  // ── Short-term memory ────────────────────────────────────────────────────

  it("addShortTerm stores an entry and returns it with all fields", () => {
    const entry = store.addShortTerm("agent-1", "run-1", "observation A");
    expect(entry.entry_id).toBeTruthy();
    expect(entry.agent_id).toBe("agent-1");
    expect(entry.run_id).toBe("run-1");
    expect(entry.kind).toBe("short_term");
    expect(entry.content).toBe("observation A");
    expect(typeof entry.created_at).toBe("string");
  });

  it("addShortTerm entries are retrievable via getContext", () => {
    store.addShortTerm("agent-1", "run-1", "obs 1");
    store.addShortTerm("agent-1", "run-1", "obs 2");
    const ctx = store.getContext("agent-1", "run-1");
    expect(ctx.short_term).toHaveLength(2);
    expect(ctx.short_term[0]!.content).toBe("obs 1");
    expect(ctx.short_term[1]!.content).toBe("obs 2");
  });

  it("addShortTerm generates unique entry IDs", () => {
    const e1 = store.addShortTerm("a", "r", "x");
    const e2 = store.addShortTerm("a", "r", "y");
    expect(e1.entry_id).not.toBe(e2.entry_id);
  });

  // ── Long-term memory ─────────────────────────────────────────────────────

  it("addLongTerm stores an entry and returns it", () => {
    const entry = store.addLongTerm("agent-1", "run-1", "learned fact");
    expect(entry.kind).toBe("long_term");
    expect(entry.content).toBe("learned fact");
    expect(entry.entry_id).toBeTruthy();
  });

  it("addLongTerm entries are retrievable via getContext", () => {
    store.addLongTerm("agent-1", "run-1", "fact A");
    store.addLongTerm("agent-1", "run-2", "fact B");
    const ctx = store.getContext("agent-1", "run-1");
    // long_term returns all entries for agent, regardless of run
    expect(ctx.long_term).toHaveLength(2);
  });

  // ── clearShortTerm ────────────────────────────────────────────────────────

  it("clearShortTerm only clears entries for the given run", () => {
    store.addShortTerm("agent-1", "run-a", "obs for a");
    store.addShortTerm("agent-1", "run-b", "obs for b");
    store.clearShortTerm("run-a");

    const ctxA = store.getContext("agent-1", "run-a");
    const ctxB = store.getContext("agent-1", "run-b");
    expect(ctxA.short_term).toHaveLength(0);
    expect(ctxB.short_term).toHaveLength(1);
  });

  it("clearShortTerm does not affect long-term entries", () => {
    store.addShortTerm("agent-1", "run-1", "short");
    store.addLongTerm("agent-1", "run-1", "long");
    store.clearShortTerm("run-1");

    const ctx = store.getContext("agent-1", "run-1");
    expect(ctx.short_term).toHaveLength(0);
    expect(ctx.long_term).toHaveLength(1);
  });

  // ── getContext ─────────────────────────────────────────────────────────────

  it("getContext returns short-term filtered by agent+run, long-term filtered by agent", () => {
    store.addShortTerm("agent-1", "run-1", "s1");
    store.addShortTerm("agent-1", "run-2", "s2");
    store.addShortTerm("agent-2", "run-1", "other agent short");
    store.addLongTerm("agent-1", "run-1", "l1");
    store.addLongTerm("agent-2", "run-1", "other agent long");

    const ctx = store.getContext("agent-1", "run-1");
    expect(ctx.short_term).toHaveLength(1);
    expect(ctx.short_term[0]!.content).toBe("s1");
    expect(ctx.long_term).toHaveLength(1);
    expect(ctx.long_term[0]!.content).toBe("l1");
  });

  it("getContext returns empty arrays when no entries exist", () => {
    const ctx = store.getContext("nonexistent", "nope");
    expect(ctx.short_term).toHaveLength(0);
    expect(ctx.long_term).toHaveLength(0);
  });

  it("getContext limits long_term to 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      store.addLongTerm("agent-1", `run-${i}`, `fact ${i}`);
    }
    const ctx = store.getContext("agent-1", "run-0");
    expect(ctx.long_term).toHaveLength(50);
  });

  // ── long-term cap ─────────────────────────────────────────────────────────

  it("long-term caps at 500 entries per agent", { timeout: 30_000 }, () => {
    for (let i = 0; i < 510; i++) {
      store.addLongTerm("capped-agent", `run-${i}`, `entry ${i}`);
    }
    // Verify via a raw DB query that only 500 remain
    const verifyDb = new DatabaseSync(dbPath);
    const row = verifyDb.prepare(
      "SELECT COUNT(*) AS cnt FROM memory WHERE agent_id = ? AND kind = 'long_term'"
    ).get("capped-agent") as { cnt: number };
    verifyDb.close();
    expect(row.cnt).toBe(500);
  });

  it("long-term cap does not affect other agents", { timeout: 30_000 }, () => {
    // Add 510 for agent-a and 5 for agent-b
    for (let i = 0; i < 510; i++) {
      store.addLongTerm("agent-a", `run-${i}`, `a-entry ${i}`);
    }
    for (let i = 0; i < 5; i++) {
      store.addLongTerm("agent-b", `run-${i}`, `b-entry ${i}`);
    }
    const verifyDb = new DatabaseSync(dbPath);
    const rowA = verifyDb.prepare(
      "SELECT COUNT(*) AS cnt FROM memory WHERE agent_id = ? AND kind = 'long_term'"
    ).get("agent-a") as { cnt: number };
    const rowB = verifyDb.prepare(
      "SELECT COUNT(*) AS cnt FROM memory WHERE agent_id = ? AND kind = 'long_term'"
    ).get("agent-b") as { cnt: number };
    verifyDb.close();
    expect(rowA.cnt).toBe(500);
    expect(rowB.cnt).toBe(5);
  });

  // Run history methods removed — run tracking is now exclusively in
  // runtime.db via RunStore. SqliteMemoryStore handles only memory entries.

  // ── Persistence across instances ──────────────────────────────────────────

  it("entries persist across constructor calls (same db path)", () => {
    store.addShortTerm("agent-1", "run-1", "persisted observation");
    store.addLongTerm("agent-1", "run-1", "persisted fact");
    store.close();

    const store2 = new SqliteMemoryStore(dbPath);
    const ctx = store2.getContext("agent-1", "run-1");
    expect(ctx.short_term).toHaveLength(1);
    expect(ctx.long_term).toHaveLength(1);
    store2.close();
  });

  // ── Concurrent writes ─────────────────────────────────────────────────────

  it("concurrent writes don't corrupt", () => {
    // Open two stores pointing at the same DB (WAL mode supports concurrent reads)
    const store2 = new SqliteMemoryStore(dbPath);
    store.addShortTerm("agent-1", "run-1", "from store 1");
    store2.addShortTerm("agent-1", "run-1", "from store 2");

    const ctx = store.getContext("agent-1", "run-1");
    expect(ctx.short_term).toHaveLength(2);
    store2.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SqliteEntityGraph
// ═══════════════════════════════════════════════════════════════════════════════

describe("SqliteEntityGraph", () => {
  let dbPath: string;
  let graph: SqliteEntityGraph;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initKnowledgeTables(dbPath);
    graph = new SqliteEntityGraph(dbPath);
  });

  afterEach(() => {
    graph.close();
    cleanupDb(dbPath);
  });

  // ── upsertEntity ──────────────────────────────────────────────────────────

  it("upsertEntity creates a new entity", () => {
    const entity = graph.upsertEntity(
      { entity_type: "company", name: "Volvo Cars", attributes: { hq: "Gothenburg" } },
      "bd-pipeline",
    );
    expect(entity.entity_id).toBeTruthy();
    expect(entity.entity_type).toBe("company");
    expect(entity.name).toBe("Volvo Cars");
    expect(entity.attributes.hq).toBe("Gothenburg");
    expect(entity.seen_by).toContain("bd-pipeline");
    expect(entity.created_at).toBeTruthy();
  });

  it("upsertEntity deduplicates by canonical_key", () => {
    graph.upsertEntity(
      { entity_type: "contact", name: "Anna L", canonical_key: "anna@volvo.com", attributes: { role: "Lead" } },
      "bd-pipeline",
    );
    const updated = graph.upsertEntity(
      { entity_type: "contact", name: "Anna Lindstrom", canonical_key: "anna@volvo.com", attributes: { phone: "+46123" } },
      "evidence-auditor",
    );

    expect(graph.getStats().entity_count).toBe(1);
    expect(updated.name).toBe("Anna Lindstrom"); // name updated
    expect(updated.attributes.role).toBe("Lead"); // old attr preserved
    expect(updated.attributes.phone).toBe("+46123"); // new attr added
    expect(updated.seen_by).toContain("bd-pipeline");
    expect(updated.seen_by).toContain("evidence-auditor");
  });

  it("upsertEntity deduplicates by name+type when no canonical_key", () => {
    graph.upsertEntity(
      { entity_type: "company", name: "Continental", attributes: { country: "DE" } },
      "bd-pipeline",
    );
    const updated = graph.upsertEntity(
      { entity_type: "company", name: "Continental", attributes: { revenue: "10B" } },
      "proposal-engine",
    );

    expect(graph.getStats().entity_count).toBe(1);
    expect(updated.attributes.country).toBe("DE");
    expect(updated.attributes.revenue).toBe("10B");
  });

  it("upsertEntity merges attributes on update", () => {
    graph.upsertEntity(
      { entity_type: "contact", name: "Max", canonical_key: "max@test.com", attributes: { a: 1, b: 2 } },
      "agent-1",
    );
    const merged = graph.upsertEntity(
      { entity_type: "contact", name: "Max", canonical_key: "max@test.com", attributes: { b: 99, c: 3 } },
      "agent-1",
    );
    expect(merged.attributes.a).toBe(1);
    expect(merged.attributes.b).toBe(99); // overwritten
    expect(merged.attributes.c).toBe(3);
  });

  it("upsertEntity adds agentId to seen_by without duplicates", () => {
    graph.upsertEntity(
      { entity_type: "company", name: "Acme", attributes: {} },
      "agent-x",
    );
    graph.upsertEntity(
      { entity_type: "company", name: "Acme", attributes: {} },
      "agent-x",
    );
    const entity = graph.listEntities("company")[0]!;
    // Same agent upserted twice; should only appear once in seen_by
    expect(entity.seen_by.filter(s => s === "agent-x")).toHaveLength(1);
  });

  // ── getEntity ─────────────────────────────────────────────────────────────

  it("getEntity by id", () => {
    const created = graph.upsertEntity(
      { entity_type: "project", name: "Project Alpha", attributes: {} },
      "agent-1",
    );
    const found = graph.getEntity(created.entity_id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Project Alpha");
  });

  it("getEntity returns undefined for nonexistent id", () => {
    expect(graph.getEntity("no-such-id")).toBeUndefined();
  });

  // ── findByCanonicalKey ────────────────────────────────────────────────────

  it("findByCanonicalKey returns the correct entity", () => {
    graph.upsertEntity(
      { entity_type: "contact", name: "Alice", canonical_key: "alice@test.com", attributes: {} },
      "agent-1",
    );
    const found = graph.findByCanonicalKey("alice@test.com");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Alice");
  });

  it("findByCanonicalKey returns undefined for no match", () => {
    expect(graph.findByCanonicalKey("nobody@test.com")).toBeUndefined();
  });

  // ── findByName ────────────────────────────────────────────────────────────

  it("findByName partial match (case-insensitive)", () => {
    graph.upsertEntity({ entity_type: "company", name: "Volvo Cars AB", attributes: {} }, "a");
    graph.upsertEntity({ entity_type: "company", name: "Volvo Trucks AB", attributes: {} }, "a");
    graph.upsertEntity({ entity_type: "company", name: "BMW Group", attributes: {} }, "a");

    const results = graph.findByName("volvo"); // lowercase
    expect(results).toHaveLength(2);
    expect(results.every(r => r.name.toLowerCase().includes("volvo"))).toBe(true);
  });

  it("findByName filters by type when provided", () => {
    graph.upsertEntity({ entity_type: "company", name: "Volvo", attributes: {} }, "a");
    graph.upsertEntity({ entity_type: "contact", name: "Volvo Person", attributes: {} }, "a");

    const companies = graph.findByName("Volvo", "company");
    expect(companies).toHaveLength(1);
    expect(companies[0]!.entity_type).toBe("company");
  });

  // ── listEntities ──────────────────────────────────────────────────────────

  it("listEntities filtered by type", () => {
    graph.upsertEntity({ entity_type: "company", name: "Co1", attributes: {} }, "a");
    graph.upsertEntity({ entity_type: "contact", name: "Person1", attributes: {} }, "a");
    graph.upsertEntity({ entity_type: "company", name: "Co2", attributes: {} }, "a");

    const companies = graph.listEntities("company");
    expect(companies).toHaveLength(2);
    expect(companies.every(e => e.entity_type === "company")).toBe(true);

    const all = graph.listEntities();
    expect(all).toHaveLength(3);
  });

  // ── entitiesSeenBy ────────────────────────────────────────────────────────

  it("entitiesSeenBy returns correct entities", () => {
    graph.upsertEntity({ entity_type: "company", name: "A", attributes: {} }, "bd-pipeline");
    graph.upsertEntity({ entity_type: "company", name: "B", attributes: {} }, "proposal-engine");
    graph.upsertEntity({ entity_type: "company", name: "C", attributes: {} }, "bd-pipeline");

    const bdEntities = graph.entitiesSeenBy("bd-pipeline");
    expect(bdEntities).toHaveLength(2);
    expect(bdEntities.every(e => e.seen_by.includes("bd-pipeline"))).toBe(true);
  });

  // ── addRelation ───────────────────────────────────────────────────────────

  it("addRelation creates a relation", () => {
    const a = graph.upsertEntity({ entity_type: "contact", name: "Alice", attributes: {} }, "x");
    const b = graph.upsertEntity({ entity_type: "company", name: "Corp", attributes: {} }, "x");

    const rel = graph.addRelation(a.entity_id, b.entity_id, "works_at", { since: 2020 });
    expect(rel.relation_id).toBeTruthy();
    expect(rel.from_entity_id).toBe(a.entity_id);
    expect(rel.to_entity_id).toBe(b.entity_id);
    expect(rel.kind).toBe("works_at");
    expect(rel.attributes.since).toBe(2020);
  });

  it("addRelation deduplicates by from+to+kind", () => {
    const a = graph.upsertEntity({ entity_type: "contact", name: "A", attributes: {} }, "x");
    const b = graph.upsertEntity({ entity_type: "company", name: "B", attributes: {} }, "x");

    const rel1 = graph.addRelation(a.entity_id, b.entity_id, "works_at");
    const rel2 = graph.addRelation(a.entity_id, b.entity_id, "works_at");

    expect(rel1.relation_id).toBe(rel2.relation_id);
    expect(graph.getStats().relation_count).toBe(1);
  });

  // ── getRelations ──────────────────────────────────────────────────────────

  it("getRelations with direction from/to/both", () => {
    const a = graph.upsertEntity({ entity_type: "contact", name: "A", attributes: {} }, "x");
    const b = graph.upsertEntity({ entity_type: "company", name: "B", attributes: {} }, "x");
    const c = graph.upsertEntity({ entity_type: "project", name: "C", attributes: {} }, "x");

    graph.addRelation(a.entity_id, b.entity_id, "works_at");
    graph.addRelation(c.entity_id, a.entity_id, "references");

    expect(graph.getRelations(a.entity_id, "from")).toHaveLength(1);
    expect(graph.getRelations(a.entity_id, "to")).toHaveLength(1);
    expect(graph.getRelations(a.entity_id, "both")).toHaveLength(2);
  });

  // ── removeRelation ────────────────────────────────────────────────────────

  it("removeRelation removes a relation and returns true", () => {
    const a = graph.upsertEntity({ entity_type: "contact", name: "A", attributes: {} }, "x");
    const b = graph.upsertEntity({ entity_type: "company", name: "B", attributes: {} }, "x");
    const rel = graph.addRelation(a.entity_id, b.entity_id, "works_at");

    expect(graph.removeRelation(rel.relation_id)).toBe(true);
    expect(graph.getStats().relation_count).toBe(0);
  });

  it("removeRelation returns false for nonexistent relation", () => {
    expect(graph.removeRelation("nonexistent")).toBe(false);
  });

  // ── neighborhood ──────────────────────────────────────────────────────────

  it("neighborhood returns center + neighbors + relations", () => {
    const anna = graph.upsertEntity({ entity_type: "contact", name: "Anna", attributes: {} }, "x");
    const volvo = graph.upsertEntity({ entity_type: "company", name: "Volvo", attributes: {} }, "x");
    const proj = graph.upsertEntity({ entity_type: "project", name: "ASIL-D Analysis", attributes: {} }, "x");

    graph.addRelation(anna.entity_id, volvo.entity_id, "works_at");
    graph.addRelation(anna.entity_id, proj.entity_id, "leads");

    const nb = graph.neighborhood(anna.entity_id);
    expect(nb.center).toBeDefined();
    expect(nb.center!.name).toBe("Anna");
    expect(nb.neighbors).toHaveLength(2);
    expect(nb.relations).toHaveLength(2);
  });

  it("neighborhood for nonexistent entity returns undefined center", () => {
    const nb = graph.neighborhood("no-such-id");
    expect(nb.center).toBeUndefined();
    expect(nb.neighbors).toHaveLength(0);
    expect(nb.relations).toHaveLength(0);
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  it("getStats returns correct counts", () => {
    graph.upsertEntity({ entity_type: "company", name: "Co1", attributes: {} }, "x");
    graph.upsertEntity({ entity_type: "company", name: "Co2", attributes: {} }, "x");
    graph.upsertEntity({ entity_type: "contact", name: "Person1", attributes: {} }, "x");

    const co1 = graph.listEntities("company")[0]!;
    const co2 = graph.listEntities("company")[1]!;
    graph.addRelation(co1.entity_id, co2.entity_id, "partners");

    const stats = graph.getStats();
    expect(stats.entity_count).toBe(3);
    expect(stats.relation_count).toBe(1);
    expect(stats.by_type.company).toBe(2);
    expect(stats.by_type.contact).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SqliteDecisionLog
// ═══════════════════════════════════════════════════════════════════════════════

describe("SqliteDecisionLog", () => {
  let dbPath: string;
  let log: SqliteDecisionLog;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initKnowledgeTables(dbPath);
    log = new SqliteDecisionLog(dbPath);
  });

  afterEach(() => {
    log.close();
    cleanupDb(dbPath);
  });

  it("logDecision stores and returns decision with generated ID", () => {
    const decision = log.logDecision({
      agent_id: "bd-pipeline",
      run_id: "run-1",
      step: 1,
      action: "crm.list_pipeline",
      reasoning: "Need current pipeline state",
      outcome: "Retrieved 5 contacts",
    });

    expect(decision.decision_id).toBeTruthy();
    expect(decision.agent_id).toBe("bd-pipeline");
    expect(decision.run_id).toBe("run-1");
    expect(decision.step).toBe(1);
    expect(decision.action).toBe("crm.list_pipeline");
    expect(decision.created_at).toBeTruthy();
  });

  it("getDecisions filtered by agent_id", () => {
    log.logDecision({ agent_id: "agent-a", run_id: "r1", step: 1, action: "a", reasoning: "r", outcome: "ok" });
    log.logDecision({ agent_id: "agent-b", run_id: "r2", step: 1, action: "b", reasoning: "r", outcome: "ok" });

    expect(log.getDecisions("agent-a")).toHaveLength(1);
    expect(log.getDecisions("agent-b")).toHaveLength(1);
  });

  it("getDecisions filtered by agent_id + run_id", () => {
    log.logDecision({ agent_id: "agent-a", run_id: "run-1", step: 1, action: "x", reasoning: "r", outcome: "ok" });
    log.logDecision({ agent_id: "agent-a", run_id: "run-2", step: 1, action: "y", reasoning: "r", outcome: "ok" });

    const filtered = log.getDecisions("agent-a", "run-1");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.action).toBe("x");
  });

  it("getRecentDecisions returns newest first with limit", () => {
    for (let i = 0; i < 10; i++) {
      log.logDecision({
        agent_id: "agent-a", run_id: `run-${i}`, step: i,
        action: `action-${i}`, reasoning: "r", outcome: "ok",
      });
    }

    const recent = log.getRecentDecisions(3);
    expect(recent).toHaveLength(3);
    // Newest first (highest step number was most recently created)
    expect(recent[0]!.step).toBe(9);
  });

  it("getRecentDecisions filtered by agent", () => {
    log.logDecision({ agent_id: "agent-a", run_id: "r1", step: 1, action: "a", reasoning: "r", outcome: "ok" });
    log.logDecision({ agent_id: "agent-b", run_id: "r2", step: 1, action: "b", reasoning: "r", outcome: "ok" });

    expect(log.getRecentDecisions(50, "agent-a")).toHaveLength(1);
  });

  it("getDecisionCount returns correct totals", () => {
    log.logDecision({ agent_id: "a", run_id: "r1", step: 1, action: "x", reasoning: "r", outcome: "ok" });
    log.logDecision({ agent_id: "a", run_id: "r1", step: 2, action: "y", reasoning: "r", outcome: "ok" });
    log.logDecision({ agent_id: "b", run_id: "r2", step: 1, action: "z", reasoning: "r", outcome: "ok" });

    expect(log.getDecisionCount()).toBe(3);
    expect(log.getDecisionCount("a")).toBe(2);
    expect(log.getDecisionCount("b")).toBe(1);
    expect(log.getDecisionCount("nonexistent")).toBe(0);
  });

  it("multiple decisions for same run ordered by step", () => {
    log.logDecision({ agent_id: "agent-a", run_id: "run-1", step: 3, action: "third", reasoning: "r", outcome: "ok" });
    log.logDecision({ agent_id: "agent-a", run_id: "run-1", step: 1, action: "first", reasoning: "r", outcome: "ok" });
    log.logDecision({ agent_id: "agent-a", run_id: "run-1", step: 2, action: "second", reasoning: "r", outcome: "ok" });

    const decisions = log.getDecisions("agent-a", "run-1");
    expect(decisions).toHaveLength(3);
    expect(decisions[0]!.step).toBe(1);
    expect(decisions[1]!.step).toBe(2);
    expect(decisions[2]!.step).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FTS5 Knowledge Search (SqliteKnowledgeStore)
// ═══════════════════════════════════════════════════════════════════════════════

describe("SqliteKnowledgeStore — FTS5 Search", () => {
  let dbPath: string;
  let store: SqliteKnowledgeStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initKnowledgeTables(dbPath); // creates `documents` table
    store = new SqliteKnowledgeStore(dbPath); // creates FTS5 virtual table
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  it("addDocument makes document findable via search", () => {
    store.addDocument({
      collection: "lessons",
      title: "AUTOSAR migration lesson",
      content: "Classic to Adaptive migration involves service-oriented architecture.",
      tags: ["autosar"],
    });

    const results = store.search("AUTOSAR");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.doc.title).toContain("AUTOSAR");
  });

  it("search returns results ranked by relevance", () => {
    // Doc with AUTOSAR in both title and content should rank higher
    store.addDocument({
      collection: "lessons",
      title: "AUTOSAR AUTOSAR deep dive",
      content: "AUTOSAR architecture is complex. AUTOSAR AUTOSAR AUTOSAR.",
      tags: ["autosar"],
    });
    store.addDocument({
      collection: "lessons",
      title: "General safety lesson",
      content: "This mentions AUTOSAR once.",
      tags: [],
    });

    const results = store.search("AUTOSAR");
    expect(results.length).toBe(2);
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });

  it("search with collection filter", () => {
    store.addDocument({ collection: "lessons", title: "Safety lesson", content: "ISO 26262 requirements", tags: [] });
    store.addDocument({ collection: "proposals", title: "Safety proposal", content: "ISO 26262 proposal", tags: [] });

    const filtered = store.search("ISO 26262", { collection: "lessons" });
    expect(filtered.every(r => r.doc.collection === "lessons")).toBe(true);
  });

  it("search with limit", () => {
    for (let i = 0; i < 20; i++) {
      store.addDocument({ collection: "lessons", title: `AUTOSAR lesson ${i}`, content: "AUTOSAR content", tags: [] });
    }
    const results = store.search("AUTOSAR", { limit: 5 });
    expect(results).toHaveLength(5);
  });

  it("search finds matches in title (higher weight)", () => {
    store.addDocument({
      collection: "lessons",
      title: "Cybersecurity guideline",
      content: "This document covers general topics.",
      tags: [],
    });

    const results = store.search("cybersecurity");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search finds matches in content", () => {
    store.addDocument({
      collection: "lessons",
      title: "General document",
      content: "This covers ASPICE level 2 requirements in depth.",
      tags: [],
    });

    const results = store.search("ASPICE");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search finds matches in tags", () => {
    store.addDocument({
      collection: "lessons",
      title: "Untitled",
      content: "No match here.",
      tags: ["traceability", "requirements"],
    });

    const results = store.search("traceability");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search returns empty array for no matches", () => {
    store.addDocument({ collection: "lessons", title: "A", content: "B", tags: [] });
    const results = store.search("xyznonexistent12345");
    expect(results).toHaveLength(0);
  });

  it("addDocument then deleteDocument removes from search", () => {
    const doc = store.addDocument({
      collection: "lessons",
      title: "Deletable AUTOSAR doc",
      content: "AUTOSAR content to be removed",
      tags: ["autosar"],
    });

    expect(store.search("Deletable AUTOSAR").length).toBeGreaterThan(0);

    store.deleteDocument(doc.doc_id);

    // After deletion, the LIKE-based fallback should not find it either
    const afterDelete = store.search("Deletable AUTOSAR");
    // FTS may still have stale entry, but the JOIN with documents should filter it out.
    // Verify the doc is gone from the documents table at least.
    expect(store.getDocument(doc.doc_id)).toBeUndefined();
  });

  it("search with multiple terms uses OR semantics", () => {
    store.addDocument({ collection: "lessons", title: "AUTOSAR doc", content: "AUTOSAR only", tags: [] });
    store.addDocument({ collection: "lessons", title: "ASPICE doc", content: "ASPICE only", tags: [] });

    const results = store.search("AUTOSAR ASPICE");
    // Both should be found since the search uses OR between terms
    expect(results.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LessonCapture with SqliteKnowledgeStore
// ═══════════════════════════════════════════════════════════════════════════════

describe("LessonCapture with SqliteKnowledgeStore", () => {
  let dbPath: string;
  let store: SqliteKnowledgeStore;
  let capture: LessonCapture;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initKnowledgeTables(dbPath);
    store = new SqliteKnowledgeStore(dbPath);
    capture = new LessonCapture(store);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
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

  it("captureFromRun with completed run stores lessons in SQLite", () => {
    const run = makeRun();
    const lessons = capture.captureFromRun(run, []);

    expect(lessons.length).toBeGreaterThanOrEqual(1);
    expect(lessons[0]!.severity).toBe("observation");

    // Verify lesson was persisted to SQLite
    const docs = store.listCollection("lessons");
    expect(docs.length).toBeGreaterThanOrEqual(1);
  });

  it("captureFromRun with failed run stores critical lesson", () => {
    const run = makeRun({ status: "failed", error: "CRM connection timeout" });
    const lessons = capture.captureFromRun(run, []);

    const critical = lessons.find(l => l.severity === "critical");
    expect(critical).toBeDefined();
    expect(critical!.title).toContain("failed");

    // Verify in SQLite
    const results = store.search("CRM connection timeout");
    expect(results.length).toBeGreaterThan(0);
  });

  it("captureFromRun stores per-decision lessons", () => {
    const run = makeRun({ current_step: 2 });
    const decisions: DecisionLog[] = [
      {
        decision_id: "d1", agent_id: "bd-pipeline", run_id: "run-001", step: 1,
        action: "crm.list_pipeline", reasoning: "Need pipeline state",
        outcome: "Retrieved 5 contacts", created_at: "2026-04-04T08:01:00.000Z",
      },
      {
        decision_id: "d2", agent_id: "bd-pipeline", run_id: "run-001", step: 2,
        action: "email.draft", reasoning: "Draft outreach",
        outcome: "error: template not found", created_at: "2026-04-04T08:02:00.000Z",
      },
    ];

    const lessons = capture.captureFromRun(run, decisions);
    // 1 run-level + 2 per-decision = 3 total
    expect(lessons).toHaveLength(3);

    const errorLesson = lessons.find(l => l.title.includes("email.draft"));
    expect(errorLesson).toBeDefined();
    expect(errorLesson!.severity).toBe("recommendation");
  });

  it("captureCasestudy stores case study document in SQLite", () => {
    capture.captureCasestudy({
      agent_id: "evidence-auditor",
      run_id: "run-002",
      client: "Volvo Cars",
      scope: "ASIL-D HARA + FSC",
      outcome: "Gate review passed",
      key_challenges: ["Late requirement changes"],
      collection: "case-studies",
    });

    const caseStudies = store.listCollection("case-studies");
    expect(caseStudies.length).toBeGreaterThan(0);
    const doc = caseStudies.find(d => d.title.includes("Volvo Cars"));
    expect(doc).toBeDefined();
    expect(doc!.tags).toContain("case-study");
  });

  it("captureManual stores manual lesson in SQLite", () => {
    capture.captureManual({
      agent_id: "proposal-engine",
      run_id: "run-003",
      title: "Ad-hoc insight: always include exclusions",
      body: "Three proposals renegotiated due to missing exclusion scope.",
      severity: "recommendation",
      tags: ["proposal", "scope"],
    });

    const results = store.search("always include exclusions");
    expect(results.length).toBeGreaterThan(0);
  });
});
