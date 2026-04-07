/**
 * Artifact lifecycle state machine.
 * Manages formal artifact states: draft → review → approved → delivered → superseded.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ArtifactState = "draft" | "review" | "approved" | "delivered" | "superseded";

export type ArtifactLifecycleEntry = {
  artifact_id: string;
  kind: string;
  name: string;
  state: ArtifactState;
  version: number;
  run_id: string;
  agent_id: string;
  superseded_by?: string;
  reviewed_by?: string;
  review_note?: string;
  created_at: string;
  updated_at: string;
};

// ─── State Machine ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ArtifactState, ArtifactState[]> = {
  draft: ["review", "superseded"],
  review: ["approved", "draft", "superseded"],
  approved: ["delivered", "superseded"],
  delivered: ["superseded"],
  superseded: [],
};

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: ArtifactState, to: ArtifactState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get allowed transitions from a given state.
 */
export function getAllowedTransitions(state: ArtifactState): ArtifactState[] {
  return VALID_TRANSITIONS[state] ?? [];
}

/**
 * Check if an artifact state requires approval before delivery.
 */
export function requiresApproval(state: ArtifactState): boolean {
  return state === "draft" || state === "review";
}

/**
 * Check if an artifact can be delivered.
 */
export function canDeliver(state: ArtifactState): boolean {
  return state === "approved";
}

/**
 * Check if an artifact is in a terminal state.
 */
export function isTerminal(state: ArtifactState): boolean {
  return state === "superseded";
}
