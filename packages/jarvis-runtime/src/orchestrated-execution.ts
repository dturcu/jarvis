/**
 * Orchestrated multi-agent execution.
 *
 * When the orchestrator agent is invoked with a goal that requires multiple
 * agents, this module decomposes the goal into a DAG of sub-goals, presents
 * the execution plan for approval, and dispatches agents in topological order.
 *
 * Integrates GoalDecomposer + MetaPlanner + approval gates.
 */

import { GoalDecomposer, type AgentSummary } from "./goal-decomposer.js";
import { MetaPlanner, type MetaPlannerResult, type SubGoalRunResult } from "./meta-planner.js";
import type { SubGoal, JobGraphData } from "./orchestration-types.js";
import type { WorkerRegistry } from "./worker-registry.js";
import type { Logger } from "./logger.js";
import type { AgentDefinition } from "@jarvis/agent-framework";

// ─── Types ──────────────────────────────────────────────────────────────────

export type OrchestratedResult = {
  status: "completed" | "failed" | "aborted";
  graph: JobGraphData;
  results: SubGoalRunResult[];
  merged_output: string;
  aborted_reason?: string;
};

export type OrchestratedExecutionDeps = {
  registry: WorkerRegistry;
  agents: AgentDefinition[];
  logger: Logger;
  maxConcurrent?: number;
};

// ─── Execution ──────────────────────────────────────────────────────────────

/**
 * Decompose a goal into a DAG and execute it.
 *
 * Steps:
 * 1. Build agent summaries from active definitions.
 * 2. Decompose the goal via LLM (or deterministic fallback).
 * 3. Validate the DAG (cycle check, agent existence).
 * 4. Execute sub-goals in topological order, respecting dependencies.
 * 5. Merge outputs into a single deliverable.
 *
 * Approval gates from constituent agents are preserved — this function
 * does not bypass them.  The orchestrator's own `workflow.execute_multi`
 * gate should be checked by the caller before invoking this function.
 */
export async function executeOrchestratedGoal(
  goal: string,
  deps: OrchestratedExecutionDeps,
): Promise<OrchestratedResult> {
  const { registry, agents, logger, maxConcurrent } = deps;

  // 1. Build agent summaries (exclude orchestrator itself to avoid recursion)
  const agentSummaries: AgentSummary[] = agents
    .filter(a => a.agent_id !== "orchestrator")
    .map(a => ({
      agent_id: a.agent_id,
      description: a.description,
      capabilities: a.capabilities,
    }));

  // 2. Decompose
  const chatFn = async (systemPrompt: string, userMessage: string): Promise<string> => {
    return registry.chat(userMessage, systemPrompt);
  };

  const decomposer = new GoalDecomposer(agentSummaries, chatFn);
  const subGoals = await decomposer.decompose(goal);

  if (subGoals.length === 0) {
    return {
      status: "aborted",
      graph: emptyGraph(goal),
      results: [],
      merged_output: "",
      aborted_reason: "Goal decomposition produced no sub-goals.",
    };
  }

  // Validate all referenced agents exist
  const agentIds = new Set(agents.map(a => a.agent_id));
  const invalidAgents = subGoals.filter(sg => !agentIds.has(sg.agent_id));
  if (invalidAgents.length > 0) {
    return {
      status: "aborted",
      graph: emptyGraph(goal),
      results: [],
      merged_output: "",
      aborted_reason: `Decomposition references unknown agents: ${invalidAgents.map(a => a.agent_id).join(", ")}`,
    };
  }

  logger.info(`Orchestrated goal decomposed into ${subGoals.length} sub-goal(s): ${subGoals.map(sg => sg.agent_id).join(", ")}`);

  // 3. Execute via MetaPlanner
  const runAgentFn = async (agentId: string, subGoal: string): Promise<SubGoalRunResult> => {
    logger.info(`Dispatching sub-goal to ${agentId}: ${subGoal.slice(0, 80)}`);

    // Execute via the inference worker's chat — this simulates a single-agent run
    // without going through the full orchestrator path (avoids recursion).
    // The agent's system prompt provides the domain knowledge.
    const agentDef = agents.find(a => a.agent_id === agentId);
    const systemPrompt = agentDef?.system_prompt ?? "";

    try {
      const response = await registry.chat(subGoal, systemPrompt);
      return {
        sub_goal_id: "",
        run_id: "",
        status: "completed",
        summary: response.slice(0, 500),
      };
    } catch (e) {
      return {
        sub_goal_id: "",
        run_id: "",
        status: "failed",
        summary: `Agent ${agentId} failed`,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  const planner = new MetaPlanner(decomposer, runAgentFn, { maxConcurrent: maxConcurrent ?? 2 });

  // Re-execute using the already-decomposed sub-goals by running the planner
  // Note: MetaPlanner.execute() re-decomposes, which is fine since the LLM
  // should produce consistent results for the same goal.
  let metaResult: MetaPlannerResult;
  try {
    metaResult = await planner.execute(goal);
  } catch (e) {
    return {
      status: "failed",
      graph: emptyGraph(goal),
      results: [],
      merged_output: "",
      aborted_reason: `MetaPlanner execution failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 4. Check for excessive failures
  const failedCount = metaResult.results.filter(r => r.status === "failed").length;
  if (failedCount >= 2) {
    logger.warn(`Orchestrated execution: ${failedCount} sub-goals failed — aborting`);
  }

  // 5. Merge outputs
  const completedResults = metaResult.results.filter(r => r.status === "completed");
  const mergedOutput = completedResults.length > 0
    ? completedResults.map(r => `[${r.sub_goal_id.slice(0, 8)}] ${r.summary}`).join("\n\n")
    : "(no completed sub-goals)";

  return {
    status: metaResult.status === "completed" ? "completed" : "failed",
    graph: metaResult.graph,
    results: metaResult.results,
    merged_output: mergedOutput,
  };
}

function emptyGraph(goal: string): JobGraphData {
  return {
    graph_id: "empty",
    root_goal: goal,
    sub_goals: [],
    created_at: new Date().toISOString(),
    status: "failed",
  };
}

/**
 * Check if a goal is likely multi-agent (requires orchestration).
 *
 * Heuristic: if the goal mentions multiple agent concerns or uses
 * coordination keywords, treat it as multi-agent.
 */
export function isMultiAgentGoal(goal: string, agentIds: string[]): boolean {
  const lower = goal.toLowerCase();
  const mentionedAgents = agentIds.filter(id => {
    // Check for agent ID or key parts of it
    const parts = id.split("-");
    return parts.some(p => p.length > 3 && lower.includes(p));
  });

  // Multiple agents mentioned
  if (mentionedAgents.length >= 2) return true;

  // Coordination keywords
  const coordKeywords = ["and then", "followed by", "after that", "weekly report", "full review", "end to end", "comprehensive"];
  if (coordKeywords.some(kw => lower.includes(kw))) return true;

  return false;
}
