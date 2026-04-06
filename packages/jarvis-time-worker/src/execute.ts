import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobStatus,
  type JarvisJobType,
  type Metrics,
} from "@jarvis/shared";
import {
  TimeWorkerError,
  type ExecutionOutcome,
  type TimeAdapter,
} from "./adapter.js";
import type {
  TimeListEntriesInput,
  TimeCreateEntryInput,
  TimeSummaryInput,
  TimeSyncInput,
} from "./types.js";

export const TIME_WORKER_ID = "time-worker";

export const TIME_JOB_TYPES = [
  "time.list_entries",
  "time.create_entry",
  "time.summary",
  "time.sync",
] as const;

export type TimeJobType = (typeof TIME_JOB_TYPES)[number];

export type TimeWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type TimeWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isTimeJobType(jobType: string): jobType is TimeJobType {
  return (TIME_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createTimeWorker(
  config: {
    adapter: TimeAdapter;
    workerId?: string;
    now?: () => Date;
  },
): TimeWorker {
  const workerId = config.workerId ?? TIME_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeTimeJob(envelope, config.adapter, { workerId, now: config.now }),
  };
}

export async function executeTimeJob(
  envelope: JobEnvelope,
  adapter: TimeAdapter,
  options: TimeWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? TIME_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isTimeJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Time worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: { supported_job_types: [...TIME_JOB_TYPES] },
      },
      workerId,
      startedAt,
      now().toISOString(),
    );
  }

  try {
    const outcome = await routeEnvelope(envelope, adapter);
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
    const jobError = toJobError(error, envelope.type as JarvisJobType);
    const status: JarvisJobStatus = "failed";
    return createFailureResult(envelope, status, jobError, workerId, startedAt, now().toISOString());
  }
}

async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: TimeAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "time.list_entries":
        return await adapter.listEntries(envelope.input as TimeListEntriesInput);
      case "time.create_entry":
        return await adapter.createEntry(envelope.input as TimeCreateEntryInput);
      case "time.summary":
        return await adapter.summary(envelope.input as TimeSummaryInput);
      case "time.sync":
        return await adapter.sync(envelope.input as TimeSyncInput);
      default:
        throw new TimeWorkerError(
          "INVALID_INPUT",
          `Unsupported time job type: ${String(envelope.type)}.`,
        );
    }
  } catch (error) {
    if (error instanceof TimeWorkerError) throw error;
    if (error instanceof TypeError) {
      throw new TimeWorkerError(
        "INVALID_INPUT",
        `Input validation failed for ${envelope.type}: ${(error as Error).message}`,
        false,
      );
    }
    throw error;
  }
}

function createFailureResult(
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

function createMetrics(
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

function toJobError(error: unknown, jobType: JarvisJobType): JobError {
  if (error instanceof TimeWorkerError) {
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
