import { randomUUID } from "node:crypto";
import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type WorkerCallback
} from "@jarvis/shared";
import {
  type FetchLike,
  type SupervisorCallbackPayload,
  type SupervisorClaimRequest,
  type SupervisorHeartbeatRequest,
  type SupervisorJobClaim,
  type SupervisorRoute,
  type SupervisorRouteHandlerContext,
  type SupervisorRouteHandlers,
  type SupervisorRunOutcome
} from "./types.js";

const SUPERVISED_PREFIXES: SupervisorRoute[] = [
  "device",
  "office",
  "python",
  "browser",
  "system",
  "inference",
  "security",
  "interpreter",
  "voice",
  "agent",
  "calendar",
  "email",
  "web",
  "crm",
  "document"
];

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createError(
  code: string,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): JobError {
  return {
    code,
    message,
    retryable,
    details
  };
}

function createTerminalResult(
  job: JobEnvelope,
  status: JobResult["status"],
  summary: string,
  workerId: string,
  fields: Partial<JobResult> = {},
): JobResult {
  const metrics = {
    ...(fields.metrics ?? {}),
    attempt: job.attempt,
    worker_id: workerId,
    started_at: fields.metrics?.started_at ?? new Date().toISOString(),
    finished_at: fields.metrics?.finished_at ?? new Date().toISOString()
  };

  return {
    contract_version: CONTRACT_VERSION,
    job_id: job.job_id,
    job_type: job.type,
    status,
    summary,
    attempt: job.attempt,
    ...fields,
    metrics
  };
}

function routeJobType(jobType: string): SupervisorRoute {
  const route = jobType.split(".")[0];
  if (SUPERVISED_PREFIXES.includes(route as SupervisorRoute)) {
    return route as SupervisorRoute;
  }
  throw new Error(`Unsupported supervisor route for job type: ${jobType}`);
}

