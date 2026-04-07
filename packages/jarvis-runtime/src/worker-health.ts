/**
 * Worker health monitor. Tracks per-worker execution outcomes
 * and provides health classification for the health report.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type WorkerHealthStatus = "healthy" | "degraded" | "unhealthy";

export type WorkerHealthEntry = {
  prefix: string;
  isolation: string;
  status: WorkerHealthStatus;
  total_executions: number;
  total_failures: number;
  total_timeouts: number;
  failure_rate: number;
  last_execution_at: string | null;
  last_failure_at: string | null;
};

type ExecutionOutcome = {
  success: boolean;
  durationMs: number;
  timestamp: number;
  timedOut?: boolean;
};

// ─── Monitor ────────────────────────────────────────────────────────────────

const RING_BUFFER_SIZE = 50;

export class WorkerHealthMonitor {
  private entries = new Map<string, {
    isolation: string;
    outcomes: ExecutionOutcome[];
    totalExecutions: number;
    totalFailures: number;
    totalTimeouts: number;
    lastExecutionAt: number | null;
    lastFailureAt: number | null;
  }>();

  /** Initialize health tracking for a set of known worker prefixes. */
  constructor(knownPrefixes?: Record<string, { isolation: string }>) {
    if (knownPrefixes) {
      for (const [prefix, meta] of Object.entries(knownPrefixes)) {
        this.entries.set(prefix, {
          isolation: meta.isolation,
          outcomes: [],
          totalExecutions: 0,
          totalFailures: 0,
          totalTimeouts: 0,
          lastExecutionAt: null,
          lastFailureAt: null,
        });
      }
    }
  }

  /** Record a worker execution outcome. */
  recordExecution(prefix: string, durationMs: number, success: boolean): void {
    const entry = this.getOrCreate(prefix);
    const outcome: ExecutionOutcome = { success, durationMs, timestamp: Date.now() };

    // Ring buffer: drop oldest if full
    if (entry.outcomes.length >= RING_BUFFER_SIZE) {
      entry.outcomes.shift();
    }
    entry.outcomes.push(outcome);

    entry.totalExecutions++;
    entry.lastExecutionAt = Date.now();
    if (!success) {
      entry.totalFailures++;
      entry.lastFailureAt = Date.now();
    }
  }

  /** Record a timeout (counts as a failure). */
  recordTimeout(prefix: string): void {
    const entry = this.getOrCreate(prefix);
    const outcome: ExecutionOutcome = { success: false, durationMs: 0, timestamp: Date.now(), timedOut: true };

    if (entry.outcomes.length >= RING_BUFFER_SIZE) {
      entry.outcomes.shift();
    }
    entry.outcomes.push(outcome);

    entry.totalExecutions++;
    entry.totalFailures++;
    entry.totalTimeouts++;
    entry.lastExecutionAt = Date.now();
    entry.lastFailureAt = Date.now();
  }

  /** Get health status for all tracked workers. */
  getHealthReport(): WorkerHealthEntry[] {
    const report: WorkerHealthEntry[] = [];
    for (const [prefix, entry] of this.entries) {
      const failureRate = entry.outcomes.length > 0
        ? entry.outcomes.filter(o => !o.success).length / entry.outcomes.length
        : 0;

      let status: WorkerHealthStatus = "healthy";
      if (entry.outcomes.length > 0) {
        if (failureRate > 0.5) status = "unhealthy";
        else if (failureRate > 0.1) status = "degraded";
      }

      report.push({
        prefix,
        isolation: entry.isolation,
        status,
        total_executions: entry.totalExecutions,
        total_failures: entry.totalFailures,
        total_timeouts: entry.totalTimeouts,
        failure_rate: Math.round(failureRate * 100) / 100,
        last_execution_at: entry.lastExecutionAt ? new Date(entry.lastExecutionAt).toISOString() : null,
        last_failure_at: entry.lastFailureAt ? new Date(entry.lastFailureAt).toISOString() : null,
      });
    }
    return report;
  }

  /** Get health status for a specific worker. */
  getWorkerHealth(prefix: string): WorkerHealthEntry | undefined {
    return this.getHealthReport().find(e => e.prefix === prefix);
  }

  /** Reset all tracking state. */
  reset(): void {
    for (const entry of this.entries.values()) {
      entry.outcomes = [];
      entry.totalExecutions = 0;
      entry.totalFailures = 0;
      entry.totalTimeouts = 0;
      entry.lastExecutionAt = null;
      entry.lastFailureAt = null;
    }
  }

  private getOrCreate(prefix: string) {
    let entry = this.entries.get(prefix);
    if (!entry) {
      entry = {
        isolation: "in_process",
        outcomes: [],
        totalExecutions: 0,
        totalFailures: 0,
        totalTimeouts: 0,
        lastExecutionAt: null,
        lastFailureAt: null,
      };
      this.entries.set(prefix, entry);
    }
    return entry;
  }
}
