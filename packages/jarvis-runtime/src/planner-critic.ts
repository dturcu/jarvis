/**
 * Multi-viewpoint planner: planner → critic → revised plan.
 *
 * After the initial plan is built, a "critic" pass reviews it for:
 *   - Missing steps (e.g., approval gates not covered)
 *   - Redundant steps
 *   - Incorrect action types
 *   - Risk assessment
 *
 * The critic's feedback is fed back to the planner for a revised plan.
 */

import type { AgentPlan, PlanStep } from "@jarvis/agent-framework";
import type { PlannerDeps } from "./planner-real.js";
import { buildPlanWithInference } from "./planner-real.js";
import { formatAvailableJobTypes, normalizePlannedStep } from "./plan-actions.js";

export type CritiqueResult = {
  issues: string[];
  risks: string[];
  suggestions: string[];
  overall_assessment: "approve" | "revise" | "reject";
};

/**
 * Build a plan with critic review.
 *
 * Flow: plan → critique → (if revise) revised plan
 */
export async function buildPlanWithCritic(params: {
  agent_id: string;
  run_id: string;
  goal: string;
  system_prompt: string;
  context: string;
  capabilities: string[];
  max_steps: number;
  deps: PlannerDeps;
}): Promise<{ plan: AgentPlan; critique: CritiqueResult }> {
  const { deps } = params;

  // Step 1: Build initial plan
  const initialPlan = await buildPlanWithInference(params);

  if (initialPlan.steps.length === 0) {
    return {
      plan: initialPlan,
      critique: { issues: [], risks: [], suggestions: [], overall_assessment: "approve" },
    };
  }

  // Step 2: Critique the plan
  const critique = await critiquePlan(initialPlan, params, deps);

  deps.logger.info(`Plan critique for ${params.agent_id}: ${critique.overall_assessment}`, {
    issues: critique.issues.length,
    risks: critique.risks.length,
    suggestions: critique.suggestions.length,
  });

  // Step 3: If critic says revise, rebuild with feedback
  if (critique.overall_assessment === "revise" && (critique.issues.length > 0 || critique.suggestions.length > 0)) {
    const revisedPlan = await revisePlan(initialPlan, critique, params, deps);
    return { plan: revisedPlan, critique };
  }

  // If rejected, return empty plan
  if (critique.overall_assessment === "reject") {
    deps.logger.warn(`Plan rejected by critic for ${params.agent_id}: ${critique.issues.join("; ")}`);
    return {
      plan: { ...initialPlan, steps: [] },
      critique,
    };
  }

  return { plan: initialPlan, critique };
}

async function critiquePlan(
  plan: AgentPlan,
  params: { agent_id: string; system_prompt: string; capabilities: string[] },
  deps: PlannerDeps,
): Promise<CritiqueResult> {
  const planJson = JSON.stringify(plan.steps.map(s => ({
    step: s.step, action: s.action, input: s.input, reasoning: s.reasoning,
  })), null, 2);

  const prompt = `You are a plan critic reviewing an execution plan for the "${params.agent_id}" agent.

PLAN:
${planJson}

AVAILABLE JOB TYPES (the plan must use only these exact actions):
${formatAvailableJobTypes(params.capabilities) || "- none"}

Review this plan and output a JSON object:
{
  "issues": ["list of problems found"],
  "risks": ["list of potential risks"],
  "suggestions": ["list of improvements"],
  "overall_assessment": "approve" | "revise" | "reject"
}

Rules:
- "approve" if the plan is solid and addresses the goal
- "revise" if the plan has fixable issues
- "reject" only if the plan is fundamentally wrong or dangerous
- If the plan uses supported actions and is merely underspecified, choose "revise", not "reject".
- Check for: missing steps, wrong action types, redundant steps, security risks
- Any invented action family such as database.*, entity.*, file.*, collection.*, telegram.*, or synthesis.* is invalid.
- Output ONLY the JSON object, no markdown fences`;

  try {
    const content = await deps.chat(prompt, params.system_prompt);
    const parsed = JSON.parse(extractJsonObject(content)) as CritiqueResult;

    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      overall_assessment: ["approve", "revise", "reject"].includes(parsed.overall_assessment)
        ? parsed.overall_assessment
        : "approve",
    };
  } catch (e) {
    deps.logger.warn(`Critic failed for ${params.agent_id}: ${e instanceof Error ? e.message : String(e)}`);
    return { issues: [], risks: [], suggestions: [], overall_assessment: "approve" };
  }
}

async function revisePlan(
  originalPlan: AgentPlan,
  critique: CritiqueResult,
  params: {
    agent_id: string; run_id: string; goal: string;
    system_prompt: string; context: string;
    capabilities: string[]; max_steps: number;
    deps: PlannerDeps;
  },
  deps: PlannerDeps,
): Promise<AgentPlan> {
  const feedback = [
    ...critique.issues.map(i => `ISSUE: ${i}`),
    ...critique.suggestions.map(s => `SUGGESTION: ${s}`),
  ].join("\n");

  const originalSteps = JSON.stringify(originalPlan.steps.map(s => ({
    step: s.step, action: s.action, input: s.input, reasoning: s.reasoning,
  })), null, 2);

  const prompt = `You previously planned steps for "${params.agent_id}" but a critic found issues.

ORIGINAL PLAN:
${originalSteps}

CRITIC FEEDBACK:
${feedback}

AVAILABLE JOB TYPES (use only these exact action strings):
${formatAvailableJobTypes(params.capabilities) || "- none"}

Output a REVISED JSON array of steps addressing the feedback.
Maximum ${params.max_steps} steps. Output ONLY the JSON array.`;

  try {
    const content = await deps.chat(prompt, params.system_prompt);
    const steps = JSON.parse(extractJsonArray(content)) as PlanStep[];

    const validated: PlanStep[] = [];
    for (const rawStep of steps.slice(0, params.max_steps)) {
      if (!rawStep?.action || typeof rawStep.action !== "string") {
        continue;
      }

      const normalized = normalizePlannedStep({
        step: validated.length + 1,
        action: rawStep.action,
        input: rawStep.input ?? {},
        reasoning: rawStep.reasoning ?? "",
      }, params.capabilities);

      if (!normalized) {
        deps.logger.warn(`Critic revision produced unsupported action for ${params.agent_id}: ${rawStep.action}`);
        continue;
      }

      if (normalized.action !== rawStep.action) {
        deps.logger.info(`Normalized critic action for ${params.agent_id}: ${rawStep.action} -> ${normalized.action}`);
      }

      validated.push({ ...normalized, step: validated.length + 1 });
    }

    deps.logger.info(`Revised plan for ${params.agent_id}: ${validated.length} steps`);

    return {
      run_id: params.run_id,
      agent_id: params.agent_id,
      goal: params.goal,
      steps: validated,
      created_at: new Date().toISOString(),
    };
  } catch (e) {
    deps.logger.warn(`Plan revision failed for ${params.agent_id}, using original plan`);
    return originalPlan;
  }
}

function extractJsonObject(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const fenced = fenceMatch?.[1];
  if (fenced) return fenced.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function extractJsonArray(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const fenced = fenceMatch?.[1];
  if (fenced) return fenced.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}
