import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobType,
  type Metrics
} from "@jarvis/shared";
import { InterpreterWorkerError, type InterpreterAdapter } from "./adapter.js";
import type {
  InterpreterRunCodeInput,
  InterpreterRunTaskInput,
  InterpreterStatusInput
} from "./types.js";

export const INTERPRETER_WORKER_ID = "interpreter-worker";

export const INTERPRETER_JOB_TYPES = [
  "interpreter.run_task",
  "interpreter.run_code",
  "interpreter.status"
] as const;

export type InterpreterJobType = (typeof INTERPRETER_JOB_TYPES)[number];

export type InterpreterWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type InterpreterWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isInterpreterJobType(jobType: string): jobType is InterpreterJobType {
  return (INTERPRETER_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createInterpreterWorker(config: {
  adapter: InterpreterAdapter;
  workerId?: string;
  now?: () => Date;
}): InterpreterWorker {
  const workerId = config.workerId ?? INTERPRETER_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeInterpreterJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeInterpreterJob(
  envelope: JobEnvelope,
  adapter: InterpreterAdapter,
  options: InterpreterWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? INTERPRETER_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isInterpreterJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      {
        code: "INVALID_INPUT",
        message: `Interpreter worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: { supported_job_types: [...INTERPRETER_JOB_TYPES] }
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
    return createFailureResult(
      envelope,
      jobError,
      workerId,
      startedAt,
      now().toISOString()
    );
  }
}

async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: InterpreterAdapter,
) {
  try {
    switch (envelope.type) {
      case "interpreter.run_task":
        return await adapter.runTask(envelope.input as InterpreterRunTaskInput);
      case "interpreter.run_code":
        return await adapter.runCode(envelope.input as InterpreterRunCodeInput);
      case "interpreter.status":
        return await adapter.status(envelope.input as InterpreterStatusInput);
      default:
        throw new InterpreterWorkerError(
          "INVALID_INPUT",
          `Unsupported interpreter job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof InterpreterWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new InterpreterWorkerError(
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
  error: JobError,
  workerId: string,
  startedAt: string,
  finishedAt: string,
): JobResult {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: envelope.job_id,
    job_type: envelope.type,
    status: "failed",
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
  if (error instanceof InterpreterWorkerError) {
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
