/**
 * Multi-viewpoint planner: run N independent planners in parallel,
 * evaluate all candidates, pick the best, then optionally run critic review.
 *
 * Flow:
 *   1. Generate N plans concurrently (each with a different "viewpoint" prompt)
 *   2. Score and rank all plans via plan-evaluator
 *   3. Check for disagreement between plans
 *   4. If disagreement → escalate (request approval with explanation)
 *   5. Pick the top-scoring plan
 *   6. Optionally run critic review on the winner
 */

import type { AgentPlan } from "@jarvis/agent-framework";
import type { PlannerDeps } from "./planner-real.js";
import { buildPlanWithInference } from "./planner-real.js";
import { buildPlanWithCritic, type CritiqueResult } from "./planner-critic.js";
import { rankPlans, detectDisagreement, type PlanScore } from "./plan-evaluator.js";

/** Viewpoints give each planner a different perspective. */
const VIEWPOINTS = [
  {
    id: "pragmatic",
    instruction: "Focus on the most direct, efficient path to the goal. Minimize steps. Prefer proven approaches over creative ones.",
  },
  {
    id: "thorough",
    instruction: "Focus on completeness and risk mitigation. Include validation steps. Prefer safety over speed.",
  },
  {
    id: "creative",
    instruction: "Consider alternative approaches that might be more effective. Challenge assumptions about the standard workflow.",
  },
] as const;

export type MultiPlanResult = {
  /** The selected plan */
  plan: AgentPlan;
  /** Scores of all candidate plans */
  scores: PlanScore[];
  /** Index of the selected plan in the candidates array */
  selected_index: number;
  /** Whether plans disagreed substantially */
  disagreement: ReturnType<typeof detectDisagreement>;
  /** Critic review of the selected plan (if run) */
  critique?: CritiqueResult;
  /** All candidate plans (for audit trail) */
  candidates: AgentPlan[];
};

/**
 * Build a plan using multiple independent viewpoints.
 *
 * @param viewpointCount How many viewpoints to use (2-3). Defaults to 2.
 */
export async function buildPlanMultiViewpoint(params: {
  agent_id: string;
  run_id: string;
  goal: string;
  system_prompt: string;
  context: string;
  capabilities: string[];
  max_steps: number;
  deps: PlannerDeps;
  viewpoint_count?: number;
  run_critic?: boolean;
}): Promise<MultiPlanResult> {
  const { deps } = params;
  const viewpointCount = Math.min(Math.max(params.viewpoint_count ?? 2, 2), VIEWPOINTS.length);
  const selectedViewpoints = VIEWPOINTS.slice(0, viewpointCount);

  deps.logger.info(`Multi-viewpoint planning for ${params.agent_id}: ${viewpointCount} viewpoints`);

  // Step 1: Generate plans in parallel, each with a viewpoint-augmented system prompt
  const planPromises = selectedViewpoints.map(vp => {
    const augmentedPrompt = `${params.system_prompt}\n\nPLANNING VIEWPOINT (${vp.id}): ${vp.instruction}`;
    return buildPlanWithInference({
      ...params,
      system_prompt: augmentedPrompt,
      deps,
    });
  });

  const candidates = await Promise.all(planPromises);

  // Filter out empty plans
  const validCandidates = candidates.filter(p => p.steps.length > 0);

  if (validCandidates.length === 0) {
    deps.logger.warn(`All ${viewpointCount} viewpoints produced empty plans for ${params.agent_id}`);
    return {
      plan: candidates[0],
      scores: [],
      selected_index: 0,
      disagreement: detectDisagreement([]),
      candidates,
    };
  }

  if (validCandidates.length === 1) {
    const singlePlan = validCandidates[0];
    deps.logger.info(`Only 1 of ${viewpointCount} viewpoints produced a plan for ${params.agent_id}`);

    // Run critic if requested
    let critique: CritiqueResult | undefined;
    if (params.run_critic) {
      const result = await buildPlanWithCritic({ ...params, deps });
      critique = result.critique;
    }

    return {
      plan: singlePlan,
      scores: rankPlans(validCandidates, params.capabilities, params.max_steps),
      selected_index: candidates.indexOf(singlePlan),
      disagreement: detectDisagreement(validCandidates),
      critique,
      candidates,
    };
  }

  // Step 2: Score and rank
  const scores = rankPlans(validCandidates, params.capabilities, params.max_steps);
  const bestIndex = scores[0].plan_index;
  const bestPlan = validCandidates[bestIndex];

  deps.logger.info(
    `Plan scores for ${params.agent_id}: ${scores.map((s, i) => `[${i}] ${s.total}`).join(", ")}. Selected: ${bestIndex} (score ${scores[0].total})`,
  );

  // Step 3: Check disagreement
  const disagreement = detectDisagreement(validCandidates);

  if (disagreement.disagreement) {
    deps.logger.warn(
      `Plan disagreement for ${params.agent_id}: ${disagreement.reason} (unique actions: ${disagreement.details.unique_actions.join(", ")})`,
    );
  }

  // Step 4: Optionally run critic on the winner
  let critique: CritiqueResult | undefined;
  if (params.run_critic) {
    const result = await buildPlanWithCritic({
      ...params,
      deps,
    });
    critique = result.critique;
    // If critic revised the plan, use the revised version
    if (result.plan.steps.length > 0) {
      return {
        plan: result.plan,
        scores,
        selected_index: bestIndex,
        disagreement,
        critique,
        candidates,
      };
    }
  }

  return {
    plan: bestPlan,
    scores,
    selected_index: candidates.indexOf(bestPlan),
    disagreement,
    critique,
    candidates,
  };
}
