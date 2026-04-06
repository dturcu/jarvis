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
  EmailWorkerError,
  type ExecutionOutcome,
  type EmailAdapter
} from "./adapter.js";
import type {
  EmailDraftInput,
  EmailLabelInput,
  EmailListThreadsInput,
  EmailReadInput,
  EmailSearchInput,
  EmailSendInput
} from "./types.js";

export const EMAIL_WORKER_ID = "email-worker";

export const EMAIL_JOB_TYPES = [
  "email.search",
  "email.read",
  "email.draft",
  "email.send",
  "email.label",
  "email.list_threads"
] as const;

export type EmailJobType = (typeof EMAIL_JOB_TYPES)[number];

export type EmailWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type EmailWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isEmailJobType(jobType: string): jobType is EmailJobType {
  return (EMAIL_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createEmailWorker(
  config: {
    adapter: EmailAdapter;
    workerId?: string;
    now?: () => Date;
  },
): EmailWorker {
  const workerId = config.workerId ?? EMAIL_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeEmailJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeEmailJob(
  envelope: JobEnvelope,
  adapter: EmailAdapter,
  options: EmailWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? EMAIL_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isEmailJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Email worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...EMAIL_JOB_TYPES]
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
  adapter: EmailAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "email.search":
        return await adapter.search(envelope.input as EmailSearchInput);
      case "email.read":
        return await adapter.read(envelope.input as EmailReadInput);
      case "email.draft":
        return await adapter.draft(envelope.input as EmailDraftInput);
      case "email.send":
        return await adapter.send(envelope.input as EmailSendInput);
      case "email.label":
        return await adapter.label(envelope.input as EmailLabelInput);
      case "email.list_threads":
        return await adapter.listThreads(envelope.input as EmailListThreadsInput);
      default:
        throw new EmailWorkerError(
          "INVALID_INPUT",
          `Unsupported email job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof EmailWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new EmailWorkerError(
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
  if (error instanceof EmailWorkerError) {
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
