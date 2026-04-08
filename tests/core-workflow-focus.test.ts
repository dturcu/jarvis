import { describe, expect, it } from "vitest";
import { ALL_AGENTS } from "@jarvis/agents";
import { V1_WORKFLOWS, STARTER_PACKS } from "@jarvis/runtime";

/*
 * Core workflow focus tests — rebuilt for the 8-agent production roster.
 *
 * Validates agent roster coherence, workflow alignment, starter pack
 * consistency, and maturity enforcement.
 */

const agentMap = new Map(ALL_AGENTS.map(a => [a.agent_id, a]));

const EXPECTED_IDS = [
  "orchestrator",
  "self-reflection",
  "regulatory-watch",
  "knowledge-curator",
  "proposal-engine",
  "evidence-auditor",
  "contract-reviewer",
  "staffing-monitor",
];

// ---------------------------------------------------------------------------
// Agent roster
// ---------------------------------------------------------------------------

describe("agent roster", () => {
  it("all 8 agents present", () => {
    expect(ALL_AGENTS).toHaveLength(8);
    for (const id of EXPECTED_IDS) {
      expect(agentMap.has(id), `missing ${id}`).toBe(true);
    }
  });

  it("all agents have pack=core", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.pack, `${agent.agent_id}`).toBe("core");
    }
  });

  it("no personal or experimental pack agents in active roster", () => {
    const nonCore = ALL_AGENTS.filter(a => a.pack !== "core");
    expect(nonCore).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Maturity enforcement
// ---------------------------------------------------------------------------

describe("maturity enforcement", () => {
  it("high-stakes agents (orchestrator, contract-reviewer, proposal-engine) use multi planner", () => {
    const highStakes = ALL_AGENTS.filter(a => a.maturity === "high_stakes_manual_gate");
    expect(highStakes.length).toBe(3);
    for (const agent of highStakes) {
      expect(agent.planner_mode, `${agent.agent_id}`).toBe("multi");
    }
  });

  it("trusted_with_review agents require review", () => {
    const reviewed = ALL_AGENTS.filter(a => a.maturity === "trusted_with_review");
    for (const agent of reviewed) {
      expect(agent.review_required, `${agent.agent_id}`).toBe(true);
    }
  });

  it("operational agents do not require review", () => {
    const operational = ALL_AGENTS.filter(a => a.maturity === "operational");
    for (const agent of operational) {
      expect(agent.review_required, `${agent.agent_id}`).toBeFalsy();
    }
  });
});

// ---------------------------------------------------------------------------
// Workflow alignment (V1_WORKFLOWS reference legacy agent IDs — these tests
// validate the workflow structure, not the agent bindings)
// ---------------------------------------------------------------------------

describe("workflow definitions", () => {
  it('all V1_WORKFLOWS have pack "core"', () => {
    for (const wf of V1_WORKFLOWS) {
      expect(wf.pack, `${wf.workflow_id}`).toBe("core");
    }
  });

  it("each workflow has at least one agent_id", () => {
    for (const wf of V1_WORKFLOWS) {
      expect(wf.agent_ids.length, `${wf.workflow_id}`).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Starter packs
// ---------------------------------------------------------------------------

describe("starter pack consistency", () => {
  it("automotive-consulting pack enables all 8 agents", () => {
    const pack = STARTER_PACKS.find(p => p.pack_id === "automotive-consulting");
    expect(pack).toBeDefined();
    expect(pack!.enabled_agents).toHaveLength(8);
    for (const id of EXPECTED_IDS) {
      expect(pack!.enabled_agents).toContain(id);
    }
  });

  it("development pack enables all 8 agents", () => {
    const pack = STARTER_PACKS.find(p => p.pack_id === "development");
    expect(pack).toBeDefined();
    expect(pack!.enabled_agents).toHaveLength(8);
  });

  it("all starter pack agents exist in active roster", () => {
    for (const pack of STARTER_PACKS) {
      for (const id of pack.enabled_agents) {
        expect(agentMap.has(id), `${pack.pack_id} references unknown ${id}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-agent knowledge flow
// ---------------------------------------------------------------------------

describe("knowledge flow coherence", () => {
  it("regulatory-watch feeds the regulatory collection", () => {
    expect(agentMap.get("regulatory-watch")!.knowledge_collections).toContain("regulatory");
  });

  it("evidence-auditor, contract-reviewer, and proposal-engine consume regulatory", () => {
    for (const id of ["evidence-auditor", "contract-reviewer", "proposal-engine"]) {
      expect(agentMap.get(id)!.knowledge_collections, id).toContain("regulatory");
    }
  });

  it("knowledge-curator owns the most collections", () => {
    const curator = agentMap.get("knowledge-curator")!;
    for (const agent of ALL_AGENTS) {
      expect(curator.knowledge_collections.length)
        .toBeGreaterThanOrEqual(agent.knowledge_collections.length);
    }
  });

  it("self-reflection uses the lessons collection", () => {
    expect(agentMap.get("self-reflection")!.knowledge_collections).toContain("lessons");
  });
});
