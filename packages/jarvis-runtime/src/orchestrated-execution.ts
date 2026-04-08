/**
 * Orchestrated multi-agent execution.
 *
 * Decomposes a goal into a DAG of sub-goals, then dispatches each
 * sub-goal through the real `runAgent()` path — preserving per-agent
 * context gathering, approval gates, run events, decision logs, and
 * artifact handling.
 *
 * The orchestrator's own `workflow.execute_multi` approval gate should
 * be checked by the caller before invoking this function.
 */

import { randomUUID } from "node:crypto";
import { GoalDecomposer, type AgentSummary } from "./goal-decomposer.js";
import { JobGraph } from "./job-graph.js";
import type { SubGoalRunResult } from "./meta-planner.js";
import type { SubGoal, JobGraphData } from "./orchestration-types.js";
import type { OrchestratorDeps } from "./orchestrator.js";
import type { AgentDefinition, AgentRun } from "@jarvis/agent-framework";

// ─── Types ──────────────────────────────────────────────────────────────────

export type OrchestratedResult = {
  status: "completed" | "failed" | "aborted";
  graph: JobGraphData;
  results: SubGoalRunResult[];
  merged_output: string;
  aborted_reason?: string;
};

export type OrchestratedExecutionConfig = {
  maxConcurrent?: number;
};

// ─── Execution ──────────────────────────────────────────────────────────────

/**
 * Decompose a goal into a DAG and execute each sub-goal through runAgent().
 *
 * Steps:
 * 1. Decompose the goal via LLM (or deterministic fallback) — once only.
 * 2. Validate the DAG (cycle check, agent existence).
 * 3. Execute sub-goals in topological order via runAgent(), respecting deps.
 * 4. Collect run outputs and merge into a composite deliverable.
 *
 * Each child agent runs through the full runtime execution contract:
 * context gathering, planning, step execution, approval gates, decision
 * logs, and lesson capture.  No shortcuts.
 */
export async function executeOrchestratedGoal(
  goal: string,
  deps: OrchestratorDeps,
  config?: OrchestratedExecutionConfig,
): Promise<OrchestratedResult> {
  const { runtime, registry, logger } = deps;
  const maxConcurrent = config?.maxConcurrent ?? 2;

  // 1. Decompose — once only, no re-decomposition
  const allAgents = runtime.listAgents();
  const agentSummaries: AgentSummary[] = allAgents
    .filter(a => a.agent_id !== "orchestrator")
    .map(a => ({
      agent_id: a.agent_id,
      description: a.description,
      capabilities: a.capabilities,
    }));

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
  const agentIds = new Set(allAgents.map(a => a.agent_id));
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

  // 2. Build the validated DAG from the single decomposition
  const graphData: JobGraphData = {
    graph_id: randomUUID(),
    root_goal: goal,
    sub_goals: subGoals,
    created_at: new Date().toISOString(),
    status: "executing",
  };
  const graph = new JobGraph(graphData);

  // 3. Execute sub-goals through runAgent() in topological order
  const allResults: SubGoalRunResult[] = [];

  // Lazy import to avoid circular dependency at module level.
  // orchestrated-execution.ts is imported by orchestrator.ts, so we
  // cannot statically import runAgent from orchestrator.ts.
  const { runAgent } = await import("./orchestrator.js");

  while (!graph.isComplete()) {
    const ready = graph.getReady();
    if (ready.length === 0) break;

    const batch = ready.slice(0, maxConcurrent);
    const promises = batch.map(async (sg): Promise<SubGoalRunResult> => {
      graph.markRunning(sg.sub_goal_id, randomUUID());
      logger.info(`Dispatching sub-goal to ${sg.agent_id}: ${sg.goal.slice(0, 80)}`);

      try {
        // Dispatch through the real agent execution path.
        // This preserves: context gathering, planning, step execution,
        // approval gates, run events, decision logs, and lesson capture.
        const childRun: AgentRun = await runAgent(
          sg.agent_id,
          { kind: "manual", goal: sg.goal },
          deps,
        );

        const succeeded = childRun.status === "completed";
        const summary = succeeded
          ? `Agent ${sg.agent_id} completed: ${(childRun as any).goal ?? sg.goal}`
          : `Agent ${sg.agent_id} failed: ${childRun.error ?? "unknown error"}`;

        if (succeeded) {
          graph.markCompleted(sg.sub_goal_id, summary);
        } else {
          graph.markFailed(sg.sub_goal_id, childRun.error ?? summary);
        }

        return {
          sub_goal_id: sg.sub_goal_id,
          run_id: childRun.run_id,
          status: succeeded ? "completed" : "failed",
          summary,
          error: childRun.error,
        };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        graph.markFailed(sg.sub_goal_id, error);
        return {
          sub_goal_id: sg.sub_goal_id,
          run_id: "",
          status: "failed",
          summary: `Agent ${sg.agent_id} failed: ${error}`,
          error,
        };
      }
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === "fulfilled") {
        allResults.push(result.value);
      }
    }
  }

  // 4. Build composite output from completed sub-goal runs
  const graphResult = graph.toJSON();
  const failed = allResults.filter(r => r.status === "failed");
  const completed = allResults.filter(r => r.status === "completed");

  const mergedOutput = completed.length > 0
    ? completed.map(r => `## ${r.sub_goal_id.slice(0, 8)} (${r.run_id.slice(0, 8)})\n${r.summary}`).join("\n\n---\n\n")
    : "(no completed sub-goals)";

  return {
    status: failed.length > 0 ? "failed" : "completed",
    graph: graphResult,
    results: allResults,
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
    const parts = id.split("-");
    return parts.some(p => p.length > 3 && lower.includes(p));
  });

  if (mentionedAgents.length >= 2) return true;

  const coordKeywords = ["and then", "followed by", "after that", "weekly report", "full review", "end to end", "comprehensive"];
  if (coordKeywords.some(kw => lower.includes(kw))) return true;

  return false;
}
