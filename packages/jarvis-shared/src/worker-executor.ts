/**
 * Generic worker executor — eliminates boilerplate across all worker packages.
 *
 * Each worker defines only:
 *   1. Its JOB_TYPES array
 *   2. A router function (envelope, adapter) => ExecutionOutcome
 *   3. Its WorkerError subclass
 *
 * This module provides the rest: the executor, factory, failure result builder,
 * metrics builder, and error converter.
 */

import type {
  JobEnvelope,
  JobError,
  JobResult,
  Metrics,
} from "./types.js";
import {
  CONTRACT_VERSION,
  type JarvisJobStatus,
  type JarvisJobType,
} from "./contracts.js";

// ─── Types ────────────────────────────────────────────────────────────────

/** The outcome returned by adapter methods. */
export type ExecutionOutcome<T = unknown> = {
  summary: string;
  structured_output: T;
};

/** A typed worker error with code, retryable flag, and optional details. */
export interface WorkerErrorLike extends Error {
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/** Configuration for creating a generic worker. */
export type WorkerConfig<TAdapter> = {
  /** Worker identifier, e.g. "email-worker" */
  workerId: string;
  /** Readonly array of supported job type strings */
  jobTypes: readonly string[];
  /** The adapter instance for this worker */
  adapter: TAdapter;
  /** Optional clock override for testing */
  now?: () => Date;
  /** Route an envelope to the appropriate adapter method */
  route: (envelope: JobEnvelope, adapter: TAdapter) => Promise<ExecutionOutcome>;
  /** Check if an error is the domain-specific WorkerError subclass */
  isWorkerError: (error: unknown) => error is WorkerErrorLike;
};

export type GenericWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

// ─── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a worker with standardized execute behavior.
 * The only domain-specific part is the `route` function.
 */
export function createGenericWorker<TAdapter>(
  config: WorkerConfig<TAdapter>,
): GenericWorker {
  const { workerId, jobTypes, adapter, route, isWorkerError } = config;
  const now = config.now ?? (() => new Date());

  return {
    workerId,
    execute: async (envelope: JobEnvelope): Promise<JobResult> => {
      const startedAt = now().toISOString();

      // Type guard: reject jobs this worker can't handle
      if (!(jobTypes as readonly string[]).includes(envelope.type)) {
        return createFailureResult(
          envelope,
          "failed",
          {
            code: "INVALID_INPUT",
            message: `Worker ${workerId} cannot execute ${envelope.type}.`,
            retryable: false,
            details: { supported_job_types: [...jobTypes] },
          },
          workerId,
          startedAt,
          now().toISOString(),
        );
      }

      try {
        const outcome = await route(envelope, adapter);
        return {
          contract_version: CONTRACT_VERSION,
          job_id: envelope.job_id,
          job_type: envelope.type,
          status: "completed",
          summary: outcome.summary,
          attempt: envelope.attempt,
          structured_output: outcome.structured_output as Record<string, unknown>,
          metrics: createMetrics(envelope.attempt, workerId, startedAt, now().toISOString()),
        };
      } catch (error) {
        const jobError = toJobError(error, envelope.type as JarvisJobType, isWorkerError);
        return createFailureResult(
          envelope,
          "failed",
          jobError,
          workerId,
          startedAt,
          now().toISOString(),
        );
      }
    },
  };
}

// ─── Shared Helpers ───────────────────────────────────────────────────────

/** Build a failure JobResult. */
export function createFailureResult(
  envelope: JobEnvelope,
  status: JarvisJobStatus,
  error: JobError,
  workerId: string,
  startedAt: string,
  finishedAt: string,
): JobResult {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: envelope.job_id,
    job_type: envelope.type,
    status,
    summary: `Failed to run ${envelope.type}.`,
    attempt: envelope.attempt,
    error,
    metrics: createMetrics(envelope.attempt, workerId, startedAt, finishedAt),
  };
}

/** Build standard worker metrics. */
export function createMetrics(
  attempt: number,
  workerId: string,
  startedAt: string,
  finishedAt: string,
): Metrics {
  return {
    started_at: startedAt,
    finished_at: finishedAt,
    attempt,
    worker_id: workerId,
  };
}

/** Convert an unknown error to a structured JobError. */
export function toJobError(
  error: unknown,
  jobType: JarvisJobType,
  isWorkerError: (e: unknown) => e is WorkerErrorLike,
): JobError {
  if (isWorkerError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message || `Unexpected failure while running ${jobType}.`,
      retryable: false,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: `Unexpected failure while running ${jobType}.`,
    retryable: false,
  };
}

/** Type guard helper: returns true if the job type is in the given array. */
export function isJobTypeIn<T extends string>(
  jobType: string,
  types: readonly T[],
): jobType is T {
  return (types as readonly string[]).includes(jobType);
}
