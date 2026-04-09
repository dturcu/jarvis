/**
 * Plan evaluator: scores and ranks candidate plans.
 *
 * Used by the multi-planner to pick the best plan from N alternatives.
 * Scoring is deterministic (no LLM call) — based on structural heuristics:
 *   - Step count efficiency (fewer is better, within reason)
 *   - Capability coverage (uses available capabilities)
 *   - Action diversity (avoids redundant steps)
 *   - Reasoning quality (non-empty, non-trivial reasoning)
 */

import type { AgentPlan } from "@jarvis/agent-framework";

export type PlanScore = {
  plan_index: number;
  total: number;
  breakdown: {
    step_efficiency: number;
    capability_coverage: number;
    action_diversity: number;
    reasoning_quality: number;
  };
};

/**
 * Score a single plan on [0, 100].
 */
export function scorePlan(
  plan: AgentPlan,
  capabilities: string[],
  maxSteps: number,
): PlanScore & { plan_index: -1 } {
  const scores = {
    step_efficiency: scoreStepEfficiency(plan.steps.length, maxSteps),
    capability_coverage: scoreCapabilityCoverage(plan.steps.map(s => s.action), capabilities),
    action_diversity: scoreActionDiversity(plan.steps.map(s => s.action)),
    reasoning_quality: scoreReasoningQuality(plan.steps.map(s => s.reasoning)),
  };

  // Weighted sum: coverage is most important, then efficiency, diversity, reasoning
  const total = Math.round(
    scores.capability_coverage * 0.35 +
    scores.step_efficiency * 0.25 +
    scores.action_diversity * 0.20 +
    scores.reasoning_quality * 0.20,
  );

  return { plan_index: -1, total, breakdown: scores };
}

/**
 * Rank multiple plans. Returns scores sorted best-first.
 */
export function rankPlans(
  plans: AgentPlan[],
  capabilities: string[],
  maxSteps: number,
): PlanScore[] {
  return plans
    .map((plan, i) => {
      const score = scorePlan(plan, capabilities, maxSteps);
      return { ...score, plan_index: i };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Detect disagreement between plans. Returns true if plans have
 * fundamentally different structures (different actions, different ordering).
 */
export function detectDisagreement(plans: AgentPlan[]): {
  disagreement: boolean;
  reason: string;
  details: { unique_actions: string[]; step_count_range: [number, number] };
} {
  if (plans.length < 2) {
    return { disagreement: false, reason: "single_plan", details: { unique_actions: [], step_count_range: [0, 0] } };
  }

  const actionSets = plans.map(p => new Set(p.steps.map(s => s.action)));
  const allActions = new Set(plans.flatMap(p => p.steps.map(s => s.action)));
  const stepCounts = plans.map(p => p.steps.length);
  const minSteps = Math.min(...stepCounts);
  const maxSteps = Math.max(...stepCounts);

  // Check if any plan has actions that no other plan has
  const uniqueActions: string[] = [];
  for (const action of allActions) {
    const plansWithAction = actionSets.filter(s => s.has(action)).length;
    if (plansWithAction === 1) {
      uniqueActions.push(action);
    }
  }

  // Disagreement heuristics:
  // 1. Step count differs by more than 50%
  const stepCountDisagreement = minSteps > 0 && (maxSteps / minSteps) > 1.5;
  // 2. More than 30% of actions are unique to a single plan
  const actionDisagreement = uniqueActions.length > allActions.size * 0.3;

  if (stepCountDisagreement && actionDisagreement) {
    return {
      disagreement: true,
      reason: "plans_differ_substantially_in_structure_and_actions",
      details: { unique_actions: uniqueActions, step_count_range: [minSteps, maxSteps] },
    };
  }

  if (actionDisagreement) {
    return {
      disagreement: true,
      reason: "plans_use_different_actions",
      details: { unique_actions: uniqueActions, step_count_range: [minSteps, maxSteps] },
    };
  }

  if (stepCountDisagreement) {
    return {
      disagreement: true,
      reason: "plans_differ_in_scope",
      details: { unique_actions: uniqueActions, step_count_range: [minSteps, maxSteps] },
    };
  }

  return {
    disagreement: false,
    reason: "plans_agree",
    details: { unique_actions: uniqueActions, step_count_range: [minSteps, maxSteps] },
  };
}

// ── Scoring functions ────────────────────────────────────────────────────────

/**
 * Plans that use 40-80% of max steps score highest (not too few, not bloated).
 */
function scoreStepEfficiency(stepCount: number, maxSteps: number): number {
  if (stepCount === 0) return 0;
  const ratio = stepCount / maxSteps;
  if (ratio <= 0.4) return Math.round(ratio / 0.4 * 70); // Linear ramp to 70
  if (ratio <= 0.8) return 100; // Sweet spot
  return Math.round(Math.max(0, 100 - (ratio - 0.8) * 250)); // Penalty for bloat
}

/**
 * Fraction of declared capabilities that appear in at least one action.
 */
function scoreCapabilityCoverage(actions: string[], capabilities: string[]): number {
  if (capabilities.length === 0) return 100;
  const used = new Set<string>();
  for (const action of actions) {
    const prefix = action.split(".")[0] ?? action;
    if (capabilities.includes(prefix)) {
      used.add(prefix);
    }
  }
  return Math.round((used.size / capabilities.length) * 100);
}

/**
 * Ratio of unique actions to total actions. Penalizes excessive repetition.
 */
function scoreActionDiversity(actions: string[]): number {
  if (actions.length === 0) return 0;
  const unique = new Set(actions).size;
  return Math.round((unique / actions.length) * 100);
}

/**
 * Fraction of steps with non-trivial reasoning (>20 chars).
 */
function scoreReasoningQuality(reasonings: string[]): number {
  if (reasonings.length === 0) return 0;
  const good = reasonings.filter(r => r.length > 20).length;
  return Math.round((good / reasonings.length) * 100);
}
