import { describe, expect, it } from "vitest";
import { selfReflectionAgent, ALL_AGENTS, getAgent } from "@jarvis/agents";

describe("selfReflectionAgent definition", () => {
  it("has correct agent_id", () => {
    expect(selfReflectionAgent.agent_id).toBe("self-reflection");
  });

  it("has a weekly schedule trigger (Sunday 6am)", () => {
    const sched = selfReflectionAgent.triggers.find(t => t.kind === "schedule");
    expect(sched).toBeDefined();
    expect(sched!.cron).toBe("0 6 * * 0");
  });

  it("also supports manual trigger", () => {
    expect(selfReflectionAgent.triggers.some(t => t.kind === "manual")).toBe(true);
  });

  it("uses critic planner mode", () => {
    expect(selfReflectionAgent.planner_mode).toBe("critic");
  });

  it("uses the lessons knowledge collection", () => {
    expect(selfReflectionAgent.knowledge_collections).toContain("lessons");
  });

  it("requires review", () => {
    expect(selfReflectionAgent.review_required).toBe(true);
  });

  it("has no approval gates (read-only analysis)", () => {
    expect(selfReflectionAgent.approval_gates).toHaveLength(0);
  });

  it("system prompt requires minimum 5 proposals", () => {
    expect(selfReflectionAgent.system_prompt).toContain("fewer than 5 proposals");
  });

  it("system prompt includes all 6 proposal categories", () => {
    const categories = [
      "prompt_change", "schema_enhancement", "knowledge_gap",
      "retrieval_miss", "approval_friction", "workflow_optimization",
    ];
    for (const cat of categories) {
      expect(selfReflectionAgent.system_prompt).toContain(cat);
    }
  });

  it("system prompt forbids auto-apply", () => {
    expect(selfReflectionAgent.system_prompt).toContain("Auto-apply changes to production prompts");
  });
});

describe("selfReflectionAgent registry", () => {
  it("is included in ALL_AGENTS", () => {
    expect(ALL_AGENTS.find(a => a.agent_id === "self-reflection")).toBeDefined();
  });

  it("is findable via getAgent()", () => {
    const agent = getAgent("self-reflection");
    expect(agent).toBeDefined();
    expect(agent!.label).toBe("Self-Reflection & Improvement");
  });

  it("ALL_AGENTS has 8 agents", () => {
    expect(ALL_AGENTS).toHaveLength(8);
  });
});
