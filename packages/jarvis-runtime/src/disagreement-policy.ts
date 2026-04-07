/**
 * Disagreement policy: configures how the orchestrator responds to
 * multi-viewpoint planner disagreements.
 *
 * Severity levels:
 *   - minor: log and proceed with best plan (no operator involvement)
 *   - moderate: flag in output, proceed but mark run for review
 *   - severe: block execution, escalate to operator for approval
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type DisagreementSeverity = "minor" | "moderate" | "severe";

export type DisagreementPolicy = {
  /** Unique action threshold: fraction of actions unique to a single plan that triggers disagreement. Default: 0.3 */
  action_threshold: number;
  /** Step count ratio threshold: max/min ratio that triggers disagreement. Default: 1.5 */
  step_ratio_threshold: number;
  /** How to handle detected disagreement */
  on_disagreement: DisagreementSeverity;
  /** Timeout for approval wait (ms). Only used when on_disagreement is "severe". Default: 4h */
  approval_timeout_ms: number;
};

// ─── Defaults ───────────────────────────────────────────────────────────────

/** Default policy: severe disagreement blocks execution. */
export const DEFAULT_DISAGREEMENT_POLICY: DisagreementPolicy = {
  action_threshold: 0.3,
  step_ratio_threshold: 1.5,
  on_disagreement: "severe",
  approval_timeout_ms: 4 * 60 * 60 * 1000, // 4 hours
};

/** Relaxed policy for less critical workflows: moderate disagreement flags but proceeds. */
export const MODERATE_DISAGREEMENT_POLICY: DisagreementPolicy = {
  action_threshold: 0.3,
  step_ratio_threshold: 1.5,
  on_disagreement: "moderate",
  approval_timeout_ms: 4 * 60 * 60 * 1000,
};

/** Permissive policy: log disagreement but never block. */
export const MINOR_DISAGREEMENT_POLICY: DisagreementPolicy = {
  action_threshold: 0.3,
  step_ratio_threshold: 1.5,
  on_disagreement: "minor",
  approval_timeout_ms: 0,
};

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Classify disagreement severity from detection result.
 * Both heuristics firing = severe; action-only or step-only = moderate.
 */
export function classifyDisagreement(
  detected: { disagreement: boolean; reason: string },
  policy: DisagreementPolicy,
): DisagreementSeverity {
  if (!detected.disagreement) return "minor";

  // Both structural and action disagreement = always severe
  if (detected.reason.includes("substantially")) return "severe";

  // Single-dimension disagreement = use policy setting
  return policy.on_disagreement;
}

/**
 * Determine whether a disagreement should block execution.
 */
export function shouldBlockExecution(severity: DisagreementSeverity): boolean {
  return severity === "severe";
}

/**
 * Determine whether a disagreement should flag the run for review.
 */
export function shouldFlagForReview(severity: DisagreementSeverity): boolean {
  return severity === "moderate" || severity === "severe";
}
