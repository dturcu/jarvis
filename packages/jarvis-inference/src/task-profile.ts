/**
 * Model-agnostic task profile and selection policy types.
 *
 * Replaces the provider-shaped haiku/sonnet/opus tier system with
 * capability-based routing that works with any local model runtime.
 */

/** What the task needs to accomplish. */
export type TaskObjective =
  | "plan"           // multi-step reasoning, agent planning
  | "execute"        // tool execution, action dispatch
  | "critique"       // review and challenge a plan or output
  | "summarize"      // condense information
  | "extract"        // pull structured data from unstructured input
  | "classify"       // categorize, score, label
  | "answer"         // direct Q&A
  | "code"           // generate or review code
  | "rag_synthesis"; // synthesize from retrieved documents

/** Constraints on model selection. */
export type TaskConstraints = {
  require_json?: boolean;
  require_tools?: boolean;
  require_vision?: boolean;
  max_latency_ms?: number;
  min_context_window?: number;
  prefer_local_only?: boolean;
};

/** Preferences that influence model choice when multiple candidates exist. */
export type TaskPreferences = {
  prioritize_speed?: boolean;
  prioritize_accuracy?: boolean;
  prioritize_code_quality?: boolean;
  deterministic?: boolean;
};

/**
 * Describes what a task needs from the model.
 * Used by agents to declare their inference requirements without
 * naming specific models or provider tiers.
 */
export type TaskProfile = {
  objective: TaskObjective;
  constraints?: TaskConstraints;
  preferences?: TaskPreferences;
};

/**
 * Policy for selecting a model from available local models.
 * Each policy maps to a selection strategy.
 */
export type SelectionPolicy =
  | "pinned"                // use explicit model from config
  | "fastest_local"         // prefer smallest parameter count
  | "balanced_local"        // prefer 7-13B models
  | "best_reasoning_local"  // prefer largest available model
  | "best_code_local"       // prefer code-specialized, fall back to largest
  | "json_reliable_local"   // prefer models with proven JSON output
  | "embedding_local"       // prefer dedicated embedding models
  | "vision_local";         // prefer vision-capable models

/**
 * Derive a default SelectionPolicy from a TaskProfile.
 * Used when no explicit policy is configured.
 */
export function derivePolicy(profile: TaskProfile): SelectionPolicy {
  // Speed-first tasks
  if (profile.preferences?.prioritize_speed) {
    return "fastest_local";
  }

  // Vision tasks
  if (profile.constraints?.require_vision) {
    return "vision_local";
  }

  // Code tasks
  if (profile.objective === "code" || profile.preferences?.prioritize_code_quality) {
    return "best_code_local";
  }

  // JSON-heavy tasks
  if (profile.constraints?.require_json) {
    return "json_reliable_local";
  }

  // Accuracy-first tasks (complex reasoning)
  if (profile.preferences?.prioritize_accuracy) {
    return "best_reasoning_local";
  }

  // Simple classification/extraction
  if (profile.objective === "classify" || profile.objective === "extract") {
    return "fastest_local";
  }

  // Default: balanced
  return "balanced_local";
}
