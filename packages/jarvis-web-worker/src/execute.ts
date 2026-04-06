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
  WebWorkerError,
  type ExecutionOutcome,
  type WebAdapter
} from "./adapter.js";
import type {
  WebCompetitiveIntelInput,
  WebEnrichContactInput,
  WebMonitorPageInput,
  WebScrapeProfileInput,
  WebSearchNewsInput,
  WebTrackJobsInput
} from "./types.js";

export const WEB_WORKER_ID = "web-worker";

export const WEB_JOB_TYPES = [
  "web.search_news",
  "web.scrape_profile",
  "web.monitor_page",
  "web.enrich_contact",
  "web.track_jobs",
  "web.competitive_intel"
] as const;

export type WebJobType = (typeof WEB_JOB_TYPES)[number];

export type WebWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type WebWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isWebJobType(jobType: string): jobType is WebJobType {
  return (WEB_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createWebWorker(
  config: {
    adapter: WebAdapter;
    workerId?: string;
    now?: () => Date;
  },
): WebWorker {
  const workerId = config.workerId ?? WEB_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeWebJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeWebJob(
  envelope: JobEnvelope,
  adapter: WebAdapter,
  options: WebWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? WEB_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isWebJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Web worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...WEB_JOB_TYPES]
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
  adapter: WebAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "web.search_news":
        return await adapter.searchNews(envelope.input as WebSearchNewsInput);
      case "web.scrape_profile":
        return await adapter.scrapeProfile(envelope.input as WebScrapeProfileInput);
      case "web.monitor_page":
        return await adapter.monitorPage(envelope.input as WebMonitorPageInput);
      case "web.enrich_contact":
        return await adapter.enrichContact(envelope.input as WebEnrichContactInput);
      case "web.track_jobs":
        return await adapter.trackJobs(envelope.input as WebTrackJobsInput);
      case "web.competitive_intel":
        return await adapter.competitiveIntel(envelope.input as WebCompetitiveIntelInput);
      default:
        throw new WebWorkerError(
          "INVALID_INPUT",
          `Unsupported web job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof WebWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new WebWorkerError(
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
  if (error instanceof WebWorkerError) {
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
