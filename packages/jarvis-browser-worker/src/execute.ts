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
  BrowserWorkerError,
  type ExecutionOutcome,
  type BrowserAdapter
} from "./adapter.js";
import type {
  BrowserNavigateInput,
  BrowserClickInput,
  BrowserTypeInput,
  BrowserEvaluateInput,
  BrowserWaitForInput,
  BrowserScreenshotInput,
  BrowserExtractInput,
  BrowserRunTaskInput,
  BrowserDownloadInput
} from "./types.js";

export const BROWSER_WORKER_ID = "browser-worker";

export const BROWSER_JOB_TYPES = [
  "browser.navigate",
  "browser.click",
  "browser.type",
  "browser.evaluate",
  "browser.wait_for",
  "browser.run_task",
  "browser.extract",
  "browser.capture",
  "browser.download"
] as const;

export type BrowserJobType = (typeof BROWSER_JOB_TYPES)[number];

export type BrowserWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type BrowserWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isBrowserJobType(jobType: string): jobType is BrowserJobType {
  return (BROWSER_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createBrowserWorker(
  config: {
    adapter: BrowserAdapter;
    workerId?: string;
    now?: () => Date;
  },
): BrowserWorker {
  const workerId = config.workerId ?? BROWSER_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeBrowserJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeBrowserJob(
  envelope: JobEnvelope,
  adapter: BrowserAdapter,
  options: BrowserWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? BROWSER_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isBrowserJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Browser worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...BROWSER_JOB_TYPES]
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
  adapter: BrowserAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "browser.navigate":
        return await adapter.navigate(envelope.input as BrowserNavigateInput);
      case "browser.click":
        return await adapter.click(envelope.input as BrowserClickInput);
      case "browser.type":
        return await adapter.type(envelope.input as BrowserTypeInput);
      case "browser.evaluate":
        return await adapter.evaluate(envelope.input as BrowserEvaluateInput);
      case "browser.wait_for":
        return await adapter.waitFor(envelope.input as BrowserWaitForInput);
      case "browser.run_task":
        return await adapter.runTask(envelope.input as BrowserRunTaskInput);
      case "browser.extract":
        return await adapter.extract(envelope.input as BrowserExtractInput);
      case "browser.capture":
        return await adapter.screenshot(envelope.input as BrowserScreenshotInput);
      case "browser.download":
        return await adapter.download(envelope.input as BrowserDownloadInput);
      default:
        throw new BrowserWorkerError(
          "INVALID_INPUT",
          `Unsupported browser job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof BrowserWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new BrowserWorkerError(
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
  if (error instanceof BrowserWorkerError) {
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
