import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobType,
  type Metrics
} from "@jarvis/shared";
import { InferenceWorkerError, type InferenceAdapter } from "./adapter.js";
import type {
  InferenceBatchStatusInput,
  InferenceBatchSubmitInput,
  InferenceChatInput,
  InferenceEmbedInput,
  InferenceListModelsInput,
  InferenceRagIndexInput,
  InferenceRagQueryInput,
  InferenceVisionChatInput
} from "./types.js";

export const INFERENCE_WORKER_ID = "inference-worker";

export const INFERENCE_JOB_TYPES = [
  "inference.chat",
  "inference.vision_chat",
  "inference.embed",
  "inference.list_models",
  "inference.rag_index",
  "inference.rag_query",
  "inference.batch_submit",
  "inference.batch_status"
] as const;

export type InferenceJobType = (typeof INFERENCE_JOB_TYPES)[number];

export type InferenceWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type InferenceWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isInferenceJobType(jobType: string): jobType is InferenceJobType {
  return (INFERENCE_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createInferenceWorker(config: {
  adapter: InferenceAdapter;
  workerId?: string;
  now?: () => Date;
}): InferenceWorker {
  const workerId = config.workerId ?? INFERENCE_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeInferenceJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeInferenceJob(
  envelope: JobEnvelope,
  adapter: InferenceAdapter,
  options: InferenceWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? INFERENCE_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isInferenceJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      {
        code: "INVALID_INPUT",
        message: `Inference worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: { supported_job_types: [...INFERENCE_JOB_TYPES] }
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
  adapter: InferenceAdapter,
) {
  try {
    switch (envelope.type) {
      case "inference.chat":
        return await adapter.chat(envelope.input as InferenceChatInput);
      case "inference.vision_chat":
        return await adapter.visionChat(envelope.input as InferenceVisionChatInput);
      case "inference.embed":
        return await adapter.embed(envelope.input as InferenceEmbedInput);
      case "inference.list_models":
        return await adapter.listModels(envelope.input as InferenceListModelsInput);
      case "inference.rag_index":
        return await adapter.ragIndex(envelope.input as InferenceRagIndexInput);
      case "inference.rag_query":
        return await adapter.ragQuery(envelope.input as InferenceRagQueryInput);
      case "inference.batch_submit":
        return await adapter.batchSubmit(envelope.input as InferenceBatchSubmitInput);
      case "inference.batch_status":
        return await adapter.batchStatus(envelope.input as InferenceBatchStatusInput);
      default:
        throw new InferenceWorkerError(
          "INVALID_INPUT",
          `Unsupported inference job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof InferenceWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new InferenceWorkerError(
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
  if (error instanceof InferenceWorkerError) {
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
