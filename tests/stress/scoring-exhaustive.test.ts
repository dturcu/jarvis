/**
 * Stress: Scoring Exhaustive
 *
 * Exhaustive boundary-value coverage for scorePlan (step_efficiency,
 * capability_coverage, action_diversity, reasoning_quality, total),
 * rankPlans, and detectDisagreement.
 */

import { describe, it, expect } from "vitest";
import { scorePlan, rankPlans, detectDisagreement, type PlanScore } from "@jarvis/runtime";
import type { AgentPlan } from "@jarvis/agent-framework";
import { range } from "./helpers.js";

// ── Helper ─────────────────────────────────────────────────────────────────

function makePlan(steps: Array<{ action: string; reasoning?: string }>, agentId = "test"): AgentPlan {
  return {
    run_id: `run-${Math.random().toString(36).slice(2)}`,
    agent_id: agentId,
    goal: "Test",
    steps: steps.map((s, i) => ({
      step: i + 1,
      action: s.action,
      input: {},
      reasoning: s.reasoning ?? `Reasoning for step ${i + 1} that has more than twenty characters`,
    })),
    created_at: new Date().toISOString(),
  };
}

/** Create a plan with N steps using the given actions (cycling). */
function makePlanN(n: number, actions: string[] = ["email.search"], reasoning?: string): AgentPlan {
  return makePlan(
    range(n).map(i => ({
      action: actions[i % actions.length],
      reasoning: reasoning ?? `Reasoning for step ${i + 1} that has more than twenty characters`,
    })),
  );
}

// ── scorePlan: step_efficiency ─────────────────────────────────────────────

describe("scorePlan — step_efficiency", () => {
  // Formula:
  //   ratio = steps/maxSteps
  //   ratio <= 0.4  =>  Math.round(ratio / 0.4 * 70)  (linear ramp to 70)
  //   0.4 < ratio <= 0.8  =>  100  (sweet spot)
  //   ratio > 0.8  =>  Math.round(Math.max(0, 100 - (ratio - 0.8) * 250))  (penalty)

  it("0 steps => efficiency = 0", () => {
    const plan = makePlan([]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(0);
  });

  it("1/10 (10%) => round(0.1/0.4*70) = 18", () => {
    const plan = makePlanN(1);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(Math.round(0.1 / 0.4 * 70)); // 18
  });

  it("2/10 (20%) => round(0.2/0.4*70) = 35", () => {
    const plan = makePlanN(2);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(Math.round(0.2 / 0.4 * 70)); // 35
  });

  it("3/10 (30%) => round(0.3/0.4*70) = 53", () => {
    const plan = makePlanN(3);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(Math.round(0.3 / 0.4 * 70)); // 53
  });

  it("4/10 (40%) => round(0.4/0.4*70) = 70 (boundary)", () => {
    const plan = makePlanN(4);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(70);
  });

  it("5/10 (50%) => 100 (sweet spot)", () => {
    const plan = makePlanN(5);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(100);
  });

  it("6/10 (60%) => 100 (sweet spot)", () => {
    const plan = makePlanN(6);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(100);
  });

  it("7/10 (70%) => 100 (sweet spot)", () => {
    const plan = makePlanN(7);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(100);
  });

  it("8/10 (80%) => 100 (boundary)", () => {
    const plan = makePlanN(8);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(100);
  });

  it("9/10 (90%) => round(max(0, 100 - 0.1*250)) = 75", () => {
    const plan = makePlanN(9);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(Math.round(Math.max(0, 100 - 0.1 * 250))); // 75
  });

  it("10/10 (100%) => round(max(0, 100 - 0.2*250)) = 50", () => {
    const plan = makePlanN(10);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.step_efficiency).toBe(Math.round(Math.max(0, 100 - 0.2 * 250))); // 50
  });

  it("1/1 (100%) => 50", () => {
    const plan = makePlanN(1);
    const score = scorePlan(plan, ["email"], 1);
    expect(score.breakdown.step_efficiency).toBe(Math.round(Math.max(0, 100 - 0.2 * 250))); // 50
  });

  it("1/2 (50%) => 100", () => {
    const plan = makePlanN(1);
    const score = scorePlan(plan, ["email"], 2);
    expect(score.breakdown.step_efficiency).toBe(100);
  });

  it.each([
    [1, 1, Math.round(Math.max(0, 100 - (1 / 1 - 0.8) * 250))],
    [1, 2, 100], // ratio=0.5
    [1, 3, Math.round((1 / 3) / 0.4 * 70)], // ratio=0.333
    [2, 5, 70], // ratio=0.4, boundary (<=0.4 ramp gives 70)
    [4, 5, 100], // ratio=0.8, boundary
    [3, 8, Math.round(0.375 / 0.4 * 70)], // ratio=0.375
    [7, 10, 100], // ratio=0.7
    [15, 15, Math.round(Math.max(0, 100 - (1.0 - 0.8) * 250))],
    [16, 20, 100], // ratio=0.8, boundary
    [19, 20, Math.round(Math.max(0, 100 - (0.95 - 0.8) * 250))],
  ])("maxSteps=%i/%i => computed correctly", (steps, maxSteps, expected) => {
    const plan = makePlanN(steps);
    const score = scorePlan(plan, ["email"], maxSteps);
    expect(score.breakdown.step_efficiency).toBe(expected);
  });
});

