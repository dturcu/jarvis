import { beforeEach, describe, expect, it } from "vitest";
import {
  AgentMemoryStore,
  AgentRuntime,
  buildPlan,
  type AgentDefinition,
  type AgentTrigger
} from "@jarvis/agent-framework";

function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agent_id: "test-agent",
    label: "Test Agent",
    version: "1.0.0",
    description: "A test agent definition",
    triggers: [{ kind: "manual" }],
    capabilities: ["files.read", "inference.chat"],
    approval_gates: [],
    knowledge_collections: [],
    task_profile: { objective: "classify", preferences: { prioritize_speed: true } },
    max_steps_per_run: 5,
    system_prompt: "You are a test agent.",
    output_channels: ["chat"],
    ...overrides
  };
}

// ── AgentMemoryStore ──────────────────────────────────────────────────────────

describe("AgentMemoryStore", () => {
  let store: AgentMemoryStore;

  beforeEach(() => {
    store = new AgentMemoryStore();
  });

  describe("addShortTerm", () => {
    it("adds a short-term memory entry and returns it", () => {
      const entry = store.addShortTerm("agent-1", "run-1", "some observation");
      expect(entry.entry_id).toBeTruthy();
      expect(entry.agent_id).toBe("agent-1");
      expect(entry.run_id).toBe("run-1");
      expect(entry.kind).toBe("short_term");
      expect(entry.content).toBe("some observation");
      expect(typeof entry.created_at).toBe("string");
    });

    it("generates unique entry_ids for each entry", () => {
      const e1 = store.addShortTerm("agent-1", "run-1", "first");
      const e2 = store.addShortTerm("agent-1", "run-1", "second");
      expect(e1.entry_id).not.toBe(e2.entry_id);
    });

    it("increments stats after adding short-term entries", () => {
      store.addShortTerm("agent-1", "run-1", "a");
      store.addShortTerm("agent-1", "run-1", "b");
      expect(store.getStats().short_term_count).toBe(2);
    });
  });

  describe("addLongTerm", () => {
    it("adds a long-term memory entry and returns it", () => {
      const entry = store.addLongTerm("agent-1", "run-1", "a learned fact");
      expect(entry.kind).toBe("long_term");
      expect(entry.content).toBe("a learned fact");
    });

    it("increments the long_term_count stat", () => {
      store.addLongTerm("agent-1", "run-1", "fact");
      expect(store.getStats().long_term_count).toBe(1);
    });
  });

  describe("clearShortTerm", () => {
    it("removes short-term entries for a specific run_id", () => {
      store.addShortTerm("agent-1", "run-a", "obs1");
      store.addShortTerm("agent-1", "run-a", "obs2");
      store.addShortTerm("agent-1", "run-b", "obs3");

      store.clearShortTerm("run-a");

      expect(store.getStats().short_term_count).toBe(1);
      const ctx = store.getContext("agent-1", "run-b");
      expect(ctx.short_term).toHaveLength(1);
    });

    it("does not remove long-term entries when clearing short-term", () => {
      store.addShortTerm("agent-1", "run-1", "short");
      store.addLongTerm("agent-1", "run-1", "long");

      store.clearShortTerm("run-1");

      expect(store.getStats().long_term_count).toBe(1);
    });
  });

  describe("getContext", () => {
    it("returns short_term and long_term entries for the agent and run", () => {
      store.addShortTerm("agent-1", "run-1", "short obs");
      store.addLongTerm("agent-1", "run-1", "long fact");

      const ctx = store.getContext("agent-1", "run-1");
      expect(ctx.short_term).toHaveLength(1);
      expect(ctx.short_term[0]!.content).toBe("short obs");
      expect(ctx.long_term).toHaveLength(1);
      expect(ctx.long_term[0]!.content).toBe("long fact");
    });

    it("long_term returns all entries for agent across runs", () => {
      store.addLongTerm("agent-1", "run-1", "fact from run 1");
      store.addLongTerm("agent-1", "run-2", "fact from run 2");

      const ctx = store.getContext("agent-1", "run-1");
      expect(ctx.long_term).toHaveLength(2);
    });

    it("short_term filters by run_id", () => {
      store.addShortTerm("agent-1", "run-1", "for run 1 only");
      store.addShortTerm("agent-1", "run-2", "for run 2 only");

      const ctx = store.getContext("agent-1", "run-1");
      expect(ctx.short_term).toHaveLength(1);
      expect(ctx.short_term[0]!.content).toBe("for run 1 only");
    });

    it("returns empty arrays when no entries exist", () => {
      const ctx = store.getContext("unknown-agent", "run-x");
      expect(ctx.short_term).toHaveLength(0);
      expect(ctx.long_term).toHaveLength(0);
    });
  });

  describe("upsertEntity", () => {
    it("creates a new entity when it does not exist", () => {
      const entity = store.upsertEntity({
        agent_id: "agent-1",
        entity_type: "contact",
        name: "Alice Smith",
        data: { email: "alice@example.com" }
      });
      expect(entity.entity_id).toBeTruthy();
      expect(entity.name).toBe("Alice Smith");
      expect(entity.entity_type).toBe("contact");
      expect(entity.data.email).toBe("alice@example.com");
    });

    it("updates an existing entity by agent_id, name, and entity_type", () => {
      store.upsertEntity({
        agent_id: "agent-1",
        entity_type: "company",
        name: "Acme Corp",
        data: { revenue: 1000000 }
      });
      const updated = store.upsertEntity({
        agent_id: "agent-1",
        entity_type: "company",
        name: "Acme Corp",
        data: { revenue: 2000000 }
      });

      expect(store.getEntities("agent-1").length).toBe(1);
      expect(updated.data.revenue).toBe(2000000);
    });

    it("increments entity_count stat", () => {
      store.upsertEntity({ agent_id: "agent-1", entity_type: "project", name: "Proj A", data: {} });
      expect(store.getStats().entity_count).toBe(1);
    });
  });

  describe("getEntities", () => {
    it("returns all entities for an agent", () => {
      store.upsertEntity({ agent_id: "agent-1", entity_type: "contact", name: "Bob", data: {} });
      store.upsertEntity({ agent_id: "agent-1", entity_type: "company", name: "Corp", data: {} });
      expect(store.getEntities("agent-1")).toHaveLength(2);
    });

    it("filters by entity_type when provided", () => {
      store.upsertEntity({ agent_id: "agent-1", entity_type: "contact", name: "Alice", data: {} });
      store.upsertEntity({ agent_id: "agent-1", entity_type: "company", name: "Corp", data: {} });

      const contacts = store.getEntities("agent-1", "contact");
      expect(contacts).toHaveLength(1);
      expect(contacts[0]!.name).toBe("Alice");
    });

    it("returns empty array for unknown agent", () => {
      expect(store.getEntities("no-such-agent")).toHaveLength(0);
    });
  });

  describe("logDecision and getDecisions", () => {
    it("logs a decision and retrieves it", () => {
      const log = store.logDecision({
        agent_id: "agent-1",
        run_id: "run-1",
        step: 1,
        action: "files.read",
        reasoning: "Need to read the contract",
        outcome: "success"
      });

      expect(log.decision_id).toBeTruthy();
      expect(log.step).toBe(1);
      expect(log.action).toBe("files.read");
    });

    it("getDecisions filters by agent_id", () => {
      store.logDecision({ agent_id: "agent-1", run_id: "run-1", step: 1, action: "a", reasoning: "r", outcome: "ok" });
      store.logDecision({ agent_id: "agent-2", run_id: "run-2", step: 1, action: "b", reasoning: "r", outcome: "ok" });

      expect(store.getDecisions("agent-1")).toHaveLength(1);
      expect(store.getDecisions("agent-2")).toHaveLength(1);
    });

    it("getDecisions filters by run_id when provided", () => {
      store.logDecision({ agent_id: "agent-1", run_id: "run-a", step: 1, action: "a", reasoning: "r", outcome: "ok" });
      store.logDecision({ agent_id: "agent-1", run_id: "run-b", step: 2, action: "b", reasoning: "r", outcome: "ok" });

      const runaDecisions = store.getDecisions("agent-1", "run-a");
      expect(runaDecisions).toHaveLength(1);
      expect(runaDecisions[0]!.action).toBe("a");
    });

    it("increments decision_count stat", () => {
      store.logDecision({ agent_id: "agent-1", run_id: "run-1", step: 1, action: "x", reasoning: "y", outcome: "z" });
      expect(store.getStats().decision_count).toBe(1);
    });
  });

  describe("getStats", () => {
    it("returns zeroes for an empty store", () => {
      const stats = store.getStats();
      expect(stats.short_term_count).toBe(0);
      expect(stats.long_term_count).toBe(0);
      expect(stats.entity_count).toBe(0);
      expect(stats.decision_count).toBe(0);
    });
  });
});

