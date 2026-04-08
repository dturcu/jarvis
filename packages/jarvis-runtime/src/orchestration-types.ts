/**
 * Types for hierarchical goal decomposition and cross-agent orchestration.
 */

export type SubGoalStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type SubGoal = {
  sub_goal_id: string;
  parent_goal: string;
  agent_id: string;
  goal: string;
  depends_on: string[]; // sub_goal_ids that must complete first
  status: SubGoalStatus;
  run_id?: string;
  result_summary?: string;
  error?: string;
};

export type JobGraphStatus =
  | "planning"
  | "executing"
  | "completed"
  | "failed";

export type JobGraphData = {
  graph_id: string;
  root_goal: string;
  sub_goals: SubGoal[];
  created_at: string;
  status: JobGraphStatus;
};
