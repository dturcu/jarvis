import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobStatus,
  type Metrics
} from "@jarvis/shared";
import {
  CrmWorkerError,
  type CrmAdapter,
  type ExecutionOutcome
} from "./adapter.js";
import type {
  CrmAddContactInput,
  CrmUpdateContactInput,
  CrmListPipelineInput,
  CrmMoveStageInput,
  CrmAddNoteInput,
  CrmSearchInput,
  CrmDigestInput
} from "./types.js";

export const CRM_WORKER_ID = "crm-worker";

export const CRM_JOB_TYPES = [
  "crm.add_contact",
  "crm.update_contact",
  "crm.list_pipeline",
  "crm.move_stage",
  "crm.add_note",
  "crm.search",
  "crm.digest"
] as const;

export type CrmJobType = (typeof CRM_JOB_TYPES)[number];

export type CrmWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type CrmWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isCrmJobType(jobType: string): jobType is CrmJobType {
  return (CRM_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createCrmWorker(
  config: {
    adapter: CrmAdapter;
    workerId?: string;
    now?: () => Date;
  },
): CrmWorker {
  const workerId = config.workerId ?? CRM_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeCrmJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeCrmJob(
  envelope: JobEnvelope,
  adapter: CrmAdapter,
  options: CrmWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? CRM_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isCrmJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `CRM worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...CRM_JOB_TYPES]
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
    const jobError = toJobError(error);
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
  adapter: CrmAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "crm.add_contact":
        return await adapter.addContact(envelope.input as CrmAddContactInput);
      case "crm.update_contact":
        return await adapter.updateContact(envelope.input as CrmUpdateContactInput);
      case "crm.list_pipeline":
        return await adapter.listPipeline(envelope.input as CrmListPipelineInput);
      case "crm.move_stage":
        return await adapter.moveStage(envelope.input as CrmMoveStageInput);
      case "crm.add_note":
        return await adapter.addNote(envelope.input as CrmAddNoteInput);
      case "crm.search":
        return await adapter.search(envelope.input as CrmSearchInput);
      case "crm.digest":
        return await adapter.digest(envelope.input as CrmDigestInput);
      default:
        throw new CrmWorkerError(
          "INVALID_INPUT",
          `Unsupported CRM job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof CrmWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new CrmWorkerError(
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

function toJobError(error: unknown): JobError {
  if (error instanceof CrmWorkerError) {
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
      message: error.message || "Unexpected CRM worker failure.",
      retryable: false
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Unexpected CRM worker failure.",
    retryable: false
  };
}
