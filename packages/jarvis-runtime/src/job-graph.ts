import type { SubGoal, JobGraphData, JobGraphStatus } from "./orchestration-types.js";

/**
 * Directed acyclic graph (DAG) of sub-goals with dependency tracking.
 *
 * Validates the graph has no cycles on construction. Provides methods to
 * determine which sub-goals are ready to execute, mark completions/failures,
 * and cascade skips to downstream dependents.
 */
export class JobGraph {
  private readonly subGoals: Map<string, SubGoal>;
  readonly graphId: string;
  readonly rootGoal: string;
  readonly createdAt: string;
  private _status: JobGraphStatus;

  constructor(data: JobGraphData) {
    this.graphId = data.graph_id;
    this.rootGoal = data.root_goal;
    this.createdAt = data.created_at;
    this._status = data.status;

    this.subGoals = new Map();
    for (const sg of data.sub_goals) {
      this.subGoals.set(sg.sub_goal_id, { ...sg });
    }

    this.validateDag();
  }

  get status(): JobGraphStatus {
    return this._status;
  }

  /**
   * Return sub-goals whose dependencies are all completed and that are still pending.
   */
  getReady(): SubGoal[] {
    const ready: SubGoal[] = [];
    for (const sg of this.subGoals.values()) {
      if (sg.status !== "pending") continue;
      const depsCompleted = sg.depends_on.every((depId) => {
        const dep = this.subGoals.get(depId);
        return dep?.status === "completed";
      });
      if (depsCompleted) ready.push(sg);
    }
    return ready;
  }

  /**
   * Mark a sub-goal as completed with a result summary.
   */
  markCompleted(subGoalId: string, resultSummary: string): void {
    const sg = this.requireSubGoal(subGoalId);
    sg.status = "completed";
    sg.result_summary = resultSummary;
    this.updateGraphStatus();
  }

  /**
   * Mark a sub-goal as failed. Downstream dependents are cascaded to "skipped".
   */
  markFailed(subGoalId: string, error: string): void {
    const sg = this.requireSubGoal(subGoalId);
    sg.status = "failed";
    sg.error = error;
    this.cascadeSkip(subGoalId);
    this.updateGraphStatus();
  }

  /**
   * Mark a sub-goal as running (dispatched to an agent).
   */
  markRunning(subGoalId: string, runId: string): void {
    const sg = this.requireSubGoal(subGoalId);
    sg.status = "running";
    sg.run_id = runId;
  }

  /**
   * Whether all sub-goals are in a terminal state.
   */
  isComplete(): boolean {
    for (const sg of this.subGoals.values()) {
      if (sg.status === "pending" || sg.status === "running") return false;
    }
    return true;
  }

  /**
   * Topological ordering of sub-goals.
   */
  topologicalOrder(): SubGoal[] {
    const visited = new Set<string>();
    const result: SubGoal[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const sg = this.subGoals.get(id);
      if (!sg) return;
      for (const depId of sg.depends_on) {
        visit(depId);
      }
      result.push(sg);
    };

    for (const id of this.subGoals.keys()) {
      visit(id);
    }
    return result;
  }

  /**
   * Serialize to plain object.
   */
  toJSON(): JobGraphData {
    return {
      graph_id: this.graphId,
      root_goal: this.rootGoal,
      sub_goals: [...this.subGoals.values()],
      created_at: this.createdAt,
      status: this._status,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private requireSubGoal(id: string): SubGoal {
    const sg = this.subGoals.get(id);
    if (!sg) throw new Error(`Sub-goal not found: ${id}`);
    return sg;
  }

  private validateDag(): void {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const id of this.subGoals.keys()) color.set(id, WHITE);

    const visit = (id: string): void => {
      color.set(id, GRAY);
      const sg = this.subGoals.get(id);
      if (sg) {
        for (const depId of sg.depends_on) {
          if (!this.subGoals.has(depId)) {
            throw new Error(`Sub-goal "${id}" depends on unknown sub-goal "${depId}"`);
          }
          const c = color.get(depId)!;
          if (c === GRAY) throw new Error(`Cycle detected involving sub-goal "${depId}"`);
          if (c === WHITE) visit(depId);
        }
      }
      color.set(id, BLACK);
    };

    for (const id of this.subGoals.keys()) {
      if (color.get(id) === WHITE) visit(id);
    }
  }

  private cascadeSkip(failedId: string): void {
    // BFS: skip all sub-goals transitively dependent on the failed one
    const queue = [failedId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const sg of this.subGoals.values()) {
        if (sg.depends_on.includes(currentId) && sg.status === "pending") {
          sg.status = "skipped";
          queue.push(sg.sub_goal_id);
        }
      }
    }
  }

  private updateGraphStatus(): void {
    if (!this.isComplete()) return;
    const hasFailed = [...this.subGoals.values()].some(
      (sg) => sg.status === "failed",
    );
    this._status = hasFailed ? "failed" : "completed";
  }
}