async function readJson<T>(response: Response): Promise<T | null> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Failed to parse JSON from ${response.url ?? "unknown URL"} (status ${response.status}): ${text.slice(0, 200)}`
    );
  }
}

function normalizeClaim(payload: unknown): SupervisorJobClaim | null {
  if (!isRecord(payload)) {
    return null;
  }

  const job = isRecord(payload.job) ? payload.job : null;
  const claim = isRecord(payload.claim) ? payload.claim : null;

  if (
    isRecord(job) &&
    typeof job.job_id === "string" &&
    typeof job.type === "string" &&
    typeof job.session_key === "string"
  ) {
    return {
      claim_id:
        typeof payload.claim_id === "string"
          ? payload.claim_id
          : typeof claim?.claim_id === "string"
            ? claim.claim_id
            : randomUUID(),
      lease_expires_at:
        typeof payload.lease_expires_at === "string"
          ? payload.lease_expires_at
          : typeof claim?.lease_expires_at === "string"
            ? claim.lease_expires_at
            : undefined,
      worker_id:
        typeof payload.worker_id === "string"
          ? payload.worker_id
          : typeof claim?.worker_id === "string"
            ? claim.worker_id
            : undefined,
      run_group:
        typeof payload.run_group === "string"
          ? payload.run_group
          : typeof claim?.run_group === "string"
            ? claim.run_group
            : undefined,
      job: job as JobEnvelope
    };
  }

  if (
    isRecord(claim) &&
    isRecord(claim.job) &&
    typeof claim.job.job_id === "string" &&
    typeof claim.job.type === "string" &&
    typeof claim.job.session_key === "string"
  ) {
    return {
      claim_id: typeof claim.claim_id === "string" ? claim.claim_id : randomUUID(),
      lease_expires_at:
        typeof claim.lease_expires_at === "string"
          ? claim.lease_expires_at
          : undefined,
      worker_id:
        typeof claim.worker_id === "string" ? claim.worker_id : undefined,
      run_group:
        typeof claim.run_group === "string" ? claim.run_group : undefined,
      job: claim.job as JobEnvelope
    };
  }

  return null;
}

export type JarvisSupervisorConfig = {
  jobsBaseUrl: string;
  workerId?: string;
  runGroup?: string;
  fetchImpl?: FetchLike;
  claimPath?: string;
  heartbeatPath?: string;
  callbackPath?: string;
  heartbeatIntervalMs?: number;
  idleDelayMs?: number;
  handlers: SupervisorRouteHandlers;
};

export class JarvisSupervisor {
  readonly jobsBaseUrl: string;
  readonly workerId: string;
  readonly runGroup?: string;
  readonly fetchImpl: FetchLike;
  readonly claimPath: string;
  readonly heartbeatPath: string;
  readonly callbackPath: string;
  readonly heartbeatIntervalMs: number;
  readonly idleDelayMs: number;
  readonly handlers: SupervisorRouteHandlers;

  constructor(config: JarvisSupervisorConfig) {
    this.jobsBaseUrl = normalizeBaseUrl(config.jobsBaseUrl);
    this.workerId = config.workerId ?? `jarvis-supervisor-${randomUUID()}`;
    this.runGroup = config.runGroup;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.claimPath = config.claimPath ?? "/jarvis/jobs/claim";
    this.heartbeatPath = config.heartbeatPath ?? "/jarvis/jobs/heartbeat";
    this.callbackPath = config.callbackPath ?? "/jarvis/jobs/callback";
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 10_000;
    this.idleDelayMs = config.idleDelayMs ?? 2_500;
    this.handlers = config.handlers;
  }

  createClaimRequest(): SupervisorClaimRequest {
    return {
      worker_id: this.workerId,
      routes: [...SUPERVISED_PREFIXES],
      run_group: this.runGroup,
      max_jobs: 1
    };
  }

  async pollOnce(): Promise<SupervisorRunOutcome> {
    const claim = await this.claimNextJob();
    if (!claim) {
      return {
        kind: "idle"
      };
    }
    return this.executeClaim(claim);
  }

  async runUntilStopped(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const outcome = await this.pollOnce();
      if (outcome.kind === "idle") {
        await sleep(this.idleDelayMs);
      }
    }
  }

  async claimNextJob(): Promise<SupervisorJobClaim | null> {
    const response = await this.fetchImpl(
      `${this.jobsBaseUrl}${this.claimPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(this.createClaimRequest())
      },
    );

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Claim request failed with status ${response.status}.`);
    }

    const payload = await readJson<unknown>(response);
    return normalizeClaim(payload);
  }

  async heartbeat(claim: SupervisorJobClaim, status: "running" | "awaiting_approval" = "running", summary?: string): Promise<void> {
    const payload: SupervisorHeartbeatRequest = {
      claim_id: claim.claim_id,
      job_id: claim.job.job_id,
      job_type: claim.job.type,
      attempt: claim.job.attempt,
      worker_id: this.workerId,
      route: routeJobType(claim.job.type),
      status,
      summary
    };

    const response = await this.fetchImpl(
      `${this.jobsBaseUrl}${this.heartbeatPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      },
    );

    if (!response.ok) {
      throw new Error(`Heartbeat request failed with status ${response.status}.`);
    }
  }

  async callback(result: JobResult, claim?: SupervisorJobClaim): Promise<void> {
    const payload: SupervisorCallbackPayload = {
      contract_version: result.contract_version,
      job_id: result.job_id,
      job_type: result.job_type,
      attempt: result.attempt,
      status: result.status,
      summary: result.summary,
      worker_id: this.workerId,
      approval_id: result.approval_id,
      artifacts: result.artifacts,
      structured_output: result.structured_output,
      error: result.error,
      logs: result.logs,
      metrics: result.metrics,
      // claim_id must come from the original claim — never generate a random one,
      // as the server validates it against the active claim to prevent stale callbacks.
      claim_id: claim?.claim_id ?? "unknown",
      route: routeJobType(result.job_type)
    };

    const response = await this.fetchImpl(
      `${this.jobsBaseUrl}${this.callbackPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      },
    );

    if (!response.ok) {
      throw new Error(`Callback request failed with status ${response.status}.`);
    }
  }

  async executeClaim(claim: SupervisorJobClaim): Promise<SupervisorRunOutcome> {
    const route = routeJobType(claim.job.type);
    const handler = this.handlers[route];

    if (!handler) {
      const failed = createTerminalResult(
        claim.job,
        "failed",
        `No handler registered for ${route}.`,
        this.workerId,
        {
          error: createError(
            "HANDLER_NOT_REGISTERED",
            `No handler registered for ${route}.`,
            false,
            { route }
          )
        }
      );
      await this.callback(failed, claim);
      return {
        kind: "failed",
        claim,
        result: failed
      };
    }

    const heartbeatAbort = new AbortController();
    const heartbeatTick = async () => {
      if (!heartbeatAbort.signal.aborted) {
        await this.heartbeat(claim, "running", `Running ${claim.job.type}.`);
      }
    };

    const timer = setInterval(() => {
      heartbeatTick().catch((error) => {
        if (!heartbeatAbort.signal.aborted) {
          console.error(
            `[jarvis-supervisor] heartbeat failed for ${claim.job.job_id}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      });
    }, this.heartbeatIntervalMs);

    const context: SupervisorRouteHandlerContext = {
      supervisor: this,
      job: claim.job,
      claim,
      route,
      workerId: this.workerId,
      signal: heartbeatAbort.signal,
      heartbeat: heartbeatTick
    };

    try {
      await heartbeatTick();
      const handlerResult = await handler(context);
      const result =
        handlerResult.contract_version && handlerResult.job_id
          ? handlerResult
          : createTerminalResult(
              claim.job,
              handlerResult.status ?? "completed",
              handlerResult.summary ?? `Completed ${claim.job.type}.`,
              this.workerId,
              handlerResult
            );

      heartbeatAbort.abort();
      clearInterval(timer);
      await this.callback(result, claim);
      return {
        kind: result.status === "completed" ? "completed" : "failed",
        claim,
        result
      };
    } catch (error) {
      heartbeatAbort.abort();
      clearInterval(timer);
      const message =
        error instanceof Error ? error.message : `Handler failed for ${claim.job.type}.`;
      const failed = createTerminalResult(
        claim.job,
        "failed",
        message,
        this.workerId,
        {
          error: createError(
            "HANDLER_FAILED",
            message,
            true,
            { route, worker_id: this.workerId }
          )
        }
      );

      await this.callback(failed, claim);
      return {
        kind: "failed",
        claim,
        result: failed
      };
    }
  }
}

