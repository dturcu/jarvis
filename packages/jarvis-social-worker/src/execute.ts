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
  SocialWorkerError,
  type ExecutionOutcome,
  type SocialAdapter,
} from "./adapter.js";
import type {
  SocialLikeInput,
  SocialCommentInput,
  SocialRepostInput,
  SocialPostInput,
  SocialFollowInput,
  SocialScanFeedInput,
  SocialDigestInput,
} from "./types.js";

export const SOCIAL_WORKER_ID = "social-worker";

export const SOCIAL_JOB_TYPES = [
  "social.like",
  "social.comment",
  "social.repost",
  "social.post",
  "social.follow",
  "social.scan_feed",
  "social.digest",
] as const;

export type SocialJobType = (typeof SOCIAL_JOB_TYPES)[number];

export type SocialWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type SocialWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isSocialJobType(jobType: string): jobType is SocialJobType {
  return (SOCIAL_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createSocialWorker(config: {
  adapter: SocialAdapter;
  workerId?: string;
  now?: () => Date;
}): SocialWorker {
  const workerId = config.workerId ?? SOCIAL_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeSocialJob(envelope, config.adapter, {
        workerId,
        now: config.now,
      }),
  };
}

export async function executeSocialJob(
  envelope: JobEnvelope,
  adapter: SocialAdapter,
  options: SocialWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? SOCIAL_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isSocialJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Social worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...SOCIAL_JOB_TYPES],
        },
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
      metrics: createMetrics(
        envelope.attempt,
        workerId,
        startedAt,
        now().toISOString(),
      ),
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
      now().toISOString(),
    );
  }
}

async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: SocialAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "social.like":
        return await adapter.like(envelope.input as SocialLikeInput);
      case "social.comment":
        return await adapter.comment(envelope.input as SocialCommentInput);
      case "social.repost":
        return await adapter.repost(envelope.input as SocialRepostInput);
      case "social.post":
        return await adapter.post(envelope.input as SocialPostInput);
      case "social.follow":
        return await adapter.follow(envelope.input as SocialFollowInput);
      case "social.scan_feed":
        return await adapter.scanFeed(envelope.input as SocialScanFeedInput);
      case "social.digest":
        return await adapter.digest(envelope.input as SocialDigestInput);
      default:
        throw new SocialWorkerError(
          "INVALID_INPUT",
          `Unsupported social job type: ${String(envelope.type)}.`,
        );
    }
  } catch (error) {
    if (error instanceof SocialWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new SocialWorkerError(
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
  if (error instanceof SocialWorkerError) {
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
      message:
        error.message || `Unexpected failure while running ${jobType}.`,
      retryable: false,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: `Unexpected failure while running ${jobType}.`,
    retryable: false,
  };
}