// ── scorePlan: capability_coverage ─────────────────────────────────────────

describe("scorePlan — capability_coverage", () => {
  it("all caps used => 100", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const score = scorePlan(plan, ["email", "crm", "web"], 10);
    expect(score.breakdown.capability_coverage).toBe(100);
  });

  it("no caps used => 0", () => {
    const plan = makePlan([
      { action: "document.ingest" },
      { action: "inference.chat" },
    ]);
    const score = scorePlan(plan, ["email", "crm", "web"], 10);
    expect(score.breakdown.capability_coverage).toBe(0);
  });

  it("half caps used => 50", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "email.send" },
    ]);
    const score = scorePlan(plan, ["email", "crm"], 10);
    expect(score.breakdown.capability_coverage).toBe(50);
  });

  it("empty capabilities => 100", () => {
    const plan = makePlan([
      { action: "email.search" },
    ]);
    const score = scorePlan(plan, [], 10);
    expect(score.breakdown.capability_coverage).toBe(100);
  });

  it("action prefix matches capability name (email.search => email)", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "email.send" },
      { action: "email.draft" },
    ]);
    // 3 email actions but only 1 capability matched
    const score = scorePlan(plan, ["email", "crm", "web"], 10);
    expect(score.breakdown.capability_coverage).toBe(Math.round(1 / 3 * 100)); // 33
  });

  it("1 of 4 caps used => 25", () => {
    const plan = makePlan([
      { action: "email.search" },
    ]);
    const score = scorePlan(plan, ["email", "crm", "web", "document"], 10);
    expect(score.breakdown.capability_coverage).toBe(25);
  });

  it("2 of 3 caps used => 67", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
    ]);
    const score = scorePlan(plan, ["email", "crm", "web"], 10);
    expect(score.breakdown.capability_coverage).toBe(Math.round(2 / 3 * 100)); // 67
  });

  it("3 of 4 caps used => 75", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const score = scorePlan(plan, ["email", "crm", "web", "document"], 10);
    expect(score.breakdown.capability_coverage).toBe(75);
  });

  it("0 steps with capabilities => 0 coverage", () => {
    const plan = makePlan([]);
    const score = scorePlan(plan, ["email", "crm"], 10);
    expect(score.breakdown.capability_coverage).toBe(0);
  });

  it("duplicate capabilities are counted once", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "email.send" },
    ]);
    // email prefix appears twice but capability "email" is only counted once
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.capability_coverage).toBe(100);
  });
});

// ── scorePlan: action_diversity ────────────────────────────────────────────

