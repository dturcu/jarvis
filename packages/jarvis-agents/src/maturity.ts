/**
 * Agent maturity ladder.
 *
 * Agents progress:  experimental -> gated -> trusted
 *
 * Each level has entry criteria and rollback triggers.
 */

export type MaturityLevel = "experimental" | "gated" | "trusted";

export type PromotionCriteria = {
  level: MaturityLevel;
  entry_criteria: string[];
  rollback_triggers: string[];
  approval_policy: string;
  planner_mode: "single" | "critic" | "multi";
};

export const MATURITY_LADDER: PromotionCriteria[] = [
  {
    level: "experimental",
    entry_criteria: [
      "Agent definition exists with valid schema",
      "System prompt passes structural lint (decision loop, artifacts, NEVER section, completion/failure/escalation criteria)",
      "At least 5 eval fixtures exist",
      "Build compiles",
    ],
    rollback_triggers: [],
    approval_policy: "All outputs require human review before any action",
    planner_mode: "multi",
  },
  {
    level: "gated",
    entry_criteria: [
      "10+ eval fixture runs with scorecard pass rate >= 70%",
      "No critical failures in last 20 runs",
      "Retrieval grounding score >= 0.6 average across runs",
      "Approval correctness: 0 false-negatives (missed gates) in last 20 runs",
      "Artifact completeness >= 80% across runs",
      "Preview-mode run with no regressions vs prior version",
    ],
    rollback_triggers: [
      "2+ critical failures in any 7-day window",
      "Approval correctness drops below 100% (any missed gate)",
      "Scorecard pass rate drops below 60%",
    ],
    approval_policy: "Critical actions require approval; warning-level actions auto-proceed with logging",
    planner_mode: "critic",
  },
  {
    level: "trusted",
    entry_criteria: [
      "30+ production runs with scorecard pass rate >= 85%",
      "No critical failures in last 50 runs",
      "Retrieval grounding >= 0.75 average",
      "Approval correctness: 100% over 50 runs",
      "Artifact completeness >= 90%",
      "Self-reflection agent has not flagged this agent in last 4 weekly reports",
      "Human review of last 5 outputs confirms quality",
    ],
    rollback_triggers: [
      "Any critical failure",
      "Scorecard pass rate drops below 70% in rolling 20-run window",
      "Self-reflection flags agent in 2 consecutive weekly reports",
    ],
    approval_policy: "Only critical actions require approval; all other actions auto-proceed",
    planner_mode: "single",
  },
];

/**
 * Maps runtime maturity strings to the ladder.
 */
export function mapRuntimeMaturity(runtime: string): MaturityLevel {
  switch (runtime) {
    case "experimental": return "experimental";
    case "high_stakes_manual_gate": return "experimental";
    case "trusted_with_review": return "gated";
    case "operational": return "trusted";
    default: return "experimental";
  }
}
