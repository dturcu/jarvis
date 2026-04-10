/**
 * Stress: Memory System
 *
 * Tests AgentMemoryStore: short/long-term memory, entity graph,
 * decision logging, eviction, cross-agent isolation, and scale.
 */

import { describe, it, expect } from "vitest";
import { AgentMemoryStore } from "@jarvis/agent-framework";
import { range } from "./helpers.js";

describe("Memory System Stress", () => {
  describe("Short-Term Memory", () => {
    it("500 observations for a single run", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 500; i++) {
        store.addShortTerm("bd-pipeline", "run-1", `Observation ${i}: client responded positively to outreach`);
      }
      const ctx = store.getContext("bd-pipeline", "run-1");
      expect(ctx.short_term).toHaveLength(500);
    });

    it("clearShortTerm removes only target run", () => {
      const store = new AgentMemoryStore();
      for (let i = 0; i < 50; i++) {
        store.addShortTerm("bd-pipeline", "run-A", `Run A observation ${i}`);
        store.addShortTerm("bd-pipeline", "run-B", `Run B observation ${i}`);
      }

      store.clearShortTerm("run-A");

      const ctxA = store.getContext("bd-pipeline", "run-A");
      const ctxB = store.getContext("bd-pipeline", "run-B");
      expect(ctxA.short_term).toHaveLength(0);
      expect(ctxB.short_term).toHaveLength(50);
    });

    it("cross-agent isolation: agents don't see each other's short-term", () => {
      const store = new AgentMemoryStore();
      store.addShortTerm("bd-pipeline", "run-1", "BD observation");
      store.addShortTerm("proposal-engine", "run-1", "Proposal observation");

      expect(store.getContext("bd-pipeline", "run-1").short_term).toHaveLength(1);
      expect(store.getContext("proposal-engine", "run-1").short_term).toHaveLength(1);
      expect(store.getContext("bd-pipeline", "run-1").short_term[0].content).toBe("BD observation");
    });
  });

  describe("Long-Term Memory", () => {
    it("eviction at 500 entries per agent", () => {
      const store = new AgentMemoryStore();

      // Add 510 entries
      for (let i = 0; i < 510; i++) {
        store.addLongTerm("bd-pipeline", `run-${i}`, `Long-term fact #${i}`);
      }

      const ctx = store.getContext("bd-pipeline", "any-run");
      expect(ctx.long_term).toHaveLength(500);

      // The oldest entries should have been evicted
      const contents = ctx.long_term.map(e => e.content);
      expect(contents).not.toContain("Long-term fact #0");
      expect(contents).toContain("Long-term fact #509");
    });

    it("different agents have independent caps", () => {
      const store = new AgentMemoryStore();

      for (let i = 0; i < 505; i++) {
        store.addLongTerm("agent-A", `run-${i}`, `A fact ${i}`);
        store.addLongTerm("agent-B", `run-${i}`, `B fact ${i}`);
      }

      const ctxA = store.getContext("agent-A", "any");
      const ctxB = store.getContext("agent-B", "any");
      expect(ctxA.long_term).toHaveLength(500);
      expect(ctxB.long_term).toHaveLength(500);
    });

    it("long-term persists across runs", () => {
      const store = new AgentMemoryStore();
      store.addLongTerm("bd-pipeline", "run-1", "Learned: client prefers email over calls");
      store.addLongTerm("bd-pipeline", "run-2", "Learned: ISO 26262 is their primary concern");

      // Retrieve from a new run
      const ctx = store.getContext("bd-pipeline", "run-3");
      expect(ctx.long_term).toHaveLength(2);
      expect(ctx.short_term).toHaveLength(0);
    });
  });

  describe("Entity Graph", () => {
    it("upsert creates new entities", () => {
      const store = new AgentMemoryStore();

      store.upsertEntity({
        agent_id: "bd-pipeline",
        entity_type: "contact",
        name: "Luca Bianchi",
        data: { company: "Meridian Engineering", role: "VP Engineering", score: 75 },
      });

      store.upsertEntity({
        agent_id: "bd-pipeline",
        entity_type: "company",
        name: "Meridian Engineering GmbH",
        data: { industry: "Automotive", employees: 12000 },
      });

      const contacts = store.getEntities("bd-pipeline", "contact");
      expect(contacts).toHaveLength(1);
      expect(contacts[0].name).toBe("Luca Bianchi");

      const companies = store.getEntities("bd-pipeline", "company");
      expect(companies).toHaveLength(1);
    });

    it("upsert updates existing entity by (agent, name, type)", () => {
      const store = new AgentMemoryStore();

      const first = store.upsertEntity({
        agent_id: "bd-pipeline",
        entity_type: "contact",
        name: "Luca Bianchi",
        data: { score: 50 },
      });

      const second = store.upsertEntity({
        agent_id: "bd-pipeline",
        entity_type: "contact",
        name: "Luca Bianchi",
        data: { score: 85, status: "hot" },
      });

      expect(second.entity_id).toBe(first.entity_id);
      expect(second.data.score).toBe(85);
      expect(second.data.status).toBe("hot");
      expect(store.getEntities("bd-pipeline", "contact")).toHaveLength(1);
    });

    it("50 entities across multiple types", () => {
      const store = new AgentMemoryStore();
      const types: Array<"contact" | "company" | "document" | "project"> = ["contact", "company", "document", "project"];

      for (let i = 0; i < 50; i++) {
        store.upsertEntity({
          agent_id: "bd-pipeline",
          entity_type: types[i % 4],
          name: `Entity ${i}`,
          data: { index: i },
        });
      }

      expect(store.getEntities("bd-pipeline")).toHaveLength(50);
      expect(store.getEntities("bd-pipeline", "contact")).toHaveLength(13);
      expect(store.getEntities("bd-pipeline", "company")).toHaveLength(13);
    });

    it("same name different types are separate entities", () => {
      const store = new AgentMemoryStore();

      store.upsertEntity({ agent_id: "bd-pipeline", entity_type: "contact", name: "Meridian Engineering", data: { person: true } });
      store.upsertEntity({ agent_id: "bd-pipeline", entity_type: "company", name: "Meridian Engineering", data: { company: true } });

      expect(store.getEntities("bd-pipeline")).toHaveLength(2);
    });
  });

  describe("Decision Logging", () => {
    it("log 100 decisions and retrieve by agent/run", () => {
      const store = new AgentMemoryStore();

      for (let i = 0; i < 100; i++) {
        store.logDecision({
          agent_id: i < 50 ? "bd-pipeline" : "proposal-engine",
          run_id: `run-${i % 10}`,
          step: i % 5,
          action: `email.step_${i % 5}`,
          reasoning: `Decision reasoning for step ${i}`,
          outcome: i % 3 === 0 ? "success" : "partial",
        });
      }

      const bdDecisions = store.getDecisions("bd-pipeline");
      expect(bdDecisions).toHaveLength(50);

      const runDecisions = store.getDecisions("bd-pipeline", "run-0");
      expect(runDecisions).toHaveLength(5);
    });
  });

  describe("Stats & Scale", () => {
    it("getStats reflects all operations", () => {
      const store = new AgentMemoryStore();

      for (let i = 0; i < 10; i++) store.addShortTerm("a", "r1", `st-${i}`);
      for (let i = 0; i < 20; i++) store.addLongTerm("a", "r1", `lt-${i}`);
      for (let i = 0; i < 5; i++) store.upsertEntity({ agent_id: "a", entity_type: "contact", name: `E${i}`, data: {} });
      for (let i = 0; i < 15; i++) store.logDecision({ agent_id: "a", run_id: "r1", step: i, action: "x", reasoning: "y", outcome: "z" });

      const stats = store.getStats();
      expect(stats.short_term_count).toBe(10);
      expect(stats.long_term_count).toBe(20);
      expect(stats.entity_count).toBe(5);
      expect(stats.decision_count).toBe(15);
    });

    it("concurrent operations from 10 agents", async () => {
      const store = new AgentMemoryStore();
      const agents = range(10).map(i => `agent-${i}`);

      await Promise.all(
        agents.flatMap(agentId => [
          ...range(20).map(async i => store.addShortTerm(agentId, `run-${i}`, `short-${i}`)),
          ...range(20).map(async i => store.addLongTerm(agentId, `run-${i}`, `long-${i}`)),
          ...range(5).map(async i => store.upsertEntity({ agent_id: agentId, entity_type: "contact", name: `Contact ${i}`, data: { i } })),
          ...range(10).map(async i => store.logDecision({ agent_id: agentId, run_id: `run-${i}`, step: i, action: "test", reasoning: "r", outcome: "ok" })),
        ]),
      );

      const stats = store.getStats();
      expect(stats.short_term_count).toBe(200);
      expect(stats.long_term_count).toBe(200);
      expect(stats.entity_count).toBe(50);
      expect(stats.decision_count).toBe(100);
    });
  });
});