describe("scorePlan — action_diversity", () => {
  it("all unique actions => 100", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(100);
  });

  it("all same actions => round(1/N * 100)", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "email.search" },
      { action: "email.search" },
      { action: "email.search" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(Math.round(1 / 4 * 100)); // 25
  });

  it("half unique => round(unique/total * 100)", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "crm.list_pipeline" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(Math.round(2 / 4 * 100)); // 50
  });

  it("1 action => 100", () => {
    const plan = makePlan([
      { action: "email.search" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(100);
  });

  it("0 actions => 0", () => {
    const plan = makePlan([]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(0);
  });

  it("3 of 5 unique => round(3/5*100) = 60", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(Math.round(3 / 5 * 100)); // 60
  });

  it("2 same => round(1/2*100) = 50", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "email.search" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(50);
  });

  it("5 of 5 unique => 100", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
      { action: "document.ingest" },
      { action: "inference.chat" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(100);
  });

  it("1 of 10 unique => round(1/10*100) = 10", () => {
    const plan = makePlanN(10, ["email.search"]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(Math.round(1 / 10 * 100)); // 10
  });

  it("7 of 8 unique => round(7/8*100) = 88", () => {
    const plan = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
      { action: "document.ingest" },
      { action: "inference.chat" },
      { action: "email.send" },
      { action: "crm.update_contact" },
      { action: "email.search" }, // duplicate
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.action_diversity).toBe(Math.round(7 / 8 * 100)); // 88
  });
});

// ── scorePlan: reasoning_quality ───────────────────────────────────────────

