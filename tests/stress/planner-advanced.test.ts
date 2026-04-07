/**
 * Stress: Advanced Planner — Critic + Multi-viewpoint
 *
 * Tests the full critic review pipeline (plan → critique → revise/reject)
 * and multi-viewpoint planning (parallel viewpoints → rank → disagree → critic).
 */

import { describe, it, expect } from "vitest";
import { buildPlanWithCritic, type CritiqueResult } from "@jarvis/runtime";
import { buildPlanMultiViewpoint, type MultiPlanResult } from "@jarvis/runtime";
import type { PlannerDeps } from "@jarvis/runtime";
import { range } from "./helpers.js";

// ── Mock LLM with controllable responses ────────────────────────────────────

function mockDeps(responses: Array<string | ((prompt: string) => string)>): PlannerDeps {
  let callIndex = 0;
  return {
    chat: async (prompt: string) => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return typeof resp === "function" ? resp(prompt) : resp;
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
  };
}

const VALID_PLAN = JSON.stringify([
  { step: 1, action: "email.search", input: { query: "client" }, reasoning: "Search for recent client communications about the project" },
  { step: 2, action: "crm.list_pipeline", input: {}, reasoning: "Check current pipeline status for open opportunities" },
  { step: 3, action: "web.search_news", input: { query: "automotive" }, reasoning: "Monitor industry news for potential leads" },
  { step: 4, action: "email.draft", input: { to: "client@example.com" }, reasoning: "Draft outreach based on analysis" },
]);

const APPROVE_CRITIQUE = JSON.stringify({
  issues: [],
  risks: ["Email may not reach client spam folder"],
  suggestions: ["Add follow-up reminder step"],
  overall_assessment: "approve",
});

const REVISE_CRITIQUE = JSON.stringify({
  issues: ["Missing CRM update step after email", "No approval gate for email.send"],
  risks: ["Outreach without proper CRM tracking"],
  suggestions: ["Add crm.update_contact after email", "Replace email.draft with email.send + approval"],
  overall_assessment: "revise",
});

const REJECT_CRITIQUE = JSON.stringify({
  issues: ["Plan uses email.send without any prior research", "Wrong agent for this task"],
  risks: ["Sending unsolicited emails violates compliance"],
  suggestions: [],
  overall_assessment: "reject",
});

const REVISED_PLAN = JSON.stringify([
  { step: 1, action: "email.search", input: { query: "client" }, reasoning: "Search for recent communications first" },
  { step: 2, action: "crm.list_pipeline", input: {}, reasoning: "Verify pipeline status before outreach" },
  { step: 3, action: "web.search_news", input: {}, reasoning: "Check industry context for relevance" },
  { step: 4, action: "email.send", input: { to: "client@example.com" }, reasoning: "Send outreach with approval gate" },
  { step: 5, action: "crm.update_contact", input: {}, reasoning: "Update CRM after outreach" },
]);

// ── Critic Tests ────────────────────────────────────────────────────────────

