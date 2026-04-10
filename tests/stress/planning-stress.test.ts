/**
 * Stress: Planning Under Load
 *
 * Tests planner with mocked LLM calls: concurrent planning, edge cases,
 * adversarial inputs, and memory-intensive context assembly.
 */

import { describe, it, expect } from "vitest";
import { buildPlanWithInference, type PlannerDeps } from "@jarvis/runtime";
import { scorePlan, rankPlans, detectDisagreement } from "@jarvis/runtime";
import type { AgentPlan } from "@jarvis/agent-framework";
import { range } from "./helpers.js";

// ── Mock LLM ────────────────────────────────────────────────────────────────

function mockDeps(response?: string | ((prompt: string) => string)): PlannerDeps {
  const defaultResponse = JSON.stringify([
    { step: 1, action: "email.search", input: { query: "client" }, reasoning: "Search for recent client communications" },
    { step: 2, action: "crm.list_pipeline", input: {}, reasoning: "Check current pipeline status for open opportunities" },
    { step: 3, action: "web.search_news", input: { query: "automotive safety" }, reasoning: "Monitor industry news for potential leads" },
  ]);

  return {
    chat: async (prompt: string) => {
      if (typeof response === "function") return response(prompt);
      return response ?? defaultResponse;
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as any,
  };
}

describe("Planning Stress", () => {
  it("20 concurrent planner calls all return valid plans", async () => {
    const results = await Promise.all(
      range(20).map(async (i) => {
        return buildPlanWithInference({
          agent_id: `agent-${i}`,
          run_id: `run-${i}`,
          goal: `Goal for agent ${i}: analyze client pipeline and generate outreach`,
          system_prompt: "You are a business development agent.",
          context: `Context for run ${i}: recent activity shows 5 new leads.`,
          capabilities: ["email", "crm", "web"],
          max_steps: 10,
          deps: mockDeps(),
        });
      }),
    );

    expect(results).toHaveLength(20);
    for (const plan of results) {
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps.length).toBeLessThanOrEqual(10);
      for (const step of plan.steps) {
        expect(step.action).toBeTruthy();
        expect(typeof step.step).toBe("number");
      }
    }
  });

  it("empty goal produces a plan (planner handles gracefully)", async () => {
    const plan = await buildPlanWithInference({
      agent_id: "edge-case",
      run_id: "run-empty-goal",
      goal: "",
      system_prompt: "You are a test agent.",
      context: "",
      capabilities: ["email"],
      max_steps: 5,
      deps: mockDeps(),
    });

    // Should still return a valid plan structure
    expect(plan.agent_id).toBe("edge-case");
    expect(plan.run_id).toBe("run-empty-goal");
    expect(Array.isArray(plan.steps)).toBe(true);
  });

  it("max_steps=1 caps output", async () => {
    const manySteps = JSON.stringify([
      { step: 1, action: "email.search", input: {}, reasoning: "First step" },
      { step: 2, action: "crm.update", input: {}, reasoning: "Second step" },
      { step: 3, action: "web.search_news", input: {}, reasoning: "Third step" },
    ]);

    const plan = await buildPlanWithInference({
      agent_id: "cap-test",
      run_id: "run-cap",
      goal: "Do everything",
      system_prompt: "Agent prompt",
      context: "Context",
      capabilities: ["email", "crm", "web"],
      max_steps: 1,
      deps: mockDeps(manySteps),
    });

    expect(plan.steps.length).toBeLessThanOrEqual(1);
  });

  it("max_steps=100 allows many steps", async () => {
    const bigPlan = JSON.stringify(
      Array.from({ length: 50 }, (_, i) => ({
        step: i + 1,
        action: `email.op_${i}`,
        input: { index: i },
        reasoning: `Step ${i + 1}: detailed reasoning about what needs to happen`,
      })),
    );

    const plan = await buildPlanWithInference({
      agent_id: "big-plan",
      run_id: "run-big",
      goal: "Complex multi-step task",
      system_prompt: "Agent prompt",
      context: "Context",
      capabilities: ["email"],
      max_steps: 100,
      deps: mockDeps(bigPlan),
    });

    expect(plan.steps.length).toBe(50);
  });

  it("malformed JSON from LLM triggers retry and recovers", async () => {
    let callCount = 0;
    const deps = mockDeps(() => {
      callCount++;
      if (callCount === 1) {
        return "Here is the plan:\nThis is not valid JSON at all!";
      }
      // Retry returns valid JSON
      return JSON.stringify([
        { step: 1, action: "email.search", input: { q: "test" }, reasoning: "Recovery search after parsing failure" },
      ]);
    });

    const plan = await buildPlanWithInference({
      agent_id: "malformed",
      run_id: "run-malformed",
      goal: "Recover from bad LLM output",
      system_prompt: "Agent",
      context: "Context",
      capabilities: ["email"],
      max_steps: 5,
      deps,
    });

    expect(callCount).toBe(2); // Initial + retry
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].action).toBe("email.search");
  });

  it("LLM returns empty array -> empty plan", async () => {
    const plan = await buildPlanWithInference({
      agent_id: "empty-response",
      run_id: "run-empty",
      goal: "Get an empty response",
      system_prompt: "Agent",
      context: "Context",
      capabilities: ["email"],
      max_steps: 5,
      deps: mockDeps("[]"),
    });

    expect(plan.steps).toHaveLength(0);
  });

  it("LLM returns steps with missing fields -> filtered out", async () => {
    const partialSteps = JSON.stringify([
      { step: 1, action: "email.search", input: { q: "test" }, reasoning: "Valid step with all fields" },
      { step: 2, reasoning: "Missing action field" },                    // no action
      { step: 3, action: "crm.update" },                                // no input
      { step: 4, action: "web.search_news", input: {}, reasoning: "Another valid step here" },
    ]);

    const plan = await buildPlanWithInference({
      agent_id: "partial",
      run_id: "run-partial",
      goal: "Handle partial steps",
      system_prompt: "Agent",
      context: "Context",
      capabilities: ["email", "crm", "web"],
      max_steps: 10,
      deps: mockDeps(partialSteps),
    });

    // Steps without action or input should be filtered
    for (const step of plan.steps) {
      expect(step.action).toBeTruthy();
    }
  });

  it("LLM returns JSON wrapped in markdown fences", async () => {
    const fenced = '```json\n[{"step":1,"action":"email.search","input":{"q":"test"},"reasoning":"Search for test emails in inbox"}]\n```';

    const plan = await buildPlanWithInference({
      agent_id: "fenced",
      run_id: "run-fenced",
      goal: "Parse fenced JSON",
      system_prompt: "Agent",
      context: "Context",
      capabilities: ["email"],
      max_steps: 5,
      deps: mockDeps(fenced),
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe("email.search");
  });

  it("inference failure returns empty plan (no crash)", async () => {
    const failDeps: PlannerDeps = {
      chat: async () => { throw new Error("LLM service unavailable"); },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    };

    const plan = await buildPlanWithInference({
      agent_id: "fail-agent",
      run_id: "run-fail",
      goal: "Handle inference failure gracefully",
      system_prompt: "Agent",
      context: "Context",
      capabilities: ["email"],
      max_steps: 5,
      deps: failDeps,
    });

    expect(plan.steps).toHaveLength(0);
    expect(plan.agent_id).toBe("fail-agent");
  });

  it("large context (50KB) is truncated and plan still works", async () => {
    const largeContext = "A".repeat(50_000);

    const plan = await buildPlanWithInference({
      agent_id: "large-ctx",
      run_id: "run-large",
      goal: "Handle large context",
      system_prompt: "Agent prompt",
      context: largeContext,
      capabilities: ["email", "crm"],
      max_steps: 5,
      deps: mockDeps(),
    });

    // Plan should still be produced despite large context
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it("special characters in goal handled correctly", async () => {
    const plan = await buildPlanWithInference({
      agent_id: "special-chars",
      run_id: "run-special",
      goal: 'Analyze "ISO 26262" & ASPICE compliance — check <requirements> for "Meridian Engineering GmbH"',
      system_prompt: "Agent prompt",
      context: "Context with special chars: <>&\"'",
      capabilities: ["email", "document"],
      max_steps: 5,
      deps: mockDeps(),
    });

    expect(plan.goal).toContain("ISO 26262");
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it("scoring + ranking 10 concurrent plan results", async () => {
    const caps = ["email", "crm", "web"];

    // Generate 10 plans with different responses
    const plans = await Promise.all(
      range(10).map(async (i) => {
        const steps = Array.from({ length: 2 + (i % 5) }, (_, j) => ({
          step: j + 1,
          action: [`email.search`, `crm.list_pipeline`, `web.search_news`, `email.send`, `crm.update`][j % 5],
          input: { variant: i },
          reasoning: `Reasoning for variant ${i} step ${j + 1} with sufficient detail`,
        }));

        return buildPlanWithInference({
          agent_id: `rank-${i}`,
          run_id: `run-rank-${i}`,
          goal: `Rank test ${i}`,
          system_prompt: "Agent",
          context: "Context",
          capabilities: caps,
          max_steps: 10,
          deps: mockDeps(JSON.stringify(steps)),
        });
      }),
    );

    // Score all
    const scores = rankPlans(plans, caps, 10);
    expect(scores).toHaveLength(10);

    // Scores should be sorted descending
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].total).toBeGreaterThanOrEqual(scores[i].total);
    }

    // Check disagreement across all plans
    const disagreement = detectDisagreement(plans);
    expect(typeof disagreement.disagreement).toBe("boolean");
    expect(typeof disagreement.reason).toBe("string");
  });
});