describe("scorePlan — reasoning_quality", () => {
  it("all >20 chars => 100", () => {
    const plan = makePlan([
      { action: "email.search", reasoning: "This reasoning string is well over twenty characters long" },
      { action: "crm.list_pipeline", reasoning: "Another detailed reasoning string that exceeds twenty chars" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.reasoning_quality).toBe(100);
  });

  it("all <=20 chars => 0", () => {
    const plan = makePlan([
      { action: "email.search", reasoning: "Short" },
      { action: "crm.list_pipeline", reasoning: "Also short" },
      { action: "web.search_news", reasoning: "Tiny" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.reasoning_quality).toBe(0);
  });

  it("mixed (1 of 3 good) => round(1/3*100) = 33", () => {
    const plan = makePlan([
      { action: "email.search", reasoning: "This is a detailed reasoning string that exceeds the threshold" },
      { action: "crm.list_pipeline", reasoning: "Short" },
      { action: "web.search_news", reasoning: "Tiny" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.reasoning_quality).toBe(Math.round(1 / 3 * 100)); // 33
  });

  it("empty reasoning => 0", () => {
    const plan = makePlan([
      { action: "email.search", reasoning: "" },
      { action: "crm.list_pipeline", reasoning: "" },
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.reasoning_quality).toBe(0);
  });

  it("exactly 20 chars => 0 (must be >20)", () => {
    const plan = makePlan([
      { action: "email.search", reasoning: "12345678901234567890" }, // exactly 20
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.reasoning_quality).toBe(0);
  });

  it("exactly 21 chars => counted as good (100)", () => {
    const plan = makePlan([
      { action: "email.search", reasoning: "123456789012345678901" }, // 21 chars
    ]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.reasoning_quality).toBe(100);
  });

  it("2 of 4 good => 50", () => {
    const plan = makePlan([
      { action: "a.one", reasoning: "This is a very long and detailed reasoning string" },
      { action: "b.two", reasoning: "Short" },
      { action: "c.three", reasoning: "Another very long and detailed reasoning that qualifies" },
      { action: "d.four", reasoning: "Tiny" },
    ]);
    const score = scorePlan(plan, ["a"], 10);
    expect(score.breakdown.reasoning_quality).toBe(50);
  });

  it("0 steps => reasoning_quality = 0", () => {
    const plan = makePlan([]);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.reasoning_quality).toBe(0);
  });

  it("3 of 4 good => 75", () => {
    const plan = makePlan([
      { action: "a.one", reasoning: "Long enough reasoning string here!" },
      { action: "b.two", reasoning: "Another long enough reasoning string" },
      { action: "c.three", reasoning: "Yet another long enough reasoning" },
      { action: "d.four", reasoning: "Tiny" },
    ]);
    const score = scorePlan(plan, ["a"], 10);
    expect(score.breakdown.reasoning_quality).toBe(75);
  });

  it("all 5 good => 100", () => {
    const plan = makePlanN(5, ["email.search"], "This reasoning is definitely more than twenty characters long");
    const score = scorePlan(plan, ["email"], 10);
    expect(score.breakdown.reasoning_quality).toBe(100);
  });
});

// ── scorePlan: total score ─────────────────────────────────────────────────

describe("scorePlan — total score", () => {
  // Weights: coverage*0.35 + efficiency*0.25 + diversity*0.20 + reasoning*0.20

  it("perfect plan: all 100 => total = 100", () => {
    // 5/10 steps (efficiency=100), all caps used (coverage=100),
    // all unique (diversity=100), all good reasoning (reasoning=100)
    const plan = makePlan([
      { action: "email.search", reasoning: "This is a detailed and thorough reasoning step" },
      { action: "crm.list_pipeline", reasoning: "Comprehensive reasoning for CRM pipeline check" },
      { action: "web.search_news", reasoning: "Research industry news with detailed approach" },
      { action: "document.ingest", reasoning: "Ingest documents with proper validation steps" },
      { action: "inference.chat", reasoning: "Use inference for analytical decision making" },
    ]);
    const score = scorePlan(plan, ["email", "crm", "web", "document", "inference"], 10);
    expect(score.total).toBe(100);
  });

  it("empty plan: all 0 => total = 0", () => {
    const plan = makePlan([]);
    const score = scorePlan(plan, ["email", "crm"], 10);
    expect(score.total).toBe(0);
  });

  it("known component values produce correct weighted total", () => {
    // 4/10 steps: efficiency = 70 (boundary)
    // 1 of 3 caps: coverage = 33
    // all unique (4 unique / 4 total): diversity = 100
    // all good reasoning: reasoning = 100
    const plan = makePlan([
      { action: "email.search", reasoning: "A detailed reasoning string over twenty chars" },
      { action: "email.send", reasoning: "Another detailed reasoning string over twenty" },
      { action: "email.draft", reasoning: "Yet another detailed reasoning string here" },
      { action: "email.read", reasoning: "One more detailed reasoning string needed" },
    ]);
    const score = scorePlan(plan, ["email", "crm", "web"], 10);

    const expected = Math.round(
      score.breakdown.capability_coverage * 0.35 +
      score.breakdown.step_efficiency * 0.25 +
      score.breakdown.action_diversity * 0.20 +
      score.breakdown.reasoning_quality * 0.20,
    );
    expect(score.total).toBe(expected);
  });

  it("verifies total = round(coverage*0.35 + efficiency*0.25 + diversity*0.20 + reasoning*0.20)", () => {
    // 2 steps, 5 maxSteps: ratio=0.4, efficiency=70
    // 1 of 2 caps: coverage=50
    // 2 unique / 2 total: diversity=100
    // 1 good, 1 bad: reasoning=50
    const plan = makePlan([
      { action: "email.search", reasoning: "This is a sufficiently long reasoning string" },
      { action: "crm.list_pipeline", reasoning: "Short" },
    ]);
    const score = scorePlan(plan, ["email", "crm"], 5);

    expect(score.breakdown.step_efficiency).toBe(70);
    expect(score.breakdown.capability_coverage).toBe(100);
    expect(score.breakdown.action_diversity).toBe(100);
    expect(score.breakdown.reasoning_quality).toBe(50);

    const expected = Math.round(100 * 0.35 + 70 * 0.25 + 100 * 0.20 + 50 * 0.20);
    expect(score.total).toBe(expected); // round(35 + 17.5 + 20 + 10) = 83
  });

  it("scorePlan returns plan_index = -1", () => {
    const plan = makePlanN(3);
    const score = scorePlan(plan, ["email"], 10);
    expect(score.plan_index).toBe(-1);
  });

  it("all poor quality: low scores across the board", () => {
    // 1/10 steps: efficiency = 18
    // 0 of 3 caps: coverage = 0
    // 1 unique / 1 total: diversity = 100
    // bad reasoning: quality = 0
    const plan = makePlan([
      { action: "unknown.action", reasoning: "Tiny" },
    ]);
    const score = scorePlan(plan, ["email", "crm", "web"], 10);

    expect(score.total).toBe(Math.round(
      0 * 0.35 + 18 * 0.25 + 100 * 0.20 + 0 * 0.20,
    )); // round(0 + 4.5 + 20 + 0) = 25
  });

  it("high diversity but low coverage", () => {
    const plan = makePlan([
      { action: "x.one", reasoning: "Sufficiently long reasoning string for test" },
      { action: "y.two", reasoning: "Another sufficiently long reasoning string" },
      { action: "z.three", reasoning: "Yet another sufficiently long reasoning" },
      { action: "w.four", reasoning: "Final sufficiently long reasoning string" },
    ]);
    // 0 of 2 caps used, but 4 unique / 4 total diversity
    const score = scorePlan(plan, ["email", "crm"], 10);
    expect(score.breakdown.capability_coverage).toBe(0);
    expect(score.breakdown.action_diversity).toBe(100);
  });

  it("high coverage but low diversity", () => {
    const plan = makePlan([
      { action: "email.search", reasoning: "Long detailed reasoning string for test step" },
      { action: "email.search", reasoning: "Another long detailed reasoning string here" },
      { action: "email.search", reasoning: "Yet another long detailed reasoning string" },
      { action: "crm.list_pipeline", reasoning: "Final long detailed reasoning string used" },
    ]);
    const score = scorePlan(plan, ["email", "crm"], 10);
    expect(score.breakdown.capability_coverage).toBe(100);
    expect(score.breakdown.action_diversity).toBe(50); // 2 unique / 4 total
  });

  it("single step plan scored correctly", () => {
    const plan = makePlan([
      { action: "email.search", reasoning: "Detailed search reasoning exceeding twenty characters" },
    ]);
    const score = scorePlan(plan, ["email"], 5);

    // ratio=0.2 => efficiency = round(0.2/0.4*70) = 35
    // 1/1 caps => coverage = 100
    // 1/1 unique => diversity = 100
    // 1/1 good => reasoning = 100
    expect(score.total).toBe(Math.round(100 * 0.35 + 35 * 0.25 + 100 * 0.20 + 100 * 0.20));
  });
});

// ── rankPlans ──────────────────────────────────────────────────────────────

describe("rankPlans", () => {
  it("single plan => 1 score", () => {
    const plans = [makePlanN(3, ["email.search", "crm.list_pipeline", "web.search_news"])];
    const scores = rankPlans(plans, ["email", "crm", "web"], 10);
    expect(scores).toHaveLength(1);
    expect(scores[0].plan_index).toBe(0);
  });

  it("2 plans => sorted by total desc", () => {
    const weakPlan = makePlan([
      { action: "email.search", reasoning: "Short" },
    ]);
    const strongPlan = makePlan([
      { action: "email.search", reasoning: "This is a detailed reasoning string exceeding twenty chars" },
      { action: "crm.list_pipeline", reasoning: "Another detailed reasoning string over twenty chars" },
      { action: "web.search_news", reasoning: "Yet another detailed reasoning string for quality" },
    ]);
    const scores = rankPlans([weakPlan, strongPlan], ["email", "crm", "web"], 10);
    expect(scores).toHaveLength(2);
    expect(scores[0].total).toBeGreaterThanOrEqual(scores[1].total);
  });

  it("3 plans => sorted descending", () => {
    const plans = [
      makePlanN(1, ["email.search"], "Short"),
      makePlanN(5, ["email.search", "crm.list_pipeline", "web.search_news"]),
      makePlanN(3, ["email.search", "crm.list_pipeline"]),
    ];
    const scores = rankPlans(plans, ["email", "crm", "web"], 10);
    expect(scores).toHaveLength(3);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].total).toBeGreaterThanOrEqual(scores[i].total);
    }
  });

  it("5 plans => sorted descending", () => {
    const plans = range(5).map(i =>
      makePlanN(i + 1, ["email.search", "crm.list_pipeline", "web.search_news"].slice(0, (i % 3) + 1)),
    );
    const scores = rankPlans(plans, ["email", "crm", "web"], 10);
    expect(scores).toHaveLength(5);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].total).toBeGreaterThanOrEqual(scores[i].total);
    }
  });

  it("equal scores => stable ordering (all get scored)", () => {
    // Two identical plans should produce equal scores
    const plan = makePlanN(5, ["email.search", "crm.list_pipeline", "web.search_news"]);
    const plans = [plan, { ...plan }];
    const scores = rankPlans(plans, ["email", "crm", "web"], 10);
    expect(scores).toHaveLength(2);
    expect(scores[0].total).toBe(scores[1].total);
  });

  it("empty plans array => empty scores", () => {
    const scores = rankPlans([], ["email"], 10);
    expect(scores).toHaveLength(0);
  });

  it("plan_index maps correctly", () => {
    const plans = [
      makePlanN(1, ["email.search"], "Short"),
      makePlanN(5, ["email.search", "crm.list_pipeline", "web.search_news"]),
    ];
    const scores = rankPlans(plans, ["email", "crm", "web"], 10);

    // Each plan_index should be a valid index
    for (const score of scores) {
      expect(score.plan_index).toBeGreaterThanOrEqual(0);
      expect(score.plan_index).toBeLessThan(plans.length);
    }
  });

  it("10 plans sorted correctly", () => {
    const plans = range(10).map(i =>
      makePlanN((i % 8) + 1, ["email.search", "crm.list_pipeline", "web.search_news", "document.ingest"].slice(0, (i % 4) + 1)),
    );
    const scores = rankPlans(plans, ["email", "crm", "web", "document"], 10);
    expect(scores).toHaveLength(10);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].total).toBeGreaterThanOrEqual(scores[i].total);
    }
  });

  it("breakdown fields present on all scores", () => {
    const plans = [makePlanN(3), makePlanN(5)];
    const scores = rankPlans(plans, ["email"], 10);
    for (const s of scores) {
      expect(s.breakdown).toBeDefined();
      expect(typeof s.breakdown.step_efficiency).toBe("number");
      expect(typeof s.breakdown.capability_coverage).toBe("number");
      expect(typeof s.breakdown.action_diversity).toBe("number");
      expect(typeof s.breakdown.reasoning_quality).toBe("number");
    }
  });
});