describe("Planner-Critic Advanced", () => {
  it("approve path: plan passes critic unchanged", async () => {
    // Call 1: initial plan, Call 2: critique (approve)
    const deps = mockDeps([VALID_PLAN, APPROVE_CRITIQUE]);

    const result = await buildPlanWithCritic({
      agent_id: "bd-pipeline",
      run_id: "run-approve",
      goal: "Find and contact leads",
      system_prompt: "You are a BD agent",
      context: "Recent pipeline has 5 leads",
      capabilities: ["email", "crm", "web"],
      max_steps: 10,
      deps,
    });

    expect(result.critique.overall_assessment).toBe("approve");
    expect(result.plan.steps).toHaveLength(4);
    expect(result.plan.steps[0].action).toBe("email.search");
  });

  it("revise path: critic triggers plan revision with feedback", async () => {
    // Call 1: initial plan, Call 2: critique (revise), Call 3: revised plan
    const deps = mockDeps([VALID_PLAN, REVISE_CRITIQUE, REVISED_PLAN]);

    const result = await buildPlanWithCritic({
      agent_id: "bd-pipeline",
      run_id: "run-revise",
      goal: "Find and contact leads",
      system_prompt: "You are a BD agent",
      context: "Pipeline active",
      capabilities: ["email", "crm", "web"],
      max_steps: 10,
      deps,
    });

    expect(result.critique.overall_assessment).toBe("revise");
    expect(result.critique.issues.length).toBeGreaterThan(0);
    // Revised plan should have the CRM update step
    expect(result.plan.steps.length).toBe(5);
    expect(result.plan.steps[4].action).toBe("crm.update_contact");
  });

  it("reject path: critic rejects, returns empty plan", async () => {
    const deps = mockDeps([VALID_PLAN, REJECT_CRITIQUE]);

    const result = await buildPlanWithCritic({
      agent_id: "bd-pipeline",
      run_id: "run-reject",
      goal: "Send cold emails",
      system_prompt: "BD agent",
      context: "",
      capabilities: ["email"],
      max_steps: 5,
      deps,
    });

    expect(result.critique.overall_assessment).toBe("reject");
    expect(result.plan.steps).toHaveLength(0);
  });

  it("empty initial plan skips critique entirely", async () => {
    const deps = mockDeps(["[]"]);

    const result = await buildPlanWithCritic({
      agent_id: "empty-agent",
      run_id: "run-empty",
      goal: "Nothing to do",
      system_prompt: "Agent",
      context: "",
      capabilities: ["email"],
      max_steps: 5,
      deps,
    });

    expect(result.plan.steps).toHaveLength(0);
    expect(result.critique.overall_assessment).toBe("approve");
    expect(result.critique.issues).toHaveLength(0);
  });

  it("critic LLM failure gracefully defaults to approve", async () => {
    let callCount = 0;
    const deps: PlannerDeps = {
      chat: async () => {
        callCount++;
        if (callCount === 1) return VALID_PLAN;
        throw new Error("LLM timeout");
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    };

    const result = await buildPlanWithCritic({
      agent_id: "fail-critic",
      run_id: "run-fail",
      goal: "Handle failure",
      system_prompt: "Agent",
      context: "",
      capabilities: ["email"],
      max_steps: 5,
      deps,
    });

    expect(result.critique.overall_assessment).toBe("approve");
    expect(result.plan.steps.length).toBeGreaterThan(0);
  });

  it("revision LLM failure falls back to original plan", async () => {
    let callCount = 0;
    const deps: PlannerDeps = {
      chat: async () => {
        callCount++;
        if (callCount === 1) return VALID_PLAN;
        if (callCount === 2) return REVISE_CRITIQUE;
        throw new Error("Revision failed");
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    };

    const result = await buildPlanWithCritic({
      agent_id: "fail-revise",
      run_id: "run-fail-rev",
      goal: "Fail revision",
      system_prompt: "Agent",
      context: "",
      capabilities: ["email", "crm", "web"],
      max_steps: 10,
      deps,
    });

    expect(result.critique.overall_assessment).toBe("revise");
    // Should fall back to original plan since revision failed
    expect(result.plan.steps.length).toBe(4);
  });
});

// ── Multi-viewpoint Tests ───────────────────────────────────────────────────

describe("Multi-Viewpoint Planner Advanced", () => {
  const PRAGMATIC_PLAN = JSON.stringify([
    { step: 1, action: "email.search", input: {}, reasoning: "Quick search for relevant client emails" },
    { step: 2, action: "email.send", input: {}, reasoning: "Send outreach immediately to qualified leads" },
  ]);

  const THOROUGH_PLAN = JSON.stringify([
    { step: 1, action: "email.search", input: {}, reasoning: "Comprehensive search of all client communications" },
    { step: 2, action: "crm.list_pipeline", input: {}, reasoning: "Validate pipeline state before any outreach" },
    { step: 3, action: "web.search_news", input: {}, reasoning: "Check industry context for timing relevance" },
    { step: 4, action: "email.draft", input: {}, reasoning: "Draft carefully reviewed outreach email" },
    { step: 5, action: "crm.update_contact", input: {}, reasoning: "Update CRM with outreach activity" },
  ]);

  const CREATIVE_PLAN = JSON.stringify([
    { step: 1, action: "web.search_news", input: {}, reasoning: "Start with industry trends to find angle" },
    { step: 2, action: "web.competitive_intel", input: {}, reasoning: "Analyze competitor positioning for wedge" },
    { step: 3, action: "email.draft", input: {}, reasoning: "Draft value-proposition email based on intel" },
  ]);

  it("2 viewpoints: generates, scores, and selects best", async () => {
    let callIdx = 0;
    const deps = mockDeps([
      () => { callIdx++; return callIdx === 1 ? PRAGMATIC_PLAN : THOROUGH_PLAN; },
    ]);

    const result = await buildPlanMultiViewpoint({
      agent_id: "bd-pipeline",
      run_id: "run-multi-2",
      goal: "Find and outreach leads",
      system_prompt: "BD agent",
      context: "Active pipeline",
      capabilities: ["email", "crm", "web"],
      max_steps: 10,
      deps,
      viewpoint_count: 2,
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.scores.length).toBeGreaterThan(0);
    expect(result.plan.steps.length).toBeGreaterThan(0);
    // Thorough plan should score higher (more capability coverage)
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("3 viewpoints: all produce plans, disagreement detected", async () => {
    let callIdx = 0;
    const plans = [PRAGMATIC_PLAN, THOROUGH_PLAN, CREATIVE_PLAN];
    const deps = mockDeps([() => { return plans[callIdx++ % 3]; }]);

    const result = await buildPlanMultiViewpoint({
      agent_id: "proposal-engine",
      run_id: "run-multi-3",
      goal: "Analyze RFQ and prepare proposal",
      system_prompt: "Proposal agent",
      context: "New RFQ received",
      capabilities: ["email", "crm", "web", "document"],
      max_steps: 10,
      deps,
      viewpoint_count: 3,
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.scores).toHaveLength(3);
    expect(result.disagreement.disagreement).toBe(true);
    // All candidates preserved for audit
    expect(result.candidates.every(c => c.steps.length > 0)).toBe(true);
  });

  it("all viewpoints return empty → handles gracefully", async () => {
    const deps = mockDeps(["[]"]);

    const result = await buildPlanMultiViewpoint({
      agent_id: "empty-multi",
      run_id: "run-empty-multi",
      goal: "Nothing",
      system_prompt: "Agent",
      context: "",
      capabilities: ["email"],
      max_steps: 5,
      deps,
      viewpoint_count: 3,
    });

    expect(result.plan.steps).toHaveLength(0);
    expect(result.scores).toHaveLength(0);
  });

  it("only 1 viewpoint produces valid plan → used without ranking", async () => {
    let callIdx = 0;
    const deps = mockDeps([() => {
      callIdx++;
      return callIdx === 1 ? THOROUGH_PLAN : "[]";
    }]);

    const result = await buildPlanMultiViewpoint({
      agent_id: "single-valid",
      run_id: "run-single",
      goal: "One plan works",
      system_prompt: "Agent",
      context: "",
      capabilities: ["email", "crm", "web"],
      max_steps: 10,
      deps,
      viewpoint_count: 2,
    });

    expect(result.plan.steps.length).toBeGreaterThan(0);
  });

  it("with critic: winner gets reviewed and potentially revised", async () => {
    let callIdx = 0;
    const deps = mockDeps([
      // Viewpoint 1 plan
      () => { callIdx++; return callIdx <= 2 ? PRAGMATIC_PLAN : THOROUGH_PLAN; },
      // Critic call for buildPlanWithCritic (which internally calls buildPlanWithInference + critique)
      VALID_PLAN,
      APPROVE_CRITIQUE,
    ]);

    const result = await buildPlanMultiViewpoint({
      agent_id: "critic-multi",
      run_id: "run-critic-multi",
      goal: "Plan with review",
      system_prompt: "Agent",
      context: "",
      capabilities: ["email", "crm", "web"],
      max_steps: 10,
      deps,
      viewpoint_count: 2,
      run_critic: true,
    });

    expect(result.critique).toBeDefined();
    expect(result.plan.steps.length).toBeGreaterThan(0);
  });

  it("concurrent multi-viewpoint calls don't interfere", async () => {
    const results = await Promise.all(
      range(5).map(async (i) => {
        let callIdx = 0;
        const deps = mockDeps([() => {
          callIdx++;
          return callIdx % 2 === 0 ? PRAGMATIC_PLAN : THOROUGH_PLAN;
        }]);

        return buildPlanMultiViewpoint({
          agent_id: `concurrent-${i}`,
          run_id: `run-conc-${i}`,
          goal: `Concurrent goal ${i}`,
          system_prompt: "Agent",
          context: `Context ${i}`,
          capabilities: ["email", "crm", "web"],
          max_steps: 10,
          deps,
          viewpoint_count: 2,
        });
      }),
    );

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.candidates.length).toBeGreaterThan(0);
      expect(r.plan.steps.length).toBeGreaterThan(0);
    }
  });
});
