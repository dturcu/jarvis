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

/**
 * Minimal bridge surface consumed by the browser worker.
 *
 * This mirrors the `BrowserBridge` interface from `@jarvis/browser/bridge`
 * without introducing a compile-time dependency on that package.  The
 * runtime wires the concrete bridge at startup; the worker only cares
 * about the method signatures.
 */
export interface BrowserBridgeCompat {
  navigate(url: string, options?: { waitForSelector?: string; timeoutMs?: number }): Promise<{ url: string; title: string; status: number }>;
  extract(selector?: string, options?: { format?: "text" | "html" | "markdown"; selector?: string }): Promise<{ content: string; format: string; url: string }>;
  capture(options?: { fullPage?: boolean; selector?: string; format?: "png" | "jpeg" }): Promise<{ artifact_id: string; path: string; path_context: string }>;
  download(url: string, options?: { targetDir?: string; timeoutMs?: number }): Promise<{ artifact_id: string; path: string; path_context: string }>;
  runTask(steps: Array<{ action: string; params: Record<string, unknown> }>, options?: { url?: string; task?: string; timeoutMs?: number }): Promise<{ steps_completed: number; artifacts: unknown[]; evidence: Record<string, unknown> }>;
  close(): Promise<void>;
}

export function isBrowserJobType(jobType: string): jobType is BrowserJobType {
  return (BROWSER_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createBrowserWorker(
  config: {
    adapter: BrowserAdapter;
    bridge?: BrowserBridgeCompat;
    workerId?: string;
    now?: () => Date;
  },
): BrowserWorker {
  const workerId = config.workerId ?? BROWSER_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeBrowserJob(envelope, config.adapter, {
        workerId,
        now: config.now,
        bridge: config.bridge,
      })
  };
}

export type BrowserWorkerOptionsInternal = BrowserWorkerOptions & {
  bridge?: BrowserBridgeCompat;
};

export async function executeBrowserJob(
  envelope: JobEnvelope,
  adapter: BrowserAdapter,
  options: BrowserWorkerOptionsInternal = {},
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
    const outcome = options.bridge
      ? await routeEnvelopeViaBridge(envelope, options.bridge)
      : await routeEnvelope(envelope, adapter);
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

// ── Bridge-based routing ─────────────────────────────────────────────────────
//
// Job types that the BrowserBridge supports are dispatched through it.
// Low-level adapter-only types (click, type, evaluate, wait_for) are NOT
// exposed by the bridge and will throw -- callers should only provide a
// bridge when they also accept that low-level jobs fall back to the adapter.

const BRIDGE_SUPPORTED_TYPES = new Set<string>([
  "browser.navigate",
  "browser.extract",
  "browser.capture",
  "browser.download",
  "browser.run_task",
]);

async function routeEnvelopeViaBridge(
  envelope: JobEnvelope,
  bridge: BrowserBridgeCompat,
): Promise<ExecutionOutcome<unknown>> {
  if (!BRIDGE_SUPPORTED_TYPES.has(envelope.type)) {
    throw new BrowserWorkerError(
      "INVALID_INPUT",
      `Bridge does not support ${envelope.type}; use the adapter path instead.`,
      false,
    );
  }

  try {
    switch (envelope.type) {
      case "browser.navigate": {
        const input = envelope.input as BrowserNavigateInput;
        const page = await bridge.navigate(input.url);
        return {
          summary: `Navigated to ${page.url} ("${page.title}").`,
          structured_output: page,
        };
      }
      case "browser.extract": {
        const input = envelope.input as BrowserExtractInput;
        const result = await bridge.extract(input.selector, {
          format: input.format as "text" | "html" | "markdown" | undefined,
        });
        return {
          summary: `Extracted ${result.format} content from ${result.url}.`,
          structured_output: result,
        };
      }
      case "browser.capture": {
        const input = envelope.input as BrowserScreenshotInput;
        const artifact = await bridge.capture({
          fullPage: input.full_page,
          selector: input.selector,
          format: (input as Record<string, unknown>).format as "png" | "jpeg" | undefined,
        });
        return {
          summary: `Captured screenshot -> ${artifact.path}.`,
          structured_output: artifact,
        };
      }
      case "browser.download": {
        const input = envelope.input as BrowserDownloadInput;
        const artifact = await bridge.download(input.url, {
          targetDir: input.dest_path,
          timeoutMs: input.timeout_ms,
        });
        return {
          summary: `Downloaded ${input.url} -> ${artifact.path}.`,
          structured_output: artifact,
        };
      }
      case "browser.run_task": {
        const input = envelope.input as BrowserRunTaskInput;
        const steps = (input.steps ?? []).map((s) => ({
          action: s.action,
          params: {
            selector: s.selector,
            value: s.value,
            url: s.url,
            script: s.script,
          } as Record<string, unknown>,
        }));
        const result = await bridge.runTask(steps, {
          url: input.url,
          task: input.task,
          timeoutMs: input.timeout_ms,
        });
        return {
          summary: `Completed ${result.steps_completed} step(s).`,
          structured_output: result,
        };
      }
      default:
        throw new BrowserWorkerError(
          "INVALID_INPUT",
          `Unsupported bridge job type: ${String(envelope.type)}.`,
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
