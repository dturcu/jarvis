/**
 * Review report builder for the self-reflection agent.
 *
 * Collects metrics from run-store, approval-bridge, and knowledge-store,
 * then assembles a structured ReviewReport artifact.  The report is stored
 * in the "lessons" knowledge collection for downstream consumption.
 *
 * This module does NOT produce improvement proposals — that's the LLM's job.
 * It provides the data substrate the LLM reasons over.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ProposalCategory =
  | "prompt_change"
  | "schema_enhancement"
  | "knowledge_gap"
  | "retrieval_miss"
  | "approval_friction"
  | "workflow_optimization";

export type ProposalPriority = "critical" | "high" | "medium" | "low";

export type ImprovementProposal = {
  category: ProposalCategory;
  target: string;
  observation: string;
  recommendation: string;
  expected_impact: string;
  priority: ProposalPriority;
  source_run_ids?: string[];
  source_approval_ids?: string[];
};

export type AgentMetrics = {
  agent_id: string;
  total: number;
  completed: number;
  failed: number;
  success_rate: number;
  avg_steps: number;
};

export type ApprovalMetricsSummary = {
  total: number;
  approved: number;
  rejected: number;
  rejection_rate: number;
  avg_latency_ms: number | null;
  by_action: Array<{ action: string; total: number; rejected: number }>;
  by_severity: Array<{ severity: string; total: number; rejected: number }>;
};

export type KnowledgeMetricsSummary = {
  total_documents: number;
  collections: Record<string, number>;
  stale_count: number;
  thin_collections: Array<{ collection: string; count: number }>;
  freshness: Array<{ collection: string; count: number; newest: string }>;
};

export type ReviewReport = {
  report_id: string;
  period_start: string;
  period_end: string;
  health_score: number;
  proposals: ImprovementProposal[];
  agent_metrics: AgentMetrics[];
  system_metrics: {
    total_runs: number;
    completed: number;
    failed: number;
    success_rate: number;
    active_agents: number;
  };
  approval_metrics: ApprovalMetricsSummary;
  knowledge_metrics: KnowledgeMetricsSummary;
  failure_modes: Array<{ error: string; count: number; agent_id: string }>;
  previous_report_id?: string;
};

// ─── Health score calculation ───────────────────────────────────────────────

/**
 * Calculate a system health score from 0-100.
 *
 * Weighted components:
 * - Run success rate: 40 points (100% success = 40)
 * - Approval rejection rate: 20 points (0% rejection = 20)
 * - Knowledge coverage: 20 points (no thin collections = 20)
 * - Agent coverage: 20 points (all agents ran at least once = 20)
 */
export function calculateHealthScore(
  systemStats: { success_rate: number; active_agents: number },
  approvalMetrics: { rejection_rate: number },
  knowledgeMetrics: { thin_collections: Array<unknown> },
  totalRegisteredAgents: number,
): number {
  const runScore = Math.round(systemStats.success_rate * 40);
  const approvalScore = Math.round((1 - approvalMetrics.rejection_rate) * 20);
  const knowledgeScore = knowledgeMetrics.thin_collections.length === 0 ? 20 : Math.max(0, 20 - knowledgeMetrics.thin_collections.length * 4);
  const agentCoverage = totalRegisteredAgents > 0
    ? Math.round((systemStats.active_agents / totalRegisteredAgents) * 20)
    : 20;

  return Math.min(100, Math.max(0, runScore + approvalScore + knowledgeScore + agentCoverage));
}

/**
 * Assemble a ReviewReport from collected metrics.
 *
 * This produces the data frame — the LLM adds proposals, observation
 * text, and rankings in the self-reflection agent execution.
 */
export function assembleReport(params: {
  agentMetrics: AgentMetrics[];
  systemMetrics: ReviewReport["system_metrics"];
  approvalMetrics: ApprovalMetricsSummary;
  knowledgeMetrics: KnowledgeMetricsSummary;
  failureModes: ReviewReport["failure_modes"];
  healthScore: number;
  periodDays?: number;
  previousReportId?: string;
}): ReviewReport {
  const now = new Date();
  const periodDays = params.periodDays ?? 7;
  const periodStart = new Date(now.getTime() - periodDays * 86400000);

  return {
    report_id: `rr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    period_start: periodStart.toISOString(),
    period_end: now.toISOString(),
    health_score: params.healthScore,
    proposals: [], // LLM fills these during agent execution
    agent_metrics: params.agentMetrics,
    system_metrics: params.systemMetrics,
    approval_metrics: params.approvalMetrics,
    knowledge_metrics: params.knowledgeMetrics,
    failure_modes: params.failureModes,
    previous_report_id: params.previousReportId,
  };
}