// ── AgentRuntime ──────────────────────────────────────────────────────────────

describe("AgentRuntime", () => {
  let memory: AgentMemoryStore;
  let runtime: AgentRuntime;

  beforeEach(() => {
    memory = new AgentMemoryStore();
    runtime = new AgentRuntime(memory);
  });

  describe("registerAgent / getDefinition", () => {
    it("registers an agent definition and retrieves it", () => {
      const def = makeDefinition();
      runtime.registerAgent(def);
      expect(runtime.getDefinition("test-agent")).toEqual(def);
    });

    it("returns undefined for unregistered agents", () => {
      expect(runtime.getDefinition("not-registered")).toBeUndefined();
    });
  });

  describe("startRun", () => {
    it("throws if agent is not registered", () => {
      expect(() => runtime.startRun("missing-agent", { kind: "manual" })).toThrow();
    });

    it("returns a run with status planning", () => {
      runtime.registerAgent(makeDefinition());
      const run = runtime.startRun("test-agent", { kind: "manual" });

      expect(run.run_id).toBeTruthy();
      expect(run.agent_id).toBe("test-agent");
      expect(run.status).toBe("planning");
      expect(run.current_step).toBe(0);
      expect(run.total_steps).toBe(5);
    });

    it("uses explicit goal when provided", () => {
      runtime.registerAgent(makeDefinition());
      const run = runtime.startRun("test-agent", { kind: "manual" }, "Do something specific");
      expect(run.goal).toBe("Do something specific");
    });

    it("falls back to definition description when no goal is given", () => {
      runtime.registerAgent(makeDefinition({ description: "Default task description" }));
      const run = runtime.startRun("test-agent", { kind: "manual" });
      expect(run.goal).toBe("Default task description");
    });
  });

  describe("clearRunMemory", () => {
    it("clears short-term memory for a given run", () => {
      runtime.registerAgent(makeDefinition());
      const run = runtime.startRun("test-agent", { kind: "manual" });
      memory.addShortTerm("test-agent", run.run_id, "intermediate note");

      runtime.clearRunMemory(run.run_id);

      expect(memory.getStats().short_term_count).toBe(0);
    });

    it("does not affect long-term memory", () => {
      runtime.registerAgent(makeDefinition());
      const run = runtime.startRun("test-agent", { kind: "manual" });
      memory.addShortTerm("test-agent", run.run_id, "short");
      memory.addLongTerm("test-agent", run.run_id, "long");

      runtime.clearRunMemory(run.run_id);

      expect(memory.getStats().short_term_count).toBe(0);
      expect(memory.getStats().long_term_count).toBe(1);
    });

    it("does not affect other runs' short-term memory", () => {
      runtime.registerAgent(makeDefinition());
      const run1 = runtime.startRun("test-agent", { kind: "manual" });
      const run2 = runtime.startRun("test-agent", { kind: "manual" });
      memory.addShortTerm("test-agent", run1.run_id, "run1 note");
      memory.addShortTerm("test-agent", run2.run_id, "run2 note");

      runtime.clearRunMemory(run1.run_id);

      expect(memory.getStats().short_term_count).toBe(1);
    });
  });

  describe("getStatus", () => {
    it("returns the definition for a registered agent", () => {
      const def = makeDefinition();
      runtime.registerAgent(def);

      const status = runtime.getStatus("test-agent");
      expect(status.definition).toEqual(def);
    });

    it("returns undefined definition for unknown agent", () => {
      const status = runtime.getStatus("unknown-agent");
      expect(status.definition).toBeUndefined();
    });
  });
});

// ── buildPlan ─────────────────────────────────────────────────────────────────

describe("buildPlan", () => {
  it("returns an AgentPlan with correct run_id and agent_id", () => {
    const plan = buildPlan({
      agent_id: "bd-pipeline",
      run_id: "run-abc",
      goal: "Find new leads",
      system_prompt: "You are a BD agent.",
      context: "Company: Acme",
      capabilities: ["files.read"],
      max_steps: 5
    });

    expect(plan.run_id).toBe("run-abc");
    expect(plan.agent_id).toBe("bd-pipeline");
    expect(plan.goal).toBe("Find new leads");
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(typeof plan.created_at).toBe("string");
  });
});
