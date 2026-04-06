export type AgentTrigger =
  | { kind: "schedule"; cron: string }
  | { kind: "event"; event_type: string }
  | { kind: "manual" }
  | { kind: "threshold"; alert_id: string };

export type ApprovalGate = {
  action: string;
  severity: "info" | "warning" | "critical";
  auto_approve_after_seconds?: number;
};

/** What the task needs to accomplish. */
export type TaskObjective =
  | "plan"
  | "execute"
  | "critique"
  | "summarize"
  | "extract"
  | "classify"
  | "answer"
  | "code"
  | "rag_synthesis";

/** Preferences that influence model choice when multiple candidates exist. */
export type TaskPreferences = {
  prioritize_speed?: boolean;
  prioritize_accuracy?: boolean;
  prioritize_code_quality?: boolean;
  deterministic?: boolean;
};

/** Constraints on model selection. */
export type TaskConstraints = {
  require_json?: boolean;
  require_tools?: boolean;
  require_vision?: boolean;
  max_latency_ms?: number;
  min_context_window?: number;
  prefer_local_only?: boolean;
};

/**
 * Describes what a task needs from the model.
 * Mirrors the shape from @jarvis/inference task-profile.ts.
 */
export type TaskProfile = {
  objective: TaskObjective;
  constraints?: TaskConstraints;
  preferences?: TaskPreferences;
};

/**
 * Controls how many viewpoints participate in plan generation.
 * - "single": one planner, no review (default, fast)
 * - "critic": plan → critic review → optional revision
 * - "multi": N independent planners → evaluator picks best → optional critic
 */
export type PlannerMode = "single" | "critic" | "multi";

/**
 * Agent maturity levels control operational trust and review requirements.
 * - "experimental": development/testing only, not scheduled
 * - "operational": runs on schedule, standard approval gates
 * - "trusted_with_review": runs autonomously but all outputs reviewed post-hoc
 * - "high_stakes_manual_gate": every externally-visible action requires human approval
 */
export type AgentMaturity = "experimental" | "operational" | "trusted_with_review" | "high_stakes_manual_gate";

export type AgentDefinition = {
  agent_id: string;
  label: string;
  version: string;
  description: string;
  triggers: AgentTrigger[];
  capabilities: string[];
  approval_gates: ApprovalGate[];
  knowledge_collections: string[];
  task_profile: TaskProfile;
  max_steps_per_run: number;
  system_prompt: string;
  output_channels: string[];
  planner_mode?: PlannerMode;
  maturity?: AgentMaturity;
  /** When true, the agent is not part of the V1 production set and may be unstable. */
  experimental?: boolean;
};
