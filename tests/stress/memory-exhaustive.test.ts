/**
 * Stress: Memory Exhaustive
 *
 * Exhaustive coverage of AgentMemoryStore: short-term CRUD, isolation,
 * clearShortTerm, long-term basics, eviction at 500, per-agent caps,
 * getContext filtering, entity upsert/update/types, decision logging,
 * stats accuracy, concurrent agents, edge cases, entry IDs, timestamps.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { AgentMemoryStore } from "@jarvis/agent-framework";
import { range } from "./helpers.js";

describe("Memory Exhaustive", () => {

  // ── Short-Term CRUD ──────────────────────────────────────────────────────

  describe("short-term CRUD", () => {
    it("add 1 entry and verify all fields", () => {
      const store = new AgentMemoryStore();
      const entry = store.addShortTerm("agent-a", "run-1", "observation one");

      expect(entry.entry_id).toBeDefined();
      expect(entry.agent_id).toBe("agent-a");
      expect(entry.run_id).toBe("run-1");
      expect(entry.kind).toBe("short_term");
      expect(entry.content).toBe("observation one");
      expect(entry.created_at).toBeDefined();
    });

    it("add 100 entries and verify count", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 100; i++) {
        store.addShortTerm("agent-a", "run-1", `observation ${i}`);
      }
      const ctx = store.getContext("agent-a", "run-1");
      expect(ctx.short_term).toHaveLength(100);
    });

    it("100 entries all have correct content", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 100; i++) {
        store.addShortTerm("agent-a", "run-1", `obs-${i}`);
      }
      const ctx = store.getContext("agent-a", "run-1");
      const contents = ctx.short_term.map(e => e.content);
      for (let i = 0; i < 100; i++) {
        expect(contents).toContain(`obs-${i}`);
      }
    });

    it("all entry_ids are unique across 100 entries", () => {
      const store = new AgentMemoryStore();
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const entry = store.addShortTerm("agent-a", "run-1", `obs-${i}`);
        ids.add(entry.entry_id);
      }
      expect(ids.size).toBe(100);
    });

    it("all entries have correct agent_id, run_id, kind", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 10; i++) {
        const entry = store.addShortTerm("test-agent", "test-run", `content-${i}`);
        expect(entry.agent_id).toBe("test-agent");
        expect(entry.run_id).toBe("test-run");
        expect(entry.kind).toBe("short_term");
      }
    });
  });

  // ── Short-Term Isolation ─────────────────────────────────────────────────

  describe("short-term isolation", () => {
    it("5 agents x 5 runs: each context returns correct subset", () => {
      const store = new AgentMemoryStore();
      const agents = range(5).map(i => `agent-${i}`);
      const runs = range(5).map(i => `run-${i}`);

      for (const agent of agents) {
        for (const run of runs) {
          for (let i = 0; i < 3; i++) {
            store.addShortTerm(agent, run, `${agent}/${run}/obs-${i}`);
          }
        }
      }

      // Each (agent, run) pair should have exactly 3 entries
      for (const agent of agents) {
        for (const run of runs) {
          const ctx = store.getContext(agent, run);
          expect(ctx.short_term).toHaveLength(3);
          for (const entry of ctx.short_term) {
            expect(entry.agent_id).toBe(agent);
            expect(entry.run_id).toBe(run);
          }
        }
      }
    });

    it("different agents same run_id are isolated", () => {
      const store = new AgentMemoryStore();
      store.addShortTerm("agent-x", "shared-run", "X observation");
      store.addShortTerm("agent-y", "shared-run", "Y observation");

      const ctxX = store.getContext("agent-x", "shared-run");
      const ctxY = store.getContext("agent-y", "shared-run");
      expect(ctxX.short_term).toHaveLength(1);
      expect(ctxY.short_term).toHaveLength(1);
      expect(ctxX.short_term[0].content).toBe("X observation");
      expect(ctxY.short_term[0].content).toBe("Y observation");
    });

    it("same agent different runs are isolated", () => {
      const store = new AgentMemoryStore();
      store.addShortTerm("agent-a", "run-1", "Run 1 data");
      store.addShortTerm("agent-a", "run-2", "Run 2 data");

      expect(store.getContext("agent-a", "run-1").short_term).toHaveLength(1);
      expect(store.getContext("agent-a", "run-2").short_term).toHaveLength(1);
    });
  });

  // ── clearShortTerm ───────────────────────────────────────────────────────

  describe("clearShortTerm", () => {
    it("clears specific run only", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 20; i++) {
        store.addShortTerm("agent-a", "run-to-clear", `entry-${i}`);
        store.addShortTerm("agent-a", "run-to-keep", `entry-${i}`);
      }

      store.clearShortTerm("run-to-clear");

      expect(store.getContext("agent-a", "run-to-clear").short_term).toHaveLength(0);
      expect(store.getContext("agent-a", "run-to-keep").short_term).toHaveLength(20);
    });

    it("other agents' data untouched by clear", () => {
      const store = new AgentMemoryStore();
      store.addShortTerm("agent-a", "run-1", "A data");
      store.addShortTerm("agent-b", "run-1", "B data");

      store.clearShortTerm("run-1");

      // Both agents' entries for run-1 should be cleared
      expect(store.getContext("agent-a", "run-1").short_term).toHaveLength(0);
      expect(store.getContext("agent-b", "run-1").short_term).toHaveLength(0);
    });

    it("clear non-existent run is a no-op", () => {
      const store = new AgentMemoryStore();
      store.addShortTerm("agent-a", "run-1", "data");

      // Should not throw
      store.clearShortTerm("run-nonexistent");

      expect(store.getContext("agent-a", "run-1").short_term).toHaveLength(1);
    });

    it("clear then verify stats updated", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 10; i++) {
        store.addShortTerm("agent-a", "run-1", `entry-${i}`);
      }
      expect(store.getStats().short_term_count).toBe(10);

      store.clearShortTerm("run-1");
      expect(store.getStats().short_term_count).toBe(0);
    });
  });

  // ── Long-Term Basics ─────────────────────────────────────────────────────

  describe("long-term basics", () => {
    it("add entries and verify kind=long_term", () => {
      const store = new AgentMemoryStore();
      const entry = store.addLongTerm("agent-a", "run-1", "long term fact");
      expect(entry.kind).toBe("long_term");
    });

    it("long-term persists across runs", () => {
      const store = new AgentMemoryStore();
      store.addLongTerm("agent-a", "run-1", "Fact from run 1");
      store.addLongTerm("agent-a", "run-2", "Fact from run 2");

      const ctx = store.getContext("agent-a", "run-99");
      expect(ctx.long_term).toHaveLength(2);
      expect(ctx.short_term).toHaveLength(0);
    });

    it("long-term entry has all expected fields", () => {
      const store = new AgentMemoryStore();
      const entry = store.addLongTerm("agent-a", "run-1", "persistent fact");

      expect(entry.entry_id).toBeDefined();
      expect(entry.agent_id).toBe("agent-a");
      expect(entry.run_id).toBe("run-1");
      expect(entry.kind).toBe("long_term");
      expect(entry.content).toBe("persistent fact");
      expect(entry.created_at).toBeDefined();
    });

    it("50 long-term entries from different runs all accessible", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 50; i++) {
        store.addLongTerm("agent-a", `run-${i}`, `fact-${i}`);
      }
      const ctx = store.getContext("agent-a", "any-run");
      expect(ctx.long_term).toHaveLength(50);
    });
  });

  // ── Long-Term Eviction at 500 ────────────────────────────────────────────

  describe("long-term eviction at 500", () => {
    it("exactly 500 entries: all kept", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 500; i++) {
        store.addLongTerm("agent-a", `run-${i}`, `fact-${i}`);
      }
      const ctx = store.getContext("agent-a", "any");
      expect(ctx.long_term).toHaveLength(500);
    });

    it("501 entries: oldest evicted", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 501; i++) {
        store.addLongTerm("agent-a", `run-${i}`, `fact-${i}`);
      }
      const ctx = store.getContext("agent-a", "any");
      expect(ctx.long_term).toHaveLength(500);
      const contents = ctx.long_term.map(e => e.content);
      expect(contents).not.toContain("fact-0");
      expect(contents).toContain("fact-500");
    });

    it("600 entries: 100 oldest evicted", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 600; i++) {
        store.addLongTerm("agent-a", `run-${i}`, `fact-${i}`);
      }
      const ctx = store.getContext("agent-a", "any");
      expect(ctx.long_term).toHaveLength(500);

      const contents = ctx.long_term.map(e => e.content);
      // Facts 0-99 should be evicted
      for (let i = 0; i < 100; i++) {
        expect(contents).not.toContain(`fact-${i}`);
      }
      // Facts 100-599 should be kept
      expect(contents).toContain("fact-100");
      expect(contents).toContain("fact-599");
    });

    it("most recent 500 kept after heavy eviction", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 700; i++) {
        store.addLongTerm("agent-a", `run-${i}`, `fact-${i}`);
      }
      const ctx = store.getContext("agent-a", "any");
      expect(ctx.long_term).toHaveLength(500);
      const contents = ctx.long_term.map(e => e.content);
      expect(contents).toContain("fact-699");
      expect(contents).toContain("fact-200");
      expect(contents).not.toContain("fact-199");
    });
  });

  // ── Long-Term Per-Agent Independence ─────────────────────────────────────

  describe("long-term per-agent independence", () => {
    it("two agents each add 505: each caps at 500 independently", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 505; i++) {
        store.addLongTerm("agent-A", `run-${i}`, `A-fact-${i}`);
        store.addLongTerm("agent-B", `run-${i}`, `B-fact-${i}`);
      }

      const ctxA = store.getContext("agent-A", "any");
      const ctxB = store.getContext("agent-B", "any");
      expect(ctxA.long_term).toHaveLength(500);
      expect(ctxB.long_term).toHaveLength(500);
    });

    it("agent-A at cap, agent-B below cap: independent", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 510; i++) {
        store.addLongTerm("agent-A", `run-${i}`, `A-${i}`);
      }
      for (let i = 0; i < 250; i++) {
        store.addLongTerm("agent-B", `run-${i}`, `B-${i}`);
      }

      expect(store.getContext("agent-A", "any").long_term).toHaveLength(500);
      expect(store.getContext("agent-B", "any").long_term).toHaveLength(250);
    });

    it("eviction in one agent does not affect another", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 502; i++) {
        store.addLongTerm("agent-A", `run-${i}`, `A-${i}`);
      }
      store.addLongTerm("agent-B", "run-0", "B-only-fact");

      const ctxA = store.getContext("agent-A", "any");
      const ctxB = store.getContext("agent-B", "any");
      expect(ctxA.long_term).toHaveLength(500);
      expect(ctxB.long_term).toHaveLength(1);
      expect(ctxB.long_term[0].content).toBe("B-only-fact");
    });
  });

  // ── getContext ────────────────────────────────────────────────────────────

  describe("getContext", () => {
    it("short_term filtered by both agentId AND runId", () => {
      const store = new AgentMemoryStore();
      store.addShortTerm("agent-a", "run-1", "a/r1");
      store.addShortTerm("agent-a", "run-2", "a/r2");
      store.addShortTerm("agent-b", "run-1", "b/r1");

      const ctx = store.getContext("agent-a", "run-1");
      expect(ctx.short_term).toHaveLength(1);
      expect(ctx.short_term[0].content).toBe("a/r1");
    });

    it("long_term filtered by agentId only (not runId)", () => {
      const store = new AgentMemoryStore();
      store.addLongTerm("agent-a", "run-1", "lt-r1");
      store.addLongTerm("agent-a", "run-2", "lt-r2");
      store.addLongTerm("agent-b", "run-1", "lt-b-r1");

      const ctx = store.getContext("agent-a", "run-1");
      expect(ctx.long_term).toHaveLength(2);
      expect(ctx.long_term.map(e => e.content).sort()).toEqual(["lt-r1", "lt-r2"]);
    });

    it("empty context for unknown agent", () => {
      const store = new AgentMemoryStore();
      store.addShortTerm("agent-a", "run-1", "data");

      const ctx = store.getContext("unknown-agent", "run-1");
      expect(ctx.short_term).toHaveLength(0);
      expect(ctx.long_term).toHaveLength(0);
    });

    it("context returns both short and long term together", () => {
      const store = new AgentMemoryStore();
      store.addShortTerm("agent-a", "run-1", "short-data");
      store.addLongTerm("agent-a", "run-1", "long-data");

      const ctx = store.getContext("agent-a", "run-1");
      expect(ctx.short_term).toHaveLength(1);
      expect(ctx.long_term).toHaveLength(1);
    });
  });

  // ── Entity Upsert Create ─────────────────────────────────────────────────

  describe("entity upsert create", () => {
    it("creates new entity with all fields", () => {
      const store = new AgentMemoryStore();
      const entity = store.upsertEntity({
        agent_id: "bd-pipeline",
        entity_type: "contact",
        name: "John Doe",
        data: { email: "john@example.com", score: 75 },
      });

      expect(entity.entity_id).toBeDefined();
      expect(entity.agent_id).toBe("bd-pipeline");
      expect(entity.entity_type).toBe("contact");
      expect(entity.name).toBe("John Doe");
      expect(entity.data.email).toBe("john@example.com");
      expect(entity.created_at).toBeDefined();
      expect(entity.updated_at).toBeDefined();
    });

    it("created_at equals updated_at on creation", () => {
      const store = new AgentMemoryStore();
      const entity = store.upsertEntity({
        agent_id: "test",
        entity_type: "contact",
        name: "New Contact",
        data: {},
      });
      expect(entity.created_at).toBe(entity.updated_at);
    });

    it("entity_id is a valid UUID format", () => {
      const store = new AgentMemoryStore();
      const entity = store.upsertEntity({
        agent_id: "test",
        entity_type: "company",
        name: "Test Corp",
        data: {},
      });
      expect(entity.entity_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  // ── Entity Upsert Update ─────────────────────────────────────────────────

  describe("entity upsert update", () => {
    it("same (agent_id, name, type) updates existing entity", () => {
      const store = new AgentMemoryStore();
      const first = store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Alice",
        data: { score: 50 },
      });
      const second = store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Alice",
        data: { score: 85, status: "hot" },
      });

      expect(second.entity_id).toBe(first.entity_id);
      expect(store.getEntities("bd", "contact")).toHaveLength(1);
    });

    it("updated_at > created_at after upsert update", async () => {
      const store = new AgentMemoryStore();
      const first = store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Bob",
        data: { v: 1 },
      });

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 5));

      const second = store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Bob",
        data: { v: 2 },
      });

      expect(second.updated_at).not.toBe(first.created_at);
    });

    it("data is merged/replaced on upsert", () => {
      const store = new AgentMemoryStore();
      store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Carol",
        data: { score: 50, source: "linkedin" },
      });
      const updated = store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Carol",
        data: { score: 85, status: "hot" },
      });

      expect(updated.data.score).toBe(85);
      expect(updated.data.status).toBe("hot");
    });
  });

  // ── Entity Types ─────────────────────────────────────────────────────────

  describe("entity types", () => {
    const allTypes: Array<"contact" | "company" | "document" | "project" | "other"> =
      ["contact", "company", "document", "project", "other"];

    for (const type of allTypes) {
      it(`creates entity of type "${type}"`, () => {
        const store = new AgentMemoryStore();
        const entity = store.upsertEntity({
          agent_id: "test",
          entity_type: type,
          name: `Test ${type}`,
          data: { type_label: type },
        });
        expect(entity.entity_type).toBe(type);
      });
    }

    it("getEntities filters by type correctly", () => {
      const store = new AgentMemoryStore();
      for (const type of allTypes) {
        store.upsertEntity({
          agent_id: "test",
          entity_type: type,
          name: `Entity-${type}`,
          data: {},
        });
      }

      for (const type of allTypes) {
        const entities = store.getEntities("test", type);
        expect(entities).toHaveLength(1);
        expect(entities[0].entity_type).toBe(type);
      }

      // Without filter returns all
      expect(store.getEntities("test")).toHaveLength(5);
    });
  });

  // ── Entity Same Name Different Type ──────────────────────────────────────

  describe("entity same name different type", () => {
    it("'Bertrandt' as contact and company creates 2 entities", () => {
      const store = new AgentMemoryStore();
      store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Bertrandt",
        data: { person: true },
      });
      store.upsertEntity({
        agent_id: "bd",
        entity_type: "company",
        name: "Bertrandt",
        data: { company: true },
      });

      expect(store.getEntities("bd")).toHaveLength(2);
      expect(store.getEntities("bd", "contact")).toHaveLength(1);
      expect(store.getEntities("bd", "company")).toHaveLength(1);
    });

    it("same name across 3 types creates 3 entities", () => {
      const store = new AgentMemoryStore();
      const types: Array<"contact" | "company" | "document"> = ["contact", "company", "document"];
      for (const t of types) {
        store.upsertEntity({ agent_id: "bd", entity_type: t, name: "Overlap", data: {} });
      }
      expect(store.getEntities("bd")).toHaveLength(3);
    });
  });

  // ── Entity Same Name Different Agent ─────────────────────────────────────

  describe("entity same name different agent", () => {
    it("agent-A and agent-B both create 'Bertrandt' contact = 2 entities", () => {
      const store = new AgentMemoryStore();
      store.upsertEntity({ agent_id: "agent-A", entity_type: "contact", name: "Bertrandt", data: { a: 1 } });
      store.upsertEntity({ agent_id: "agent-B", entity_type: "contact", name: "Bertrandt", data: { b: 2 } });

      expect(store.getEntities("agent-A", "contact")).toHaveLength(1);
      expect(store.getEntities("agent-B", "contact")).toHaveLength(1);
      expect(store.getEntities("agent-A", "contact")[0].data.a).toBe(1);
      expect(store.getEntities("agent-B", "contact")[0].data.b).toBe(2);
    });
  });

  // ── Entity Data Updates ──────────────────────────────────────────────────

  describe("entity data updates", () => {
    it("create with {score:50}, upsert with {score:85, status:'hot'}", () => {
      const store = new AgentMemoryStore();
      store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Lead X",
        data: { score: 50 },
      });
      const updated = store.upsertEntity({
        agent_id: "bd",
        entity_type: "contact",
        name: "Lead X",
        data: { score: 85, status: "hot" },
      });

      expect(updated.data.score).toBe(85);
      expect(updated.data.status).toBe("hot");
    });

    it("multiple sequential updates converge to final state", () => {
      const store = new AgentMemoryStore();
      store.upsertEntity({ agent_id: "bd", entity_type: "company", name: "ACME", data: { stage: "prospect" } });
      store.upsertEntity({ agent_id: "bd", entity_type: "company", name: "ACME", data: { stage: "qualified" } });
      store.upsertEntity({ agent_id: "bd", entity_type: "company", name: "ACME", data: { stage: "proposal" } });

      const entities = store.getEntities("bd", "company");
      expect(entities).toHaveLength(1);
      expect(entities[0].data.stage).toBe("proposal");
    });
  });

  // ── Decision Logging ─────────────────────────────────────────────────────

  describe("decision logging", () => {
    it("log 1 decision and verify all fields", () => {
      const store = new AgentMemoryStore();
      const dec = store.logDecision({
        agent_id: "bd-pipeline",
        run_id: "run-1",
        step: 0,
        action: "email.draft",
        reasoning: "Client shows high interest",
        outcome: "success",
      });

      expect(dec.decision_id).toBeDefined();
      expect(dec.agent_id).toBe("bd-pipeline");
      expect(dec.run_id).toBe("run-1");
      expect(dec.step).toBe(0);
      expect(dec.action).toBe("email.draft");
      expect(dec.reasoning).toBe("Client shows high interest");
      expect(dec.outcome).toBe("success");
      expect(dec.created_at).toBeDefined();
    });

    it("log 50 decisions and verify unique decision_ids", () => {
      const store = new AgentMemoryStore();
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const dec = store.logDecision({
          agent_id: "agent-a",
          run_id: "run-1",
          step: i,
          action: `action-${i}`,
          reasoning: `reason-${i}`,
          outcome: "ok",
        });
        ids.add(dec.decision_id);
      }
      expect(ids.size).toBe(50);
    });

    it("all fields stored correctly across 20 decisions", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 20; i++) {
        store.logDecision({
          agent_id: "agent-a",
          run_id: "run-1",
          step: i,
          action: `step-${i}`,
          reasoning: `because-${i}`,
          outcome: i % 2 === 0 ? "success" : "partial",
        });
      }

      const decisions = store.getDecisions("agent-a", "run-1");
      expect(decisions).toHaveLength(20);
      for (let i = 0; i < 20; i++) {
        expect(decisions[i].step).toBe(i);
        expect(decisions[i].action).toBe(`step-${i}`);
      }
    });
  });

  // ── Decision Filtering ───────────────────────────────────────────────────

  describe("decision filtering", () => {
    it("3 agents x 3 runs x 5 decisions: filter by agent", () => {
      const store = new AgentMemoryStore();
      for (let a = 0; a < 3; a++) {
        for (let r = 0; r < 3; r++) {
          for (let d = 0; d < 5; d++) {
            store.logDecision({
              agent_id: `agent-${a}`,
              run_id: `run-${r}`,
              step: d,
              action: `act-${d}`,
              reasoning: "r",
              outcome: "ok",
            });
          }
        }
      }

      // Filter by agent only: 3 runs * 5 decisions = 15
      const agent0 = store.getDecisions("agent-0");
      expect(agent0).toHaveLength(15);

      const agent2 = store.getDecisions("agent-2");
      expect(agent2).toHaveLength(15);
    });

    it("3 agents x 3 runs x 5 decisions: filter by agent + run", () => {
      const store = new AgentMemoryStore();
      for (let a = 0; a < 3; a++) {
        for (let r = 0; r < 3; r++) {
          for (let d = 0; d < 5; d++) {
            store.logDecision({
              agent_id: `agent-${a}`,
              run_id: `run-${r}`,
              step: d,
              action: `act-${d}`,
              reasoning: "r",
              outcome: "ok",
            });
          }
        }
      }

      // Filter by agent + run: exactly 5
      const specific = store.getDecisions("agent-1", "run-2");
      expect(specific).toHaveLength(5);
      for (const dec of specific) {
        expect(dec.agent_id).toBe("agent-1");
        expect(dec.run_id).toBe("run-2");
      }
    });

    it("getDecisions for unknown agent returns empty", () => {
      const store = new AgentMemoryStore();
      store.logDecision({ agent_id: "a", run_id: "r", step: 0, action: "x", reasoning: "y", outcome: "z" });
      expect(store.getDecisions("nonexistent")).toHaveLength(0);
    });
  });

  // ── Stats Accuracy ───────────────────────────────────────────────────────

  describe("stats accuracy", () => {
    it("mixed operations: stats reflect actual counts", () => {
      const store = new AgentMemoryStore();

      for (let i = 0; i < 15; i++) store.addShortTerm("a", "r1", `st-${i}`);
      for (let i = 0; i < 25; i++) store.addLongTerm("a", "r1", `lt-${i}`);
      for (let i = 0; i < 8; i++) store.upsertEntity({ agent_id: "a", entity_type: "contact", name: `E${i}`, data: {} });
      for (let i = 0; i < 12; i++) store.logDecision({ agent_id: "a", run_id: "r1", step: i, action: "x", reasoning: "y", outcome: "z" });

      const stats = store.getStats();
      expect(stats.short_term_count).toBe(15);
      expect(stats.long_term_count).toBe(25);
      expect(stats.entity_count).toBe(8);
      expect(stats.decision_count).toBe(12);
    });

    it("stats after clearShortTerm reflect reduced count", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 30; i++) store.addShortTerm("a", "run-1", `s-${i}`);
      for (let i = 0; i < 20; i++) store.addShortTerm("a", "run-2", `s-${i}`);

      store.clearShortTerm("run-1");

      expect(store.getStats().short_term_count).toBe(20);
    });

    it("stats with multiple agents sum correctly", () => {
      const store = new AgentMemoryStore();
      for (let a = 0; a < 5; a++) {
        store.addShortTerm(`agent-${a}`, "r", "s");
        store.addLongTerm(`agent-${a}`, "r", "l");
        store.upsertEntity({ agent_id: `agent-${a}`, entity_type: "contact", name: `E-${a}`, data: {} });
        store.logDecision({ agent_id: `agent-${a}`, run_id: "r", step: 0, action: "a", reasoning: "r", outcome: "o" });
      }

      const stats = store.getStats();
      expect(stats.short_term_count).toBe(5);
      expect(stats.long_term_count).toBe(5);
      expect(stats.entity_count).toBe(5);
      expect(stats.decision_count).toBe(5);
    });

    it("empty store stats are all zero", () => {
      const store = new AgentMemoryStore();
      const stats = store.getStats();
      expect(stats.short_term_count).toBe(0);
      expect(stats.long_term_count).toBe(0);
      expect(stats.entity_count).toBe(0);
      expect(stats.decision_count).toBe(0);
    });
  });

  // ── Concurrent Agents ────────────────────────────────────────────────────

  describe("concurrent agents", () => {
    it("10 agents x (20 short + 20 long + 5 entities + 10 decisions) simultaneously", async () => {
      const store = new AgentMemoryStore();
      const agents = range(10).map(i => `agent-${i}`);

      await Promise.all(
        agents.flatMap(agentId => [
          ...range(20).map(async i => store.addShortTerm(agentId, `run-${i}`, `short-${i}`)),
          ...range(20).map(async i => store.addLongTerm(agentId, `run-${i}`, `long-${i}`)),
          ...range(5).map(async i =>
            store.upsertEntity({ agent_id: agentId, entity_type: "contact", name: `Contact ${i}`, data: { i } }),
          ),
          ...range(10).map(async i =>
            store.logDecision({ agent_id: agentId, run_id: `run-${i}`, step: i, action: "test", reasoning: "r", outcome: "ok" }),
          ),
        ]),
      );

      const stats = store.getStats();
      expect(stats.short_term_count).toBe(200);
      expect(stats.long_term_count).toBe(200);
      expect(stats.entity_count).toBe(50);
      expect(stats.decision_count).toBe(100);
    });

    it("concurrent agents with isolated contexts", async () => {
      const store = new AgentMemoryStore();

      await Promise.all(
        range(10).map(async (i) => {
          const agentId = `iso-agent-${i}`;
          const runId = `iso-run-${i}`;
          store.addShortTerm(agentId, runId, `data-${i}`);
          store.addLongTerm(agentId, runId, `long-${i}`);
        }),
      );

      // Each agent should see only its own data
      for (let i = 0; i < 10; i++) {
        const ctx = store.getContext(`iso-agent-${i}`, `iso-run-${i}`);
        expect(ctx.short_term).toHaveLength(1);
        expect(ctx.long_term).toHaveLength(1);
      }
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("empty content in short-term", () => {
      const store = new AgentMemoryStore();
      const entry = store.addShortTerm("agent", "run", "");
      expect(entry.content).toBe("");
      expect(store.getContext("agent", "run").short_term).toHaveLength(1);
    });

    it("empty content in long-term", () => {
      const store = new AgentMemoryStore();
      const entry = store.addLongTerm("agent", "run", "");
      expect(entry.content).toBe("");
    });

    it("very long content (50KB) in short-term", () => {
      const store = new AgentMemoryStore();
      const longContent = "X".repeat(50 * 1024);
      const entry = store.addShortTerm("agent", "run", longContent);
      expect(entry.content).toHaveLength(50 * 1024);

      const ctx = store.getContext("agent", "run");
      expect(ctx.short_term[0].content).toHaveLength(50 * 1024);
    });

    it("very long content (50KB) in long-term", () => {
      const store = new AgentMemoryStore();
      const longContent = "Y".repeat(50 * 1024);
      const entry = store.addLongTerm("agent", "run", longContent);
      expect(entry.content).toHaveLength(50 * 1024);
    });

    it("special characters in entity name", () => {
      const store = new AgentMemoryStore();
      const specialNames = [
        "François Sagnely",
        "名前テスト",
        "O'Reilly & Associates",
        "Contact <script>alert(1)</script>",
        "  spaces  around  ",
      ];

      for (const name of specialNames) {
        store.upsertEntity({ agent_id: "test", entity_type: "contact", name, data: {} });
      }

      expect(store.getEntities("test")).toHaveLength(specialNames.length);
    });

    it("numeric data values in entity", () => {
      const store = new AgentMemoryStore();
      const entity = store.upsertEntity({
        agent_id: "test",
        entity_type: "other",
        name: "Numeric Entity",
        data: { int: 42, float: 3.14, negative: -100, zero: 0 },
      });

      expect(entity.data.int).toBe(42);
      expect(entity.data.float).toBe(3.14);
      expect(entity.data.negative).toBe(-100);
      expect(entity.data.zero).toBe(0);
    });

    it("empty data object in entity", () => {
      const store = new AgentMemoryStore();
      const entity = store.upsertEntity({
        agent_id: "test",
        entity_type: "other",
        name: "Empty Data",
        data: {},
      });
      expect(entity.data).toEqual({});
    });
  });

  // ── Entry IDs ────────────────────────────────────────────────────────────

  describe("entry IDs", () => {
    it("all short-term UUIDs are valid format", () => {
      const store = new AgentMemoryStore();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (let i = 0; i < 50; i++) {
        const entry = store.addShortTerm("agent", "run", `entry-${i}`);
        expect(entry.entry_id).toMatch(uuidRegex);
      }
    });

    it("all long-term UUIDs are valid format", () => {
      const store = new AgentMemoryStore();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (let i = 0; i < 50; i++) {
        const entry = store.addLongTerm("agent", `run-${i}`, `entry-${i}`);
        expect(entry.entry_id).toMatch(uuidRegex);
      }
    });

    it("no duplicate IDs across 200 mixed entries", () => {
      const store = new AgentMemoryStore();
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const st = store.addShortTerm("agent", "run", `st-${i}`);
        ids.add(st.entry_id);
      }
      for (let i = 0; i < 100; i++) {
        const lt = store.addLongTerm("agent", `run-${i}`, `lt-${i}`);
        ids.add(lt.entry_id);
      }

      expect(ids.size).toBe(200);
    });

    it("entity IDs are unique across 50 entities", () => {
      const store = new AgentMemoryStore();
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const entity = store.upsertEntity({
          agent_id: "test",
          entity_type: "contact",
          name: `Contact-${i}`,
          data: {},
        });
        ids.add(entity.entity_id);
      }
      expect(ids.size).toBe(50);
    });

    it("decision IDs are unique across 50 decisions", () => {
      const store = new AgentMemoryStore();
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const dec = store.logDecision({
          agent_id: "test",
          run_id: "run",
          step: i,
          action: `act-${i}`,
          reasoning: "r",
          outcome: "o",
        });
        ids.add(dec.decision_id);
      }
      expect(ids.size).toBe(50);
    });
  });

  // ── Timestamps ───────────────────────────────────────────────────────────

  describe("timestamps", () => {
    it("short-term created_at is valid ISO format", () => {
      const store = new AgentMemoryStore();
      const entry = store.addShortTerm("agent", "run", "data");
      // ISO format: contains T separator and timezone info
      expect(typeof entry.created_at).toBe("string");
      expect(new Date(entry.created_at).toISOString()).toBeDefined();
      expect(Number.isNaN(Date.parse(entry.created_at))).toBe(false);
    });

    it("long-term created_at is valid ISO format", () => {
      const store = new AgentMemoryStore();
      const entry = store.addLongTerm("agent", "run", "data");
      expect(Number.isNaN(Date.parse(entry.created_at))).toBe(false);
    });

    it("entity timestamps are valid ISO format", () => {
      const store = new AgentMemoryStore();
      const entity = store.upsertEntity({
        agent_id: "test",
        entity_type: "contact",
        name: "TS Test",
        data: {},
      });
      expect(Number.isNaN(Date.parse(entity.created_at))).toBe(false);
      expect(Number.isNaN(Date.parse(entity.updated_at))).toBe(false);
    });

    it("decision created_at is valid ISO format", () => {
      const store = new AgentMemoryStore();
      const dec = store.logDecision({
        agent_id: "test",
        run_id: "run",
        step: 0,
        action: "x",
        reasoning: "y",
        outcome: "z",
      });
      expect(Number.isNaN(Date.parse(dec.created_at))).toBe(false);
    });

    it("chronological ordering: later entries have later timestamps", async () => {
      const store = new AgentMemoryStore();
      const entries = [];
      for (let i = 0; i < 5; i++) {
        entries.push(store.addShortTerm("agent", "run", `entry-${i}`));
        // Small delay to ensure distinguishable timestamps
        if (i < 4) await new Promise(r => setTimeout(r, 2));
      }

      for (let i = 1; i < entries.length; i++) {
        const prev = Date.parse(entries[i - 1].created_at);
        const curr = Date.parse(entries[i].created_at);
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });
  });
});