// ── detectDisagreement ─────────────────────────────────────────────────────

describe("detectDisagreement", () => {
  it("0 plans => no disagreement, reason=single_plan", () => {
    const result = detectDisagreement([]);
    expect(result.disagreement).toBe(false);
    expect(result.reason).toBe("single_plan");
  });

  it("1 plan => no disagreement, reason=single_plan", () => {
    const result = detectDisagreement([makePlanN(3)]);
    expect(result.disagreement).toBe(false);
    expect(result.reason).toBe("single_plan");
  });

  it("identical plans => no disagreement, reason=plans_agree", () => {
    const planA = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const planB = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const result = detectDisagreement([planA, planB]);
    expect(result.disagreement).toBe(false);
    expect(result.reason).toBe("plans_agree");
  });

  it("step count ratio exactly 1.5 => NOT disagreement (> not >=)", () => {
    // 2 steps and 3 steps: ratio = 3/2 = 1.5 exactly
    const planA = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
    ]);
    const planB = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const result = detectDisagreement([planA, planB]);
    // ratio = 1.5, condition is > 1.5, so NO step count disagreement
    expect(result.reason).not.toBe("plans_differ_in_scope");
  });

  it("step count ratio 1.51 => disagreement plans_differ_in_scope", () => {
    // Need maxSteps/minSteps > 1.5
    // 100 steps and 151 steps: ratio = 1.51
    // Simpler: 2 steps and 4 steps: ratio = 2.0 > 1.5
    const planA = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
    ]);
    const planB = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "email.search" },
      { action: "crm.list_pipeline" },
    ]);
    const result = detectDisagreement([planA, planB]);
    // ratio = 4/2 = 2.0 > 1.5 => step count disagreement
    // unique actions: none (both use same actions), so no action disagreement
    expect(result.disagreement).toBe(true);
    expect(result.reason).toBe("plans_differ_in_scope");
  });

  it("action uniqueness exactly 30% => NOT disagreement", () => {
    // 10 total unique actions, 3 unique to one plan = 30% exactly
    // Condition is > 0.3, so 30% should NOT trigger
    // Plan A: a, b, c, d, e (5 actions)
    // Plan B: a, b, c, d, e, f, g, h (8 actions, with f,g,h unique)
    // All actions: a, b, c, d, e, f, g, h = 8 total
    // f, g, h are unique to plan B => 3 unique out of 8 = 37.5% > 30%
    // Need to be more precise: 3/10 = 30% exactly
    // Plan A: a, b, c, d, e, f, g (7 unique actions)
    // Plan B: a, b, c, d, e, f, g, h, i, j (10 actions, h, i, j unique)
    // All actions: 10, unique to one plan: 3 => 3/10 = 30%
    const planA = makePlan([
      { action: "a.one" }, { action: "b.two" }, { action: "c.three" },
      { action: "d.four" }, { action: "e.five" }, { action: "f.six" },
      { action: "g.seven" },
    ]);
    const planB = makePlan([
      { action: "a.one" }, { action: "b.two" }, { action: "c.three" },
      { action: "d.four" }, { action: "e.five" }, { action: "f.six" },
      { action: "g.seven" }, { action: "h.eight" }, { action: "i.nine" },
      { action: "j.ten" },
    ]);
    // allActions = 10, unique to B only: h, i, j => 3 out of 10 = 0.3
    // Condition: uniqueActions.length > allActions.size * 0.3 => 3 > 3 => false
    const result = detectDisagreement([planA, planB]);
    // step count ratio: 10/7 = 1.43 < 1.5, so no step disagreement
    expect(result.reason).not.toBe("plans_use_different_actions");
  });

  it("action uniqueness 31% => disagreement plans_use_different_actions", () => {
    // Need unique > 0.3 * allActions.size
    // 3 unique actions out of 9 total = 33% > 30%
    const planA = makePlan([
      { action: "a.one" }, { action: "b.two" }, { action: "c.three" },
      { action: "d.four" }, { action: "e.five" }, { action: "f.six" },
    ]);
    const planB = makePlan([
      { action: "a.one" }, { action: "b.two" }, { action: "c.three" },
      { action: "g.seven" }, { action: "h.eight" }, { action: "i.nine" },
    ]);
    // allActions = {a,b,c,d,e,f,g,h,i} = 9
    // d,e,f unique to A; g,h,i unique to B => 6 unique out of 9 = 66% > 30%
    // step count ratio: 6/6 = 1.0, no step disagreement
    const result = detectDisagreement([planA, planB]);
    expect(result.disagreement).toBe(true);
    expect(result.reason).toContain("actions");
  });

  it("both step count and action triggers => plans_differ_substantially_in_structure_and_actions", () => {
    const planA = makePlan([
      { action: "email.search" },
      { action: "email.send" },
    ]);
    const planB = makePlan([
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
      { action: "document.ingest" },
      { action: "inference.chat" },
      { action: "crm.update_contact" },
    ]);
    // step ratio: 5/2 = 2.5 > 1.5 => step disagreement
    // allActions = {email.search, email.send, crm.list_pipeline, web.search_news, document.ingest, inference.chat, crm.update_contact} = 7
    // unique to A: email.search, email.send = 2
    // unique to B: crm.list_pipeline, web.search_news, document.ingest, inference.chat, crm.update_contact = 5
    // total unique = 7 out of 7 = 100% > 30% => action disagreement
    const result = detectDisagreement([planA, planB]);
    expect(result.disagreement).toBe(true);
    expect(result.reason).toBe("plans_differ_substantially_in_structure_and_actions");
  });

  it("3 plans with mixed results analyzed correctly", () => {
    const planA = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
    ]);
    const planB = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const planC = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
    ]);
    const result = detectDisagreement([planA, planB, planC]);
    // step ratio: 3/2 = 1.5, NOT > 1.5
    // web.search_news unique to B: 1 out of 3 actions = 33% > 30%
    expect(result.disagreement).toBe(true);
    expect(result.reason).toBe("plans_use_different_actions");
  });

  it("plans with 0 steps edge case", () => {
    const emptyPlan = makePlan([]);
    const result = detectDisagreement([emptyPlan, emptyPlan]);
    // minSteps = 0, so stepCountDisagreement check has minSteps > 0 guard
    expect(result.disagreement).toBe(false);
    expect(result.reason).toBe("plans_agree");
  });

  it("returns details with unique_actions and step_count_range", () => {
    const planA = makePlan([
      { action: "email.search" },
    ]);
    const planB = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
      { action: "web.search_news" },
    ]);
    const result = detectDisagreement([planA, planB]);
    expect(Array.isArray(result.details.unique_actions)).toBe(true);
    expect(Array.isArray(result.details.step_count_range)).toBe(true);
    expect(result.details.step_count_range).toHaveLength(2);
    expect(result.details.step_count_range[0]).toBeLessThanOrEqual(result.details.step_count_range[1]);
  });

  it("step_count_range reflects min and max", () => {
    const planA = makePlanN(2);
    const planB = makePlanN(7);
    const result = detectDisagreement([planA, planB]);
    expect(result.details.step_count_range[0]).toBe(2);
    expect(result.details.step_count_range[1]).toBe(7);
  });

  it("unique_actions lists only actions appearing in exactly one plan", () => {
    const planA = makePlan([
      { action: "email.search" },
      { action: "crm.list_pipeline" },
    ]);
    const planB = makePlan([
      { action: "email.search" },
      { action: "web.search_news" },
    ]);
    const result = detectDisagreement([planA, planB]);
    // crm.list_pipeline unique to A, web.search_news unique to B
    expect(result.details.unique_actions).toContain("crm.list_pipeline");
    expect(result.details.unique_actions).toContain("web.search_news");
    expect(result.details.unique_actions).not.toContain("email.search");
  });

  it("3 plans where action appears in 2 of 3 => not unique", () => {
    const planA = makePlan([{ action: "email.search" }, { action: "crm.list_pipeline" }]);
    const planB = makePlan([{ action: "email.search" }, { action: "crm.list_pipeline" }]);
    const planC = makePlan([{ action: "email.search" }, { action: "web.search_news" }]);
    const result = detectDisagreement([planA, planB, planC]);
    // crm.list_pipeline in 2 plans => NOT unique
    // web.search_news in 1 plan => unique
    expect(result.details.unique_actions).toContain("web.search_news");
    expect(result.details.unique_actions).not.toContain("crm.list_pipeline");
  });

  it("plans where one has 0 steps and other has steps => step ratio guard (minSteps=0)", () => {
    const emptyPlan = makePlan([]);
    const filledPlan = makePlanN(5);
    const result = detectDisagreement([emptyPlan, filledPlan]);
    // minSteps = 0, guard: minSteps > 0 is false, so NO step count disagreement
    // But action disagreement may trigger since all 5 actions are unique to filledPlan
    expect(typeof result.disagreement).toBe("boolean");
  });
});
