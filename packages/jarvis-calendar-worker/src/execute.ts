import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobStatus,
  type JarvisJobType,
  type Metrics
} from "@jarvis/shared";
import {
  CalendarWorkerError,
  type CalendarExecutionOutcome,
  type CalendarAdapter
} from "./adapter.js";
import type {
  CalendarListEventsInput,
  CalendarCreateEventInput,
  CalendarUpdateEventInput,
  CalendarFindFreeInput,
  CalendarBriefInput
} from "./types.js";

export const CALENDAR_WORKER_ID = "calendar-worker";

export const CALENDAR_JOB_TYPES = [
  "calendar.list_events",
  "calendar.create_event",
  "calendar.update_event",
  "calendar.find_free",
  "calendar.brief"
] as const;

export type CalendarJobType = (typeof CALENDAR_JOB_TYPES)[number];

export type CalendarWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type CalendarWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isCalendarJobType(jobType: string): jobType is CalendarJobType {
  return (CALENDAR_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createCalendarWorker(
  config: {
    adapter: CalendarAdapter;
    workerId?: string;
    now?: () => Date;
  },
): CalendarWorker {
  const workerId = config.workerId ?? CALENDAR_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeCalendarJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeCalendarJob(
  envelope: JobEnvelope,
  adapter: CalendarAdapter,
  options: CalendarWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? CALENDAR_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isCalendarJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Calendar worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...CALENDAR_JOB_TYPES]
        }
      },
      workerId,
      startedAt,
      now().toISOString()
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
      metrics: createMetrics(envelope.attempt, workerId, startedAt, now().toISOString())
    };
  } catch (error) {
    const jobError = toJobError(error, envelope.type as JarvisJobType);
    const status: JarvisJobStatus = "failed";
    return createFailureResult(
      envelope,
      status,
      jobError,
      workerId,
      startedAt,
      now().toISOString()
    );
  }
}

async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: CalendarAdapter,
): Promise<CalendarExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "calendar.list_events":
        return await adapter.listEvents(envelope.input as CalendarListEventsInput);
      case "calendar.create_event":
        return await adapter.createEvent(envelope.input as CalendarCreateEventInput);
      case "calendar.update_event":
        return await adapter.updateEvent(envelope.input as CalendarUpdateEventInput);
      case "calendar.find_free":
        return await adapter.findFree(envelope.input as CalendarFindFreeInput);
      case "calendar.brief":
        return await adapter.brief(envelope.input as CalendarBriefInput);
      default:
        throw new CalendarWorkerError(
          "INVALID_INPUT",
          `Unsupported calendar job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof CalendarWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new CalendarWorkerError(
        "INVALID_INPUT",
        `Input validation failed for ${envelope.type}: ${(error as Error).message}`,
        false
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
    metrics: createMetrics(envelope.attempt, workerId, startedAt, finishedAt)
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
    worker_id: workerId
  };
}

function toJobError(error: unknown, jobType: JarvisJobType): JobError {
  if (error instanceof CalendarWorkerError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message || `Unexpected failure while running ${jobType}.`,
      retryable: false
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: `Unexpected failure while running ${jobType}.`,
    retryable: false
  };
}
