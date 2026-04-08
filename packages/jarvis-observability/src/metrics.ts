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
