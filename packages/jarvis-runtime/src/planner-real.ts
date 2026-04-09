import type { AgentPlan, PlanStep } from "@jarvis/agent-framework";
import type { Logger } from "./logger.js";

export type PlannerDeps = {
  /** Call inference.chat — accepts a prompt, returns completion text */
  chat: (prompt: string, systemPrompt?: string) => Promise<string>;
  logger: Logger;
};

/**
 * Build an agent plan by calling inference.chat.
 * The LLM receives the agent's system prompt + context and outputs
 * a JSON array of plan steps.
 */
export async function buildPlanWithInference(params: {
  agent_id: string;
  run_id: string;
  goal: string;
  system_prompt: string;
  context: string;
  capabilities: string[];
  max_steps: number;
  deps: PlannerDeps;
}): Promise<AgentPlan> {
  const { deps } = params;

  const userPrompt = `You are planning execution steps for the "${params.agent_id}" agent.

GOAL: ${params.goal}

AVAILABLE JOB TYPES (prefix families): ${params.capabilities.join(", ")}

LIVE CONTEXT:
${params.context.slice(0, 6000)}

Output a JSON array of steps to accomplish the goal. Each step:
{"step": 1, "action": "email.search", "input": {"query": "from:client@example.com"}, "reasoning": "Search for recent client emails"}

Rules:
- "action" MUST be a valid job type like "inference.chat", "email.search", "crm.list_pipeline", "web.search_news", "document.ingest", etc.
- Maximum ${params.max_steps} steps
- Be specific and actionable — each step should do ONE thing
- Output ONLY the JSON array, no markdown fences, no explanation`;

  let content: string;
  try {
    content = await deps.chat(userPrompt, params.system_prompt);
  } catch (e) {
    deps.logger.error(`Planner inference failed for ${params.agent_id}`, { error: String(e) });
    return { run_id: params.run_id, agent_id: params.agent_id, goal: params.goal, steps: [], created_at: new Date().toISOString() };
  }

  // Extract JSON from response (strip markdown fences if present)
  let steps: PlanStep[];
  try {
    steps = JSON.parse(extractJson(content)) as PlanStep[];
  } catch {
    // Retry once with correction prompt
    deps.logger.warn(`Planner produced invalid JSON for ${params.agent_id}, retrying`);
    try {
      const correction = await deps.chat(
        `Your previous response was not valid JSON. Please output ONLY a JSON array of steps, no markdown, no explanation. Previous response:\n${content.slice(0, 1000)}`,
        params.system_prompt,
      );
      steps = JSON.parse(extractJson(correction)) as PlanStep[];
    } catch {
      deps.logger.error(`Planner retry failed for ${params.agent_id}`);
      return { run_id: params.run_id, agent_id: params.agent_id, goal: params.goal, steps: [], created_at: new Date().toISOString() };
    }
  }

  // Validate and cap steps — input is optional (defaults to {})
  const validated = steps
    .filter(s => s.action && typeof s.action === "string")
    .slice(0, params.max_steps)
    .map((s, i) => ({
      step: i + 1,
      action: s.action,
      input: s.input ?? {},
      reasoning: s.reasoning ?? "",
    }));

  deps.logger.info(`Plan for ${params.agent_id}: ${validated.length} steps`, {
    steps: validated.map(s => s.action),
  });

  return {
    run_id: params.run_id,
    agent_id: params.agent_id,
    goal: params.goal,
    steps: validated,
    created_at: new Date().toISOString(),
  };
}

/** Strip markdown code fences and extract the JSON content */
function extractJson(text: string): string {
  // Remove ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // Find the first [ ... ] block if the whole response isn't an array
  if (!raw.startsWith("[")) {
    const arrayStart = raw.indexOf("[");
    const arrayEnd = raw.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      raw = raw.slice(arrayStart, arrayEnd + 1);
    }
  }

  // Repair common LLM JSON mistakes: trailing commas before ] or }
  raw = raw.replace(/,\s*([}\]])/g, "$1");

  return raw;
}
