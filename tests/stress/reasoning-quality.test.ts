/**
 * Stress: Reasoning Quality
 *
 * Tests plan scoring, disagreement detection, plan ranking, and
 * critic assessment with deterministic heuristics (no LLM calls).
 */

import { describe, it, expect } from "vitest";
import type { AgentPlan, PlanStep } from "@jarvis/agent-framework";
import { scorePlan, rankPlans, detectDisagreement } from "@jarvis/runtime";

// ── Test helpers ────────────────────────────────────────────────────────────

function makePlan(params: {
  steps: Array<{ action: string; reasoning?: string }>;
  agentId?: string;
}): AgentPlan {
  return {
    run_id: `run-${Math.random().toString(36).slice(2)}`,
    agent_id: params.agentId ?? "test-agent",
    goal: "Test goal",
    steps: params.steps.map((s, i) => ({
      step: i + 1,
      action: s.action,
      input: { query: `param-${i}` },
      reasoning: s.reasoning ?? `Detailed reasoning for step ${i + 1} that exceeds twenty characters`,
    })),
    created_at: new Date().toISOString(),
  };
}

describe("Reasoning Quality", () => {
  describe("Plan Scoring", () => {
    it("step efficiency: 41-80% of max_steps scores 100", () => {
      const capabilities = ["email", "crm", "web"];

      // 5 steps out of 10 (50%) = sweet spot
      const plan50 = makePlan({
        steps: [
          { action: "email.search" }, { action: "crm.list_pipeline" },
          { action: "web.search_news" }, { action: "email.send" },
          { action: "crm.update" },
        ],
      });
      const score50 = scorePlan(plan50, capabilities, 10);
      expect(score50.breakdown.step_efficiency).toBe(100);

      // 8 steps out of 10 (80%) = still sweet spot
      const plan80 = makePlan({
        steps: Array.from({ length: 8 }, (_, i) => ({
          action: `email.step_${i}`,
        })),
      });
      const score80 = scorePlan(plan80, capabilities, 10);
      expect(score80.breakdown.step_efficiency).toBe(100);
    });

    it("step efficiency: below 40% ramps linearly, above 80% penalizes", () => {
      const caps = ["email"];

      // 1 step out of 10 (10%) — low
      const planLow = makePlan({ steps: [{ action: "email.search" }] });
      const scoreLow = scorePlan(planLow, caps, 10);
      expect(scoreLow.breakdown.step_efficiency).toBeLessThan(30);

      // 10 steps out of 10 (100%) — bloated
      const planHigh = makePlan({
        steps: Array.from({ length: 10 }, (_, i) => ({ action: `email.op_${i}` })),
      });
      const scoreHigh = scorePlan(planHigh, caps, 10);
      expect(scoreHigh.breakdown.step_efficiency).toBeLessThan(60);
    });

    it("capability coverage: all capabilities used = 100", () => {
      const caps = ["email", "crm", "web", "document"];
      const plan = makePlan({
        steps: [
          { action: "email.search" }, { action: "crm.list_pipeline" },
          { action: "web.search_news" }, { action: "document.ingest" },
        ],
      });
      const score = scorePlan(plan, caps, 10);
      expect(score.breakdown.capability_coverage).toBe(100);
    });

    it("capability coverage: partial usage scores proportionally", () => {
      const caps = ["email", "crm", "web", "document"];
      const plan = makePlan({
        steps: [{ action: "email.search" }, { action: "crm.list_pipeline" }],
      });
      const score = scorePlan(plan, caps, 10);
      expect(score.breakdown.capability_coverage).toBe(50);
    });

    it("capability coverage: no capabilities declared = 100", () => {
      const plan = makePlan({ steps: [{ action: "email.search" }] });
      const score = scorePlan(plan, [], 10);
      expect(score.breakdown.capability_coverage).toBe(100);
    });

    it("action diversity: all unique = 100, all same < 100", () => {
      const caps = ["email"];

      // All unique
      const uniquePlan = makePlan({
        steps: [
          { action: "email.search" }, { action: "email.read" },
          { action: "email.draft" }, { action: "email.send" },
        ],
      });
      const uniqueScore = scorePlan(uniquePlan, caps, 10);
      expect(uniqueScore.breakdown.action_diversity).toBe(100);

      // All same
      const samePlan = makePlan({
        steps: [
          { action: "email.search" }, { action: "email.search" },
          { action: "email.search" }, { action: "email.search" },
        ],
      });
      const sameScore = scorePlan(samePlan, caps, 10);
      expect(sameScore.breakdown.action_diversity).toBe(25);
    });

    it("reasoning quality: >20 chars = good, <=20 chars = bad", () => {
      const caps = ["email"];

      // All good reasoning
      const goodPlan = makePlan({
        steps: [
          { action: "email.search", reasoning: "Search for recent client communications about the proposal" },
          { action: "email.read", reasoning: "Read the latest email thread to understand client requirements" },
        ],
      });
      const goodScore = scorePlan(goodPlan, caps, 10);
      expect(goodScore.breakdown.reasoning_quality).toBe(100);

      // All bad reasoning
      const badPlan = makePlan({
        steps: [
          { action: "email.search", reasoning: "search" },
          { action: "email.read", reasoning: "read it" },
        ],
      });
      const badScore = scorePlan(badPlan, caps, 10);
      expect(badScore.breakdown.reasoning_quality).toBe(0);
    });

    it("empty plan scores 0", () => {
      const plan = makePlan({ steps: [] });
      const score = scorePlan(plan, ["email", "crm"], 10);
      expect(score.total).toBe(0);
      expect(score.breakdown.step_efficiency).toBe(0);
      expect(score.breakdown.action_diversity).toBe(0);
      expect(score.breakdown.reasoning_quality).toBe(0);
    });
  });

  describe("Disagreement Detection", () => {
    it("single plan = no disagreement", () => {
      const plan = makePlan({
        steps: [{ action: "email.search" }, { action: "crm.update" }],
      });
      const result = detectDisagreement([plan]);
      expect(result.disagreement).toBe(false);
      expect(result.reason).toBe("single_plan");
    });

    it("similar plans = no disagreement", () => {
      const plan1 = makePlan({
        steps: [{ action: "email.search" }, { action: "crm.update" }, { action: "email.send" }],
      });
      const plan2 = makePlan({
        steps: [{ action: "email.search" }, { action: "crm.update" }, { action: "email.draft" }],
      });
      const result = detectDisagreement([plan1, plan2]);
      // 4 total actions, 2 unique (email.send, email.draft) = 50% > 30% threshold
      // So use truly overlapping plans
      const plan3 = makePlan({
        steps: [{ action: "email.search" }, { action: "crm.update" }, { action: "email.send" }],
      });
      const plan4 = makePlan({
        steps: [{ action: "email.search" }, { action: "crm.update" }, { action: "email.send" }],
      });
      const result2 = detectDisagreement([plan3, plan4]);
      expect(result2.disagreement).toBe(false);
      expect(result2.reason).toBe("plans_agree");
    });

    it("step count >50% difference = scope disagreement", () => {
      const shortPlan = makePlan({
        steps: [{ action: "email.search" }, { action: "email.send" }],
      });
      const longPlan = makePlan({
        steps: [
          { action: "email.search" }, { action: "email.read" },
          { action: "email.draft" }, { action: "email.send" },
        ],
      });
      const result = detectDisagreement([shortPlan, longPlan]);
      expect(result.disagreement).toBe(true);
      expect(result.details.step_count_range).toEqual([2, 4]);
    });

    it(">30% unique actions = action disagreement", () => {
      const plan1 = makePlan({
        steps: [
          { action: "email.search" }, { action: "crm.update" }, { action: "email.send" },
        ],
      });
      const plan2 = makePlan({
        steps: [
          { action: "web.search_news" }, { action: "document.ingest" }, { action: "inference.chat" },
        ],
      });
      const result = detectDisagreement([plan1, plan2]);
      expect(result.disagreement).toBe(true);
      expect(result.details.unique_actions.length).toBeGreaterThan(0);
    });

    it("both step count and action disagreement", () => {
      const plan1 = makePlan({
        steps: [{ action: "email.search" }],
      });
      const plan2 = makePlan({
        steps: [
          { action: "web.search_news" }, { action: "document.ingest" },
          { action: "crm.update" }, { action: "inference.chat" },
        ],
      });
      const result = detectDisagreement([plan1, plan2]);
      expect(result.disagreement).toBe(true);
      expect(result.reason).toBe("plans_differ_substantially_in_structure_and_actions");
    });

    it("three plans with mixed agreement", () => {
      const pragmatic = makePlan({
        steps: [{ action: "email.search" }, { action: "email.send" }],
      });
      const thorough = makePlan({
        steps: [
          { action: "email.search" }, { action: "crm.list_pipeline" },
          { action: "email.draft" }, { action: "email.send" },
        ],
      });
      const creative = makePlan({
        steps: [
          { action: "web.search_news" }, { action: "inference.chat" },
          { action: "email.draft" }, { action: "email.send" },
          { action: "crm.update" },
        ],
      });
      const result = detectDisagreement([pragmatic, thorough, creative]);
      expect(result.disagreement).toBe(true);
    });
  });

  describe("Plan Ranking", () => {
    it("higher coverage + efficiency wins", () => {
      const caps = ["email", "crm", "web", "document"];

      const balanced = makePlan({
        steps: [
          { action: "email.search" }, { action: "crm.list_pipeline" },
          { action: "web.search_news" }, { action: "document.ingest" },
        ],
      });

      const narrow = makePlan({
        steps: [{ action: "email.search" }, { action: "email.read" }],
      });

      const bloated = makePlan({
        steps: Array.from({ length: 10 }, (_, i) => ({ action: `email.op_${i}` })),
      });

      const scores = rankPlans([balanced, narrow, bloated], caps, 10);

      // Balanced should rank first (best coverage + good efficiency)
      expect(scores[0].plan_index).toBe(0);
      expect(scores[0].total).toBeGreaterThan(scores[1].total);
      expect(scores[0].total).toBeGreaterThan(scores[2].total);
    });

    it("ranking is stable across multiple calls", () => {
      const caps = ["email", "crm"];
      const plans = [
        makePlan({ steps: [{ action: "email.search" }, { action: "crm.update" }] }),
        makePlan({ steps: [{ action: "email.search" }] }),
        makePlan({
          steps: [
            { action: "email.search" }, { action: "email.read" },
            { action: "crm.update" }, { action: "crm.list_pipeline" },
          ],
        }),
      ];

      const results: number[][] = [];
      for (let i = 0; i < 50; i++) {
        const scores = rankPlans(plans, caps, 10);
        results.push(scores.map((s) => s.plan_index));
      }

      // All 50 rankings should be identical
      const first = JSON.stringify(results[0]);
      for (const r of results) {
        expect(JSON.stringify(r)).toBe(first);
      }
    });
  });

  describe("Plan Evaluator Determinism", () => {
    it("score same plan 100 times yields identical results", () => {
      const caps = ["email", "crm", "web"];
      const plan = makePlan({
        steps: [
          { action: "email.search", reasoning: "Search for recent client emails about ISO 26262 compliance" },
          { action: "crm.list_pipeline", reasoning: "Check current pipeline status for qualified leads" },
          { action: "web.search_news", reasoning: "Monitor automotive safety industry news and trends" },
          { action: "email.draft", reasoning: "Draft outreach email based on pipeline and news analysis" },
        ],
      });

      const scores: number[] = [];
      for (let i = 0; i < 100; i++) {
        const score = scorePlan(plan, caps, 10);
        scores.push(score.total);
      }

      // All 100 scores must be identical
      const first = scores[0];
      expect(scores.every((s) => s === first)).toBe(true);
    });
  });
});
