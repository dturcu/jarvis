import type { IncomingMessage, ServerResponse } from "node:http";
import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawConfig,
  type OpenClawPluginServiceContext,
  type OpenClawPluginToolContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  CONTRACT_VERSION,
  JOBS_TOOL_NAMES,
  JOB_TYPE_NAMES,
  createToolResponse,
  getJarvisState,
  safeJsonParse,
  sendSessionMessage,
  toToolResult,
  type ArtifactRef,
  type JarvisJobType,
  type WorkerCallback
} from "@jarvis/shared";

let gatewayConfig: OpenClawConfig | undefined;
let requeueTimer: ReturnType<typeof setInterval> | null = null;

const JOB_TYPE_LITERALS = JOB_TYPE_NAMES.map((jobType) =>
  Type.Literal(jobType),
) as [ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]];

const PRIORITY_LITERALS = [
  Type.Literal("low"),
  Type.Literal("normal"),
  Type.Literal("high"),
  Type.Literal("urgent")
] as const;

const ARTIFACT_REF_SCHEMA = Type.Object({
  artifact_id: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  path_context: Type.Optional(Type.String()),
  path_style: Type.Optional(Type.String()),
  checksum_sha256: Type.Optional(Type.String()),
  size_bytes: Type.Optional(Type.Number())
});

export const jarvisJobsServiceId = "jarvis-jobs-state";
export const jarvisJobsToolNames = [...JOBS_TOOL_NAMES];

type ClaimJobRequest = {
  worker_id: string;
  worker_type?: string;
  run_group?: string;
  lease_seconds?: number;
  max_jobs?: number;
  requested_at?: string;
  metadata?: Record<string, unknown>;
};

type ClaimJobResult = {
  claimed?: boolean;
  job_id?: string;
  claim_id?: string;
  status?: string;
  summary?: string;
  lease_expires_at?: string;
  attempt?: number;
  job_type?: JarvisJobType;
  job?: Record<string, unknown>;
  structured_output?: Record<string, unknown>;
  artifacts?: ArtifactRef[];
  metrics?: Record<string, unknown>;
};

type HeartbeatJobRequest = {
  worker_id: string;
  job_id: string;
  claim_id: string;
  status?: string;
  summary?: string;
  heartbeat_at?: string;
  lease_seconds?: number;
  metadata?: Record<string, unknown>;
};

type HeartbeatJobResult = {
  acknowledged?: boolean;
  job_id?: string;
  claim_id?: string;
  status?: string;
  summary?: string;
  lease_expires_at?: string;
  attempt?: number;
  job_type?: JarvisJobType;
  structured_output?: Record<string, unknown>;
  artifacts?: ArtifactRef[];
  metrics?: Record<string, unknown>;
};

type JarvisJobsControlState = ReturnType<typeof getJarvisState> & {
  requeueExpiredJobs?: () => unknown;
  claimJob?: (request: ClaimJobRequest) => ClaimJobResult | null | undefined;
  heartbeatJob?: (request: HeartbeatJobRequest) => HeartbeatJobResult | null | undefined;
};

function createJobSubmitTool(ctx: OpenClawPluginToolContext): AnyAgentTool {
  return {
    name: "job_submit",
    label: "Jarvis Job Submit",
    description: "Submit a Jarvis worker job into the shared broker.",
    parameters: Type.Object({
      type: Type.Union(JOB_TYPE_LITERALS),
      input: Type.Record(Type.String(), Type.Unknown()),
      artifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      artifactsIn: Type.Optional(Type.Array(ARTIFACT_REF_SCHEMA)),
      priority: Type.Optional(Type.Union([...PRIORITY_LITERALS])),
      approvalId: Type.Optional(Type.String({ minLength: 1 })),
      requestedCommand: Type.Optional(Type.String()),
      capabilityRoute: Type.Optional(Type.String())
    }),
    execute: async (_toolCallId, params) => {
      const artifactsIn: ArtifactRef[] = [
        ...(params.artifactsIn ?? []),
        ...(params.artifactIds ?? []).map((artifactId: string) => ({
          artifact_id: artifactId
        }))
      ];

      return toToolResult(
        getJarvisState().submitJob({
          ctx,
          type: params.type as JarvisJobType,
          input: params.input,
          artifactsIn,
          priority: params.priority,
          approvalId: params.approvalId,
          requestedCommand: params.requestedCommand,
          capabilityRoute: params.capabilityRoute
        }),
      );
    }
  };
}

