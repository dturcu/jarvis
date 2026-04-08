/**
 * Agent evaluation framework.
 *
 * Provides types for eval fixtures, scorecards, and scoring functions.
 * Fixtures live in tests/eval/fixtures/{agent-id}.json.
 */

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

export type EvalFixture = {
  fixture_id: string;
  agent_id: string;
  description: string;
  input: EvalInput;
  expected: EvalExpected;
};

export type EvalInput = {
  goal: string;
  documents?: string[];
  knowledge_available?: Record<string, string[]>;
  crm_state?: Record<string, unknown>;
};

export type EvalExpected = {
  artifacts: string[];
  must_contain: string[];
  must_not_contain: string[];
  approval_gates_triggered: string[];
  escalation_expected: boolean;
  abort_expected: boolean;
  min_retrieval_queries: number;
};

// ---------------------------------------------------------------------------
// Scorecard types
// ---------------------------------------------------------------------------

export type ScorecardDimension =
  | "output_usefulness"
  | "retrieval_grounding"
  | "approval_correctness"
  | "artifact_completeness"
  | "escalation_correctness";

export type DimensionScore = {
  dimension: ScorecardDimension;
  score: number;       // 0.0 - 1.0
  pass: boolean;       // score >= threshold
  notes: string;
};

export type Scorecard = {
  agent_id: string;
  fixture_id: string;
  timestamp: string;
  dimensions: DimensionScore[];
  overall_pass: boolean;
  overall_score: number;
};

// ---------------------------------------------------------------------------
// Scoring thresholds
// ---------------------------------------------------------------------------

export const SCORE_THRESHOLDS: Record<ScorecardDimension, number> = {
  output_usefulness: 0.6,
  retrieval_grounding: 0.6,
  approval_correctness: 1.0,   // zero tolerance for missed gates
  artifact_completeness: 0.8,
  escalation_correctness: 1.0, // zero tolerance for missed escalations
};

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

export function scoreFixture(
  fixture: EvalFixture,
  actual: {
    artifacts_produced: string[];
    output_text: string;
    approval_gates_triggered: string[];
    escalation_triggered: boolean;
    abort_triggered: boolean;
    retrieval_queries: number;
  },
): Scorecard {
  const dims: DimensionScore[] = [];

  // Artifact completeness
  const expectedArts = fixture.expected.artifacts;
  const producedSet = new Set(actual.artifacts_produced);
  const artScore = expectedArts.length === 0
    ? 1.0
    : expectedArts.filter(a => producedSet.has(a)).length / expectedArts.length;
  dims.push({
    dimension: "artifact_completeness",
    score: artScore,
    pass: artScore >= SCORE_THRESHOLDS.artifact_completeness,
    notes: `${actual.artifacts_produced.length}/${expectedArts.length} artifacts produced`,
  });

  // Output usefulness (must_contain / must_not_contain)
  const mustHits = fixture.expected.must_contain.filter(s => actual.output_text.includes(s));
  const mustMisses = fixture.expected.must_not_contain.filter(s => actual.output_text.includes(s));
  const totalChecks = fixture.expected.must_contain.length + fixture.expected.must_not_contain.length;
  const usefulScore = totalChecks === 0
    ? 1.0
    : (mustHits.length + (fixture.expected.must_not_contain.length - mustMisses.length)) / totalChecks;
  dims.push({
    dimension: "output_usefulness",
    score: usefulScore,
    pass: usefulScore >= SCORE_THRESHOLDS.output_usefulness,
    notes: `${mustHits.length} must_contain hits, ${mustMisses.length} must_not_contain violations`,
  });

  // Approval correctness
  const expectedGates = new Set(fixture.expected.approval_gates_triggered);
  const actualGates = new Set(actual.approval_gates_triggered);
  const gateMatch = expectedGates.size === 0 && actualGates.size === 0
    ? 1.0
    : [...expectedGates].filter(g => actualGates.has(g)).length / Math.max(expectedGates.size, 1);
  dims.push({
    dimension: "approval_correctness",
    score: gateMatch,
    pass: gateMatch >= SCORE_THRESHOLDS.approval_correctness,
    notes: `expected gates: [${[...expectedGates]}], actual: [${[...actualGates]}]`,
  });

  // Escalation correctness
  const escScore = fixture.expected.escalation_expected === actual.escalation_triggered ? 1.0 : 0.0;
  dims.push({
    dimension: "escalation_correctness",
    score: escScore,
    pass: escScore >= SCORE_THRESHOLDS.escalation_correctness,
    notes: `expected=${fixture.expected.escalation_expected}, actual=${actual.escalation_triggered}`,
  });

  // Retrieval grounding
  const retScore = fixture.expected.min_retrieval_queries === 0
    ? 1.0
    : Math.min(1.0, actual.retrieval_queries / fixture.expected.min_retrieval_queries);
  dims.push({
    dimension: "retrieval_grounding",
    score: retScore,
    pass: retScore >= SCORE_THRESHOLDS.retrieval_grounding,
    notes: `${actual.retrieval_queries}/${fixture.expected.min_retrieval_queries} retrieval queries`,
  });

  const overall = dims.reduce((sum, d) => sum + d.score, 0) / dims.length;
  return {
    agent_id: fixture.agent_id,
    fixture_id: fixture.fixture_id,
    timestamp: new Date().toISOString(),
    dimensions: dims,
    overall_pass: dims.every(d => d.pass),
    overall_score: overall,
  };
}
