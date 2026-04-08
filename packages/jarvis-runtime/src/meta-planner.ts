import { randomUUID } from "node:crypto";
import { JobGraph } from "./job-graph.js";
import type { GoalDecomposer } from "./goal-decomposer.js";
import type { SubGoal, JobGraphData } from "./orchestration-types.js";

/**
 * Result of a single sub-goal agent run.
 */
export type SubGoalRunResult = {
  sub_goal_id: string;
  run_id: string;
  status: "completed" | "failed";
  summary: string;
  error?: string;
};

/**
 * Function signature for dispatching a single agent run.
 * Matches the existing `runAgent` pattern from the orchestrator.
 */
export type RunAgentFn = (
  agentId: string,
  goal: string,
) => Promise<SubGoalRunResult>;

export type MetaPlannerConfig = {
  maxConcurrent?: number;
};

export type MetaPlannerResult = {
  graph: JobGraphData;
  results: SubGoalRunResult[];
  status: "completed" | "failed";
  summary: string;
};

/**
 * Meta-planner that decomposes high-level goals into cross-agent job graphs
 * and orchestrates their execution respecting dependency order.
 *
 * Execution loop:
 * 1. Decompose goal into sub-goals via GoalDecomposer
 * 2. Build a JobGraph (validated DAG)
 * 3. Dispatch ready sub-goals via `runAgent`, respecting `maxConcurrent`
 * 4. Collect results, mark completed/failed, cascade skips
 * 5. Repeat until graph is complete
 * 6. Aggregate results into a summary
 */
export class MetaPlanner {
  private readonly maxConcurrent: number;

  constructor(
    private decomposer: GoalDecomposer,
    private runAgent: RunAgentFn,
    config: MetaPlannerConfig = {},
  ) {
    this.maxConcurrent = config.maxConcurrent ?? 3;
  }

  async execute(goal: string): Promise<MetaPlannerResult> {
    // 1. Decompose
    const subGoals = await this.decomposer.decompose(goal);
    if (subGoals.length === 0) {
      return {
        graph: this.emptyGraph(goal),
        results: [],
        status: "failed",
        summary: "Goal decomposition produced no sub-goals.",
      };
    }

    // 2. Build graph
    const graphData: JobGraphData = {
      graph_id: randomUUID(),
      root_goal: goal,
      sub_goals: subGoals,
      created_at: new Date().toISOString(),
      status: "executing",
    };
    const graph = new JobGraph(graphData);

    // 3-5. Execute loop
    const allResults: SubGoalRunResult[] = [];

    while (!graph.isComplete()) {
      const ready = graph.getReady();
      if (ready.length === 0) break; // Nothing left to execute

      // Dispatch up to maxConcurrent sub-goals in parallel
      const batch = ready.slice(0, this.maxConcurrent);
      const promises = batch.map((sg) => this.executeSingle(sg, graph));
      const results = await Promise.allSettled(promises);

      for (const result of results) {
        if (result.status === "fulfilled") {
          allResults.push(result.value);
        }
      }
    }

    // 6. Aggregate
    const graphResult = graph.toJSON();
    const failed = allResults.filter((r) => r.status === "failed");
    const completed = allResults.filter((r) => r.status === "completed");

    return {
      graph: graphResult,
      results: allResults,
      status: failed.length > 0 ? "failed" : "completed",
      summary: `Executed ${allResults.length} sub-goal(s): ${completed.length} completed, ${failed.length} failed.`,
    };
  }

  private async executeSingle(
    sg: SubGoal,
    graph: JobGraph,
  ): Promise<SubGoalRunResult> {
    const runId = randomUUID();
    graph.markRunning(sg.sub_goal_id, runId);

    try {
      const result = await this.runAgent(sg.agent_id, sg.goal);
      if (result.status === "completed") {
        graph.markCompleted(sg.sub_goal_id, result.summary);
      } else {
        graph.markFailed(sg.sub_goal_id, result.error ?? result.summary);
      }
      return { ...result, sub_goal_id: sg.sub_goal_id };
    } catch (e) {
      const error = (e as Error).message;
      graph.markFailed(sg.sub_goal_id, error);
      return {
        sub_goal_id: sg.sub_goal_id,
        run_id: runId,
        status: "failed",
        summary: `Agent ${sg.agent_id} failed: ${error}`,
        error,
      };
    }
  }

  private emptyGraph(goal: string): JobGraphData {
    return {
      graph_id: randomUUID(),
      root_goal: goal,
      sub_goals: [],
      created_at: new Date().toISOString(),
      status: "failed",
    };
  }
}