function createJobStatusTool(): AnyAgentTool {
  return {
    name: "job_status",
    label: "Jarvis Job Status",
    description: "Fetch the current state for a queued or completed job.",
    parameters: Type.Object({
      jobId: Type.String({ format: "uuid" })
    }),
    execute: async (_toolCallId, params) =>
      toToolResult(getJarvisState().getJob(params.jobId))
  };
}

function createJobCancelTool(): AnyAgentTool {
  return {
    name: "job_cancel",
    label: "Jarvis Job Cancel",
    description: "Cancel a job that is still in flight.",
    parameters: Type.Object({
      jobId: Type.String({ format: "uuid" }),
      reason: Type.Optional(Type.String())
    }),
    execute: async (_toolCallId, params) =>
      toToolResult(getJarvisState().cancelJob(params.jobId, params.reason))
  };
}

function createJobArtifactsTool(): AnyAgentTool {
  return {
    name: "job_artifacts",
    label: "Jarvis Job Artifacts",
    description: "List artifacts for a specific job or all tracked jobs.",
    parameters: Type.Object({
      jobId: Type.Optional(Type.String({ format: "uuid" }))
    }),
    execute: async (_toolCallId, params) =>
      toToolResult(getJarvisState().listArtifacts(params.jobId))
  };
}

function createJobRetryTool(): AnyAgentTool {
  return {
    name: "job_retry",
    label: "Jarvis Job Retry",
    description: "Retry a completed, failed, or cancelled job.",
    parameters: Type.Object({
      jobId: Type.String({ format: "uuid" }),
      approvalId: Type.Optional(Type.String({ minLength: 1 }))
    }),
    execute: async (_toolCallId, params) =>
      toToolResult(getJarvisState().retryJob(params.jobId, params.approvalId))
  };
}

export function createJobsTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createJobSubmitTool(ctx),
    createJobStatusTool(),
    createJobCancelTool(),
    createJobArtifactsTool(),
    createJobRetryTool()
  ];
}

function getControlState(): JarvisJobsControlState {
  return getJarvisState() as unknown as JarvisJobsControlState;
}

function isClaimJobRequest(value: Record<string, unknown>): value is ClaimJobRequest {
  return typeof value.worker_id === "string" && value.worker_id.trim().length > 0;
}

function isHeartbeatJobRequest(
  value: Record<string, unknown>,
): value is HeartbeatJobRequest {
  return (
    typeof value.worker_id === "string" &&
    value.worker_id.trim().length > 0 &&
    typeof value.job_id === "string" &&
    value.job_id.trim().length > 0 &&
    typeof value.claim_id === "string" &&
    value.claim_id.trim().length > 0
  );
}

