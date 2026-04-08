import { randomUUID } from "node:crypto";
import type { SubGoal } from "./orchestration-types.js";

/**
 * Minimal agent definition for decomposition matching.
 */
export type AgentSummary = {
  agent_id: string;
  description: string;
  capabilities: string[];
};

/**
 * Decomposes a high-level goal into sub-goals mapped to available agents.
 *
 * Uses an LLM chat call when available. Falls back to deterministic
 * keyword matching against agent descriptions when inference is unavailable.
 */
export class GoalDecomposer {
  constructor(
    private agents: AgentSummary[],
    private chatFn?: (systemPrompt: string, userMessage: string) => Promise<string>,
  ) {}

  /**
   * Decompose a goal into agent-mapped sub-goals.
   */
  async decompose(goal: string): Promise<SubGoal[]> {
    if (this.chatFn) {
      try {
        return await this.decomposeViaLlm(goal);
      } catch {
        // Fall through to deterministic
      }
    }
    return this.decomposeDeterministic(goal);
  }

  private async decomposeViaLlm(goal: string): Promise<SubGoal[]> {
    const agentList = this.agents
      .map((a) => `- ${a.agent_id}: ${a.description}`)
      .join("\n");

    const systemPrompt = `You are a goal decomposition planner. Given a high-level goal and a list of available agents, break the goal into sub-goals. Each sub-goal must be assigned to exactly one agent.

Available agents:
${agentList}

Respond with a JSON array of objects:
[{ "agent_id": "...", "goal": "...", "depends_on_indices": [] }]

depends_on_indices is an array of 0-based indices into the result array (earlier sub-goals that must complete first). Keep the decomposition minimal — only create sub-goals that are necessary.`;

    const response = await this.chatFn!(systemPrompt, goal);

    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("LLM response did not contain a JSON array");
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      agent_id: string;
      goal: string;
      depends_on_indices?: number[];
    }>;

    // Generate IDs and resolve index-based dependencies to ID-based
    const ids = parsed.map(() => randomUUID());
    return parsed.map((item, i) => ({
      sub_goal_id: ids[i]!,
      parent_goal: goal,
      agent_id: item.agent_id,
      goal: item.goal,
      depends_on: (item.depends_on_indices ?? [])
        .filter((idx) => idx >= 0 && idx < i)
        .map((idx) => ids[idx]!),
      status: "pending" as const,
    }));
  }

  /**
   * Keyword-match the goal to the single most relevant agent.
   * Used as fallback when LLM is unavailable.
   */
  private decomposeDeterministic(goal: string): SubGoal[] {
    const goalLower = goal.toLowerCase();
    let bestAgent = this.agents[0];
    let bestScore = 0;

    for (const agent of this.agents) {
      let score = 0;
      const keywords = [
        agent.agent_id,
        ...agent.description.toLowerCase().split(/\s+/),
        ...agent.capabilities,
      ];
      for (const kw of keywords) {
        if (goalLower.includes(kw.toLowerCase())) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    if (!bestAgent) return [];

    return [
      {
        sub_goal_id: randomUUID(),
        parent_goal: goal,
        agent_id: bestAgent.agent_id,
        goal,
        depends_on: [],
        status: "pending",
      },
    ];
  }
}