export function createJarvisSupervisor(config: JarvisSupervisorConfig): JarvisSupervisor {
  return new JarvisSupervisor(config);
}

export function createDefaultCompletedResult(
  job: JobEnvelope,
  workerId: string,
  summary?: string,
  structured_output?: Record<string, unknown>,
): JobResult {
  return createTerminalResult(job, "completed", summary ?? `Completed ${job.type}.`, workerId, {
    structured_output
  });
}

export function createDefaultFailedResult(
  job: JobEnvelope,
  workerId: string,
  message: string,
  retryable = true,
): JobResult {
  return createTerminalResult(job, "failed", message, workerId, {
    error: createError("HANDLER_FAILED", message, retryable)
  });
}

export function getSupervisorRoutes(): SupervisorRoute[] {
  return [...SUPERVISED_PREFIXES];
}

export function isSupervisorRoute(jobType: string): jobType is `${SupervisorRoute}.${string}` {
  const prefix = jobType.split(".")[0];
  return SUPERVISED_PREFIXES.includes(prefix as SupervisorRoute);
}

export function createCallbackPayload(
  result: JobResult,
  workerId: string,
  claimId?: string,
): WorkerCallback {
  return {
    contract_version: result.contract_version,
    job_id: result.job_id,
    job_type: result.job_type,
    attempt: result.attempt,
    status: result.status,
    summary: result.summary,
    worker_id: workerId,
    approval_id: result.approval_id,
    artifacts: result.artifacts,
    structured_output: result.structured_output,
    error: result.error,
    logs: result.logs,
    metrics: result.metrics,
    ...(claimId ? { claim_id: claimId } : {})
  } as WorkerCallback;
}
