import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_AGENTS,
  scoreFixture,
  SCORE_THRESHOLDS,
  MATURITY_LADDER,
  mapRuntimeMaturity,
} from "@jarvis/agents";
import type { EvalFixture, Scorecard } from "@jarvis/agents";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixtures(agentId: string): EvalFixture[] {
  const path = join(__dirname, "fixtures", `${agentId}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

const AGENT_IDS = ALL_AGENTS.map(a => a.agent_id);

// ---------------------------------------------------------------------------
// Fixture structural validation
// ---------------------------------------------------------------------------

describe("eval fixtures structural validation", () => {
  for (const agentId of AGENT_IDS) {
    describe(`${agentId} fixtures`, () => {
      const fixtures = loadFixtures(agentId);

      it("has at least 5 fixtures", () => {
        expect(fixtures.length).toBeGreaterThanOrEqual(5);
      });

      it("all fixtures have required fields", () => {
        for (const f of fixtures) {
          expect(f.fixture_id, "fixture_id").toBeTruthy();
          expect(f.agent_id, "agent_id").toBe(agentId);
          expect(f.description, "description").toBeTruthy();
          expect(f.input, "input").toBeDefined();
          expect(f.input.goal, "input.goal").toBeTruthy();
          expect(f.expected, "expected").toBeDefined();
          expect(Array.isArray(f.expected.artifacts), "artifacts").toBe(true);
          expect(Array.isArray(f.expected.must_contain), "must_contain").toBe(true);
          expect(Array.isArray(f.expected.must_not_contain), "must_not_contain").toBe(true);
          expect(Array.isArray(f.expected.approval_gates_triggered), "gates").toBe(true);
          expect(typeof f.expected.escalation_expected, "escalation").toBe("boolean");
          expect(typeof f.expected.abort_expected, "abort").toBe("boolean");
          expect(typeof f.expected.min_retrieval_queries, "retrieval").toBe("number");
        }
      });

      it("fixture_ids are unique", () => {
        const ids = fixtures.map(f => f.fixture_id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("has at least one escalation fixture", () => {
        expect(fixtures.some(f => f.expected.escalation_expected)).toBe(true);
      });

      it("has at least one abort fixture", () => {
        expect(fixtures.some(f => f.expected.abort_expected)).toBe(true);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Scorecard scoring function
// ---------------------------------------------------------------------------

describe("scoreFixture", () => {
  const sampleFixture: EvalFixture = {
    fixture_id: "test-001",
    agent_id: "orchestrator",
    description: "test",
    input: { goal: "test" },
    expected: {
      artifacts: ["execution_plan", "execution_log"],
      must_contain: ["plan", "DAG"],
      must_not_contain: ["error"],
      approval_gates_triggered: ["workflow.execute_multi"],
      escalation_expected: false,
      abort_expected: false,
      min_retrieval_queries: 1,
    },
  };

  it("perfect run scores 1.0 across all dimensions", () => {
    const card = scoreFixture(sampleFixture, {
      artifacts_produced: ["execution_plan", "execution_log"],
      output_text: "Here is the plan and the DAG for this workflow",
      approval_gates_triggered: ["workflow.execute_multi"],
      escalation_triggered: false,
      abort_triggered: false,
      retrieval_queries: 2,
    });
    expect(card.overall_pass).toBe(true);
    expect(card.overall_score).toBeGreaterThanOrEqual(0.9);
    for (const dim of card.dimensions) {
      expect(dim.pass, dim.dimension).toBe(true);
    }
  });

  it("missing artifacts fail artifact_completeness", () => {
    const card = scoreFixture(sampleFixture, {
      artifacts_produced: ["execution_plan"],
      output_text: "plan DAG",
      approval_gates_triggered: ["workflow.execute_multi"],
      escalation_triggered: false,
      abort_triggered: false,
      retrieval_queries: 1,
    });
    const artDim = card.dimensions.find(d => d.dimension === "artifact_completeness");
    expect(artDim!.score).toBe(0.5);
    expect(artDim!.pass).toBe(false);
  });

  it("missed approval gate fails approval_correctness", () => {
    const card = scoreFixture(sampleFixture, {
      artifacts_produced: ["execution_plan", "execution_log"],
      output_text: "plan DAG",
      approval_gates_triggered: [],
      escalation_triggered: false,
      abort_triggered: false,
      retrieval_queries: 1,
    });
    const gateDim = card.dimensions.find(d => d.dimension === "approval_correctness");
    expect(gateDim!.pass).toBe(false);
  });

  it("wrong escalation fails escalation_correctness", () => {
    const card = scoreFixture(sampleFixture, {
      artifacts_produced: ["execution_plan", "execution_log"],
      output_text: "plan DAG",
      approval_gates_triggered: ["workflow.execute_multi"],
      escalation_triggered: true,
      abort_triggered: false,
      retrieval_queries: 1,
    });
    const escDim = card.dimensions.find(d => d.dimension === "escalation_correctness");
    expect(escDim!.score).toBe(0.0);
    expect(escDim!.pass).toBe(false);
  });

  it("zero retrieval queries when expected fails grounding", () => {
    const card = scoreFixture(sampleFixture, {
      artifacts_produced: ["execution_plan", "execution_log"],
      output_text: "plan DAG",
      approval_gates_triggered: ["workflow.execute_multi"],
      escalation_triggered: false,
      abort_triggered: false,
      retrieval_queries: 0,
    });
    const retDim = card.dimensions.find(d => d.dimension === "retrieval_grounding");
    expect(retDim!.score).toBe(0.0);
    expect(retDim!.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Maturity ladder
// ---------------------------------------------------------------------------

describe("maturity ladder", () => {
  it("has 3 levels: experimental, gated, trusted", () => {
    expect(MATURITY_LADDER).toHaveLength(3);
    expect(MATURITY_LADDER.map(l => l.level)).toEqual(["experimental", "gated", "trusted"]);
  });

  it("each level has entry criteria", () => {
    for (const level of MATURITY_LADDER) {
      expect(level.entry_criteria.length).toBeGreaterThan(0);
    }
  });

  it("gated and trusted levels have rollback triggers", () => {
    const gated = MATURITY_LADDER.find(l => l.level === "gated")!;
    const trusted = MATURITY_LADDER.find(l => l.level === "trusted")!;
    expect(gated.rollback_triggers.length).toBeGreaterThan(0);
    expect(trusted.rollback_triggers.length).toBeGreaterThan(0);
  });

  it("mapRuntimeMaturity maps correctly", () => {
    expect(mapRuntimeMaturity("experimental")).toBe("experimental");
    expect(mapRuntimeMaturity("high_stakes_manual_gate")).toBe("experimental");
    expect(mapRuntimeMaturity("trusted_with_review")).toBe("gated");
    expect(mapRuntimeMaturity("operational")).toBe("trusted");
    expect(mapRuntimeMaturity("unknown")).toBe("experimental");
  });
});

// ---------------------------------------------------------------------------
// Score thresholds
// ---------------------------------------------------------------------------

describe("score thresholds", () => {
  it("approval_correctness requires 1.0 (zero tolerance)", () => {
    expect(SCORE_THRESHOLDS.approval_correctness).toBe(1.0);
  });

  it("escalation_correctness requires 1.0 (zero tolerance)", () => {
    expect(SCORE_THRESHOLDS.escalation_correctness).toBe(1.0);
  });

  it("all thresholds are between 0 and 1", () => {
    for (const [dim, threshold] of Object.entries(SCORE_THRESHOLDS)) {
      expect(threshold, dim).toBeGreaterThanOrEqual(0);
      expect(threshold, dim).toBeLessThanOrEqual(1);
    }
  });
});
