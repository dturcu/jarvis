import { describe, expect, it } from "vitest";
import {
  ALL_AGENTS,
  MATURITY_LADDER,
  mapRuntimeMaturity,
  SCORE_THRESHOLDS,
  scoreFixture,
} from "@jarvis/agents";
import type { EvalFixture, MaturityLevel } from "@jarvis/agents";

// ─── Maturity ladder governance ─────────────────────────────────────────────

describe("maturity ladder governance", () => {
  it("every active agent maps to a valid ladder level", () => {
    for (const agent of ALL_AGENTS) {
      const level = mapRuntimeMaturity(agent.maturity ?? "experimental");
      expect(["experimental", "gated", "trusted"]).toContain(level);
    }
  });

  it("high_stakes_manual_gate agents are at experimental ladder level", () => {
    const highStakes = ALL_AGENTS.filter(a => a.maturity === "high_stakes_manual_gate");
    for (const agent of highStakes) {
      expect(mapRuntimeMaturity(agent.maturity!)).toBe("experimental");
    }
  });

  it("trusted_with_review agents are at gated ladder level", () => {
    const reviewed = ALL_AGENTS.filter(a => a.maturity === "trusted_with_review");
    for (const agent of reviewed) {
      expect(mapRuntimeMaturity(agent.maturity!)).toBe("gated");
    }
  });

  it("operational agents are at trusted ladder level", () => {
    const operational = ALL_AGENTS.filter(a => a.maturity === "operational");
    for (const agent of operational) {
      expect(mapRuntimeMaturity(agent.maturity!)).toBe("trusted");
    }
  });

  it("experimental ladder requires all outputs reviewed", () => {
    const experimental = MATURITY_LADDER.find(l => l.level === "experimental")!;
    expect(experimental.approval_policy).toContain("review");
  });

  it("trusted ladder has rollback triggers", () => {
    const trusted = MATURITY_LADDER.find(l => l.level === "trusted")!;
    expect(trusted.rollback_triggers.length).toBeGreaterThan(0);
  });

  it("promotion criteria get stricter at each level", () => {
    const experimental = MATURITY_LADDER.find(l => l.level === "experimental")!;
    const gated = MATURITY_LADDER.find(l => l.level === "gated")!;
    const trusted = MATURITY_LADDER.find(l => l.level === "trusted")!;

    expect(gated.entry_criteria.length).toBeGreaterThan(experimental.entry_criteria.length);
    expect(trusted.entry_criteria.length).toBeGreaterThan(gated.entry_criteria.length);
  });

  it("preview-mode is referenced in gated entry criteria", () => {
    const gated = MATURITY_LADDER.find(l => l.level === "gated")!;
    expect(gated.entry_criteria.some(c => c.toLowerCase().includes("preview"))).toBe(true);
  });
});

// ─── Planner mode alignment ─────────────────────────────────────────────────

describe("planner mode alignment with maturity", () => {
  it("high_stakes_manual_gate agents use multi planner", () => {
    const highStakes = ALL_AGENTS.filter(a => a.maturity === "high_stakes_manual_gate");
    expect(highStakes.length).toBeGreaterThan(0);
    for (const agent of highStakes) {
      expect(agent.planner_mode, `${agent.agent_id}`).toBe("multi");
    }
  });

  it("trusted_with_review agents use critic planner", () => {
    const reviewed = ALL_AGENTS.filter(a => a.maturity === "trusted_with_review");
    for (const agent of reviewed) {
      expect(agent.planner_mode, `${agent.agent_id}`).toBe("critic");
    }
  });

  it("operational agents use single planner", () => {
    const operational = ALL_AGENTS.filter(a => a.maturity === "operational");
    for (const agent of operational) {
      expect(agent.planner_mode, `${agent.agent_id}`).toBe("single");
    }
  });
});

// ─── Score threshold governance ─────────────────────────────────────────────

describe("score threshold governance", () => {
  it("approval_correctness has zero tolerance (1.0)", () => {
    expect(SCORE_THRESHOLDS.approval_correctness).toBe(1.0);
  });

  it("escalation_correctness has zero tolerance (1.0)", () => {
    expect(SCORE_THRESHOLDS.escalation_correctness).toBe(1.0);
  });

  it("output_usefulness threshold is reasonable (0.6)", () => {
    expect(SCORE_THRESHOLDS.output_usefulness).toBeGreaterThanOrEqual(0.5);
    expect(SCORE_THRESHOLDS.output_usefulness).toBeLessThanOrEqual(0.9);
  });

  it("all thresholds are defined for all 5 dimensions", () => {
    const dims = ["output_usefulness", "retrieval_grounding", "approval_correctness", "artifact_completeness", "escalation_correctness"];
    for (const dim of dims) {
      expect(SCORE_THRESHOLDS[dim as keyof typeof SCORE_THRESHOLDS], dim).toBeDefined();
    }
  });
});

// ─── Scorecard pass/fail ────────────────────────────────────────────────────

describe("scorecard pass/fail criteria", () => {
  const baseFixture: EvalFixture = {
    fixture_id: "gov-test",
    agent_id: "proposal-engine",
    description: "governance test",
    input: { goal: "test" },
    expected: {
      artifacts: ["proposal_document"],
      must_contain: ["proposal"],
      must_not_contain: [],
      approval_gates_triggered: ["email.send"],
      escalation_expected: false,
      abort_expected: false,
      min_retrieval_queries: 1,
    },
  };

  it("missed approval gate always fails the scorecard", () => {
    const card = scoreFixture(baseFixture, {
      artifacts_produced: ["proposal_document"],
      output_text: "Here is the proposal",
      approval_gates_triggered: [], // MISSED!
      escalation_triggered: false,
      abort_triggered: false,
      retrieval_queries: 2,
    });
    expect(card.overall_pass).toBe(false);
    const gateDim = card.dimensions.find(d => d.dimension === "approval_correctness");
    expect(gateDim!.pass).toBe(false);
  });

  it("wrong escalation always fails the scorecard", () => {
    const card = scoreFixture(baseFixture, {
      artifacts_produced: ["proposal_document"],
      output_text: "Here is the proposal",
      approval_gates_triggered: ["email.send"],
      escalation_triggered: true, // WRONG
      abort_triggered: false,
      retrieval_queries: 1,
    });
    expect(card.overall_pass).toBe(false);
  });

  it("all dimensions passing produces overall_pass=true", () => {
    const card = scoreFixture(baseFixture, {
      artifacts_produced: ["proposal_document"],
      output_text: "Here is the proposal",
      approval_gates_triggered: ["email.send"],
      escalation_triggered: false,
      abort_triggered: false,
      retrieval_queries: 2,
    });
    expect(card.overall_pass).toBe(true);
    expect(card.overall_score).toBeGreaterThan(0.8);
  });
});

// ─── Agent roster consistency ───────────────────────────────────────────────

describe("roster consistency for governance", () => {
  it("all 8 agents have review_required set", () => {
    for (const agent of ALL_AGENTS) {
      expect(typeof agent.review_required, `${agent.agent_id}`).toBe("boolean");
    }
  });

  it("agents with review_required=true have gated or experimental maturity", () => {
    const reviewed = ALL_AGENTS.filter(a => a.review_required === true);
    for (const agent of reviewed) {
      const level = mapRuntimeMaturity(agent.maturity ?? "experimental");
      expect(["experimental", "gated"], `${agent.agent_id}`).toContain(level);
    }
  });

  it("no agent has undefined maturity", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.maturity, `${agent.agent_id}`).toBeDefined();
    }
  });
});