export function createJobsStateService() {
  return {
    id: jarvisJobsServiceId,
    start: async (ctx: OpenClawPluginServiceContext) => {
      const stats = getJarvisState().getStats();
      ctx.logger.info(
        `Jarvis jobs state ready: ${stats.jobs} jobs, ${stats.approvals} approvals, ${stats.dispatches} dispatches`,
      );
      requeueTimer = setInterval(() => {
        const requeued = getJarvisState().requeueExpiredJobs();
        if (requeued > 0) {
          ctx.logger.info(`Jarvis jobs re-queued ${requeued} expired job lease(s).`);
        }
      }, 15000);
    },
    stop: async (ctx: OpenClawPluginServiceContext) => {
      if (requeueTimer) {
        clearInterval(requeueTimer);
        requeueTimer = null;
      }
      ctx.logger.info("Jarvis jobs state stopped");
    }
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkerCallback(value: Record<string, unknown>): value is WorkerCallback {
  return (
    value.contract_version === CONTRACT_VERSION &&
    typeof value.job_id === "string" &&
    JOB_TYPE_NAMES.includes(value.job_type as JarvisJobType) &&
    typeof value.attempt === "number" &&
    typeof value.status === "string" &&
    typeof value.summary === "string" &&
    typeof value.worker_id === "string"
  );
}

async function readRequestBody(
  req: IncomingMessage,
  maxBytes = 1_048_576,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): boolean {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
  return true;
}

function buildNoWorkResponse() {
  return {
    ok: true,
    claimed: false,
    status: "no_work",
    summary: "No queued jobs are available."
  };
}

function normalizeClaimResult(result: ClaimJobResult) {
  if (result.claimed === false || result.job_id == null) {
    return buildNoWorkResponse();
  }

  return {
    ok: true,
    claimed: true,
    status: result.status ?? "claimed",
    summary: result.summary ?? "Claimed queued job.",
    job_id: result.job_id,
    claim_id: result.claim_id,
    lease_expires_at: result.lease_expires_at,
    attempt: result.attempt,
    job_type: result.job_type,
    job: result.job,
    structured_output: result.structured_output,
    artifacts: result.artifacts,
    metrics: result.metrics
  };
}

function normalizeHeartbeatResult(result: HeartbeatJobResult) {
  return {
    ok: true,
    acknowledged: result.acknowledged !== false,
    status: result.status ?? "running",
    summary: result.summary ?? "Heartbeat accepted.",
    job_id: result.job_id,
    claim_id: result.claim_id,
    lease_expires_at: result.lease_expires_at,
    attempt: result.attempt,
    job_type: result.job_type,
    structured_output: result.structured_output,
    artifacts: result.artifacts,
    metrics: result.metrics
  };
}

function extractDispatchId(details: Record<string, unknown> | undefined): string | undefined {
  const candidate =
    details &&
    typeof details === "object" &&
    "dispatch" in details &&
    typeof details.dispatch === "object" &&
    details.dispatch !== null
      ? (details.dispatch as { dispatch_id?: string })
      : undefined;

  return candidate?.dispatch_id;
}

async function maybeNotifyCompletion(result: WorkerCallback): Promise<void> {
  if (!gatewayConfig || result.status !== "completed") {
    return;
  }

  const state = getJarvisState();
  const record = state.getJobRecord(result.job_id);
  if (!record?.envelope.metadata.notify_on_completion) {
    return;
  }

  const accepted = state.createDispatch({
    kind: "dispatch_notify_completion",
    jobId: result.job_id,
    sessionKey: record.envelope.session_key,
    text: `${result.summary}`,
    requireApproval: false
  });

  if (accepted.status !== "accepted") {
    console.warn(
      `[jarvis-jobs] Completion notification dispatch was not accepted for job ${result.job_id}: status=${accepted.status}`
    );
    return;
  }

  const dispatchId = extractDispatchId(accepted.structured_output);

  try {
    const receipt = await sendSessionMessage(
      {
        sessionKey: record.envelope.session_key,
        message: result.summary
      },
      gatewayConfig,
    );
    if (dispatchId) {
      state.markDispatchDelivered(dispatchId, receipt);
    }
  } catch (error) {
    if (dispatchId) {
      state.markDispatchFailed(
        dispatchId,
        "DISPATCH_FAILED",
        error instanceof Error ? error.message : "Completion dispatch failed.",
        true,
      );
    }
  }
}

export async function handleJobsClaim(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  try {
    const rawBody = await readRequestBody(req);
    const parsed = safeJsonParse<unknown>(rawBody);

    if (!isJsonObject(parsed) || !isClaimJobRequest(parsed)) {
      return sendJson(res, 400, {
        ok: false,
        error: "Invalid job claim payload."
      });
    }

    const state = getControlState();
    if (typeof state.claimJob !== "function") {
      return sendJson(res, 501, {
        ok: false,
        error: "Job claim routing is not available yet."
      });
    }

    await Promise.resolve(state.requeueExpiredJobs?.());
    const result = await Promise.resolve(
      state.claimJob({
      ...parsed,
      requested_at: new Date().toISOString()
      }),
    );

    return sendJson(res, 200, result ? normalizeClaimResult(result) : buildNoWorkResponse());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected claim failure.";

    if (message === "Request body too large.") {
      return sendJson(res, 413, {
        ok: false,
        error: message
      });
    }

    return sendJson(res, 500, {
      ok: false,
      error: message
    });
  }
}

export async function handleJobsHeartbeat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  try {
    const rawBody = await readRequestBody(req);
    const parsed = safeJsonParse<unknown>(rawBody);

    if (!isJsonObject(parsed) || !isHeartbeatJobRequest(parsed)) {
      return sendJson(res, 400, {
        ok: false,
        error: "Invalid job heartbeat payload."
      });
    }

    const state = getControlState();
    if (typeof state.heartbeatJob !== "function") {
      return sendJson(res, 501, {
        ok: false,
        error: "Job heartbeat routing is not available yet."
      });
    }

    const result = await Promise.resolve(
      state.heartbeatJob({
      ...parsed,
      heartbeat_at: new Date().toISOString()
      }),
    );

    if (!result) {
      return sendJson(res, 404, {
        ok: false,
        error: `Unknown heartbeat claim for job ${parsed.job_id}.`
      });
    }

    return sendJson(res, 200, normalizeHeartbeatResult(result));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected heartbeat failure.";

    if (message === "Request body too large.") {
      return sendJson(res, 413, {
        ok: false,
        error: message
      });
    }

    return sendJson(res, 500, {
      ok: false,
      error: message
    });
  }
}

export async function handleJobsCallback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  try {
    const rawBody = await readRequestBody(req);
    const parsed = safeJsonParse<unknown>(rawBody);

    if (!isJsonObject(parsed) || !isWorkerCallback(parsed)) {
      return sendJson(res, 400, {
        ok: false,
        error: "Invalid worker callback payload."
      });
    }

    const nextResult = getJarvisState().handleWorkerCallback(parsed);
    await maybeNotifyCompletion(parsed);
    return sendJson(res, 200, {
      ok: true,
      contract_version: nextResult.contract_version,
      job_id: nextResult.job_id,
      status: nextResult.status,
      summary: nextResult.summary
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected callback failure.";

    if (message.startsWith("Unknown job ")) {
      return sendJson(res, 404, {
        ok: false,
        error: message
      });
    }

    if (message === "Request body too large.") {
      return sendJson(res, 413, {
        ok: false,
        error: message
      });
    }

    return sendJson(res, 500, {
      ok: false,
      error: message
    });
  }
}

export default definePluginEntry({
  id: "jarvis-jobs",
  name: "Jarvis Jobs",
  description: "Jarvis job broker, retry, and callback plugin",
  register(api) {
    gatewayConfig = api.config;
    api.registerTool((ctx) => createJobsTools(ctx));
    api.registerService(createJobsStateService());
    api.registerHttpRoute({
      path: "/jarvis/jobs/claim",
      auth: "plugin",
      match: "exact",
      handler: handleJobsClaim
    });
    api.registerHttpRoute({
      path: "/jarvis/jobs/heartbeat",
      auth: "plugin",
      match: "exact",
      handler: handleJobsHeartbeat
    });
    api.registerHttpRoute({
      path: "/jarvis/jobs/callback",
      auth: "plugin",
      match: "exact",
      handler: handleJobsCallback
    });
  }
});
