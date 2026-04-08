/**
 * Prometheus metric definitions for the Jarvis runtime.
 *
 * Uses prom-client for metric collection. All metrics are registered in the
 * default registry and can be scraped via the `/metrics` endpoint.
 */

import client from "prom-client";

// ── Histograms ──────────────────────────────────────────────────────────────

export const jobDurationSeconds = new client.Histogram({
  name: "jarvis_job_duration_seconds",
  help: "Duration of job execution in seconds",
  labelNames: ["job_type", "status", "worker_id"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
});

export const modelLatencySeconds = new client.Histogram({
  name: "jarvis_model_latency_seconds",
  help: "Inference model response latency in seconds",
  labelNames: ["model_id", "runtime"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
});

// ── Counters ────────────────────────────────────────────────────────────────

export const jobTotal = new client.Counter({
  name: "jarvis_job_total",
  help: "Total number of jobs processed",
  labelNames: ["job_type", "status"] as const,
});

// ── Gauges ──────────────────────────────────────────────────────────────────

export const workerHealthRatio = new client.Gauge({
  name: "jarvis_worker_health_ratio",
  help: "Worker health ratio (0 = unhealthy, 1 = healthy)",
  labelNames: ["worker_prefix"] as const,
});

export const queueDepth = new client.Gauge({
  name: "jarvis_queue_depth",
  help: "Number of jobs in the queue",
  labelNames: ["priority"] as const,
});

export const activeAgentRuns = new client.Gauge({
  name: "jarvis_active_agent_runs",
  help: "Number of currently executing agent runs",
  labelNames: ["agent_id"] as const,
});

// ── RAG & Knowledge Metrics ────────────────────────────────────────────────

export const ragRetrievalSeconds = new client.Histogram({
  name: "jarvis_rag_retrieval_seconds",
  help: "Hybrid RAG retrieval latency in seconds",
  labelNames: ["collection", "mode"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const embeddingChunksTotal = new client.Counter({
  name: "jarvis_embedding_chunks_total",
  help: "Total number of document chunks embedded",
  labelNames: ["collection"] as const,
});

export const knowledgeDocumentsTotal = new client.Gauge({
  name: "jarvis_knowledge_documents_total",
  help: "Total documents in the knowledge store",
  labelNames: ["collection"] as const,
});

// ── Approval Funnel Metrics ────────────────────────────────────────────────

export const approvalFunnelTotal = new client.Counter({
  name: "jarvis_approval_funnel_total",
  help: "Approval requests by outcome",
  labelNames: ["severity", "outcome"] as const,
});

// ── Provenance Metrics ─────────────────────────────────────────────────────

export const provenanceRecordsTotal = new client.Counter({
  name: "jarvis_provenance_records_total",
  help: "Total signed provenance records created",
  labelNames: ["job_type"] as const,
});

// ── Convergence Tracking Metrics (Platform Adoption Roadmap) ──────────────

export const webhookIngressTotal = new client.Counter({
  name: "jarvis_webhook_ingress_total",
  help: "Webhook ingress requests by source",
  labelNames: ["source"] as const, // "dashboard" | "openclaw"
});

export const inferenceRuntimeTotal = new client.Counter({
  name: "jarvis_inference_runtime_total",
  help: "Inference requests by runtime",
  labelNames: ["runtime"] as const, // "ollama" | "lmstudio" | "openclaw"
});

export const sessionModeTotal = new client.Counter({
  name: "jarvis_session_mode_total",
  help: "Session requests by mode",
  labelNames: ["mode"] as const, // "session" | "legacy"
});

export const browserBridgeTotal = new client.Counter({
  name: "jarvis_browser_bridge_total",
  help: "Browser job executions by bridge",
  labelNames: ["bridge"] as const, // "openclaw" | "legacy"
});

export const taskflowRunsTotal = new client.Counter({
  name: "jarvis_taskflow_runs_total",
  help: "Task/schedule runs by trigger source",
  labelNames: ["trigger"] as const, // "daemon_poll" | "taskflow" | "external"
});

export const memoryBoundaryViolationsTotal = new client.Counter({
  name: "jarvis_memory_boundary_violations_total",
  help: "Memory boundary violations detected",
  labelNames: ["category", "target_store"] as const,
});

export const inferenceCostUsdTotal = new client.Counter({
  name: "jarvis_inference_cost_usd_total",
  help: "Cumulative inference cost in USD",
  labelNames: ["runtime", "model"] as const,
});

export const inferenceLocalPercentage = new client.Gauge({
  name: "jarvis_inference_local_percentage",
  help: "Percentage of inference requests using local models (0-1)",
});

export const dreamingRunsTotal = new client.Counter({
  name: "jarvis_dreaming_runs_total",
  help: "Total dreaming consolidation runs",
  labelNames: ["status"] as const, // "completed" | "failed"
});

export const dreamingSynthesisTotal = new client.Counter({
  name: "jarvis_dreaming_synthesis_total",
  help: "Total items synthesized during dreaming",
  labelNames: ["mode", "agent_id"] as const,
});

export const wikiRetrievalTotal = new client.Counter({
  name: "jarvis_wiki_retrieval_total",
  help: "Wiki retrieval requests",
  labelNames: ["status"] as const, // "hit" | "miss" | "error"
});

export const legacyPathTraffic = new client.Counter({
  name: "jarvis_legacy_path_traffic_total",
  help: "Requests hitting legacy/deprecated paths",
  labelNames: ["path"] as const, // "/api/godmode/legacy", "/api/webhooks", etc.
});

// ── Convenience ─────────────────────────────────────────────────────────────

/**
 * Record metrics from a completed job execution.
 */
export function recordJobMetrics(
  jobType: string,
  status: "completed" | "failed",
  durationMs: number,
  workerId: string,
): void {
  const durationSec = durationMs / 1000;
  jobDurationSeconds.labels(jobType, status, workerId).observe(durationSec);
  jobTotal.labels(jobType, status).inc();
}

/**
 * Get all metrics in Prometheus exposition format.
 */
export async function getMetricsText(): Promise<string> {
  return client.register.metrics();
}

/**
 * Get the content type for Prometheus metrics.
 */
export function getMetricsContentType(): string {
  return client.register.contentType;
}
