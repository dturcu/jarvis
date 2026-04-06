import { Type } from "@sinclair/typebox";
import type {
  AnyAgentTool,
  OpenClawConfig,
  OpenClawPluginToolContext,
  PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  DISPATCH_COMMAND_NAMES,
  DISPATCH_TOOL_NAMES,
  createToolResponse,
  getJarvisState,
  safeJsonParse,
  sendSessionMessage,
  toCommandReply,
  toToolResult,
  type ToolResponse
} from "@jarvis/shared";

type DispatchToolName = (typeof DISPATCH_TOOL_NAMES)[number];
type DispatchCommandName = (typeof DISPATCH_COMMAND_NAMES)[number];

type DispatchActionPayload = {
  kind: DispatchToolName;
  sessionKey?: string;
  sessionKeys?: string[];
  text?: string;
  jobId?: string;
  workerType?: string;
  goal?: string;
  approvalId?: string;
};

type DispatchRuntimeEnv = {
  config: OpenClawConfig;
  runtime: {
    subagent: {
      run(params: {
        sessionKey: string;
        message: string;
        lane?: string;
        deliver?: boolean;
      }): Promise<{ runId: string }>;
    };
  };
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readRequiredString(
  params: Record<string, unknown>,
  key: string,
): string {
  const value = params[key];
  if (!isNonEmptyString(value)) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function readRequiredStringArray(
  params: Record<string, unknown>,
  key: string,
): string[] {
  const value = params[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty string array.`);
  }
  const normalized = value.map((entry) => {
    if (!isNonEmptyString(entry)) {
      throw new Error(`${key} must contain only non-empty strings.`);
    }
    return entry.trim();
  });
  return normalized;
}

function failureResponse(summary: string, field?: string): ToolResponse {
  return createToolResponse({
    status: "failed",
    summary,
    error: {
      code: "INVALID_ARGUMENT",
      message: summary,
      retryable: false,
      field
    }
  });
}

function formatReply(response: ToolResponse): string {
  const lines = [response.summary];
  if (response.job_id) {
    lines.push(`job_id: ${response.job_id}`);
  }
  if (response.approval_id) {
    lines.push(`approval_id: ${response.approval_id}`);
  }
  if (response.structured_output && Object.keys(response.structured_output).length > 0) {
    lines.push(JSON.stringify(response.structured_output, null, 2));
  }
  if (response.error) {
    lines.push(
      JSON.stringify(
        {
          code: response.error.code,
          message: response.error.message,
          retryable: response.error.retryable
        },
        null,
        2,
      ),
    );
  }
  return lines.join("\n");
}

function responseToCommandReply(response: ToolResponse) {
  return toCommandReply(formatReply(response), response.status === "failed");
}

function extractDispatchId(response: ToolResponse): string | undefined {
  const dispatch =
    response.structured_output &&
    typeof response.structured_output === "object" &&
    "dispatch" in response.structured_output
      ? (response.structured_output.dispatch as { dispatch_id?: string })
      : undefined;
  return dispatch?.dispatch_id;
}

function completeResponse(
  summary: string,
  structured_output?: Record<string, unknown>,
): ToolResponse {
  return createToolResponse({
    status: "completed",
    summary,
    structured_output
  });
}

function markFailure(response: ToolResponse, message: string): ToolResponse {
  return createToolResponse({
    status: "failed",
    summary: message,
    job_id: response.job_id,
    approval_id: response.approval_id,
    structured_output: response.structured_output,
    error: {
      code: "DISPATCH_FAILED",
      message,
      retryable: true
    }
  });
}

async function executeDispatchAction(
  kind: DispatchToolName,
  params: Record<string, unknown>,
  env: DispatchRuntimeEnv,
): Promise<ToolResponse> {
  const state = getJarvisState();

  switch (kind) {
    case "dispatch_to_session": {
      const sessionKey = readRequiredString(params, "sessionKey");
      const text = readRequiredString(params, "text");
      const accepted = state.createDispatch({
        kind,
        sessionKey,
        text,
        approvalId: readOptionalString(params, "approvalId"),
        requireApproval: true
      });
      if (accepted.status !== "accepted") {
        return accepted;
      }

      const dispatchId = extractDispatchId(accepted);

      try {
        const receipt = await sendSessionMessage(
          { sessionKey, message: text },
          env.config,
        );
        if (dispatchId) {
          state.markDispatchDelivered(dispatchId, receipt);
        }
        return completeResponse(`Sent message to ${sessionKey}.`, {
          dispatch_id: dispatchId,
          session_key: sessionKey,
          receipt
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Dispatch delivery failed.";
        if (dispatchId) {
          state.markDispatchFailed(dispatchId, "DISPATCH_FAILED", message, true);
        }
        return markFailure(accepted, message);
      }
    }
    case "dispatch_followup": {
      const jobId = readRequiredString(params, "jobId");
      const text = readRequiredString(params, "text");
      const job = state.getJobRecord(jobId);
      if (!job) {
        return failureResponse(`Unknown job id: ${jobId}.`, "jobId");
      }

      const accepted = state.createDispatch({
        kind,
        jobId,
        sessionKey: job.envelope.session_key,
        text,
        approvalId: readOptionalString(params, "approvalId"),
        requireApproval: false
      });
      if (accepted.status !== "accepted") {
        return accepted;
      }

      const dispatchId = extractDispatchId(accepted);

      try {
        const receipt = await sendSessionMessage(
          { sessionKey: job.envelope.session_key, message: text },
          env.config,
        );
        if (dispatchId) {
          state.markDispatchDelivered(dispatchId, receipt);
        }
        return completeResponse(`Sent follow-up for ${jobId}.`, {
          dispatch_id: dispatchId,
          session_key: job.envelope.session_key,
          receipt
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Follow-up delivery failed.";
        if (dispatchId) {
          state.markDispatchFailed(dispatchId, "DISPATCH_FAILED", message, true);
        }
        return markFailure(accepted, message);
      }
    }
    case "dispatch_broadcast": {
      const sessionKeys = readRequiredStringArray(params, "sessionKeys");
      const text = readRequiredString(params, "text");
      const accepted = state.createDispatch({
        kind,
        sessionKeys,
        text,
        approvalId: readOptionalString(params, "approvalId"),
        requireApproval: true
      });
      if (accepted.status !== "accepted") {
        return accepted;
      }

      const dispatchId = extractDispatchId(accepted);
      const settled = await Promise.allSettled(
        sessionKeys.map(async (sessionKey) => ({
          sessionKey,
          receipt: await sendSessionMessage(
            { sessionKey, message: text },
            env.config,
          )
        })),
      );

      const successes = settled
        .filter((entry): entry is PromiseFulfilledResult<{ sessionKey: string; receipt: Record<string, unknown> }> => entry.status === "fulfilled")
        .map((entry) => entry.value);
      const failures = settled
        .filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
        .map((entry) => String(entry.reason));

      const receipt = {
        delivered: successes.map((entry) => entry.sessionKey),
        failures
      };

      if (dispatchId) {
        if (successes.length > 0) {
          state.markDispatchDelivered(dispatchId, receipt);
        } else {
          state.markDispatchFailed(
            dispatchId,
            "DISPATCH_FAILED",
            failures.join("; ") || "Broadcast delivery failed.",
            true,
            receipt,
          );
        }
      }

      if (successes.length === 0) {
        return markFailure(
          accepted,
          failures.join("; ") || "Broadcast delivery failed.",
        );
      }

      return completeResponse(
        failures.length > 0
          ? `Broadcast delivered to ${successes.length} sessions with ${failures.length} failures.`
          : `Broadcast delivered to ${successes.length} sessions.`,
        {
          dispatch_id: dispatchId,
          receipt
        },
      );
    }
    case "dispatch_notify_completion": {
      const jobId = readRequiredString(params, "jobId");
      const job = state.getJobRecord(jobId);
      if (!job) {
        return failureResponse(`Unknown job id: ${jobId}.`, "jobId");
      }

      const text =
        readOptionalString(params, "text") ?? `Job ${jobId} completed.`;
      const accepted = state.createDispatch({
        kind,
        jobId,
        sessionKey: job.envelope.session_key,
        text,
        approvalId: readOptionalString(params, "approvalId"),
        requireApproval: false
      });
      if (accepted.status !== "accepted") {
        return accepted;
      }

      const dispatchId = extractDispatchId(accepted);

      try {
        const receipt = await sendSessionMessage(
          { sessionKey: job.envelope.session_key, message: text },
          env.config,
        );
        if (dispatchId) {
          state.markDispatchDelivered(dispatchId, receipt);
        }
        return completeResponse(`Notified completion for ${jobId}.`, {
          dispatch_id: dispatchId,
          session_key: job.envelope.session_key,
          receipt
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Completion notification failed.";
        if (dispatchId) {
          state.markDispatchFailed(dispatchId, "DISPATCH_FAILED", message, true);
        }
        return markFailure(accepted, message);
      }
    }
    case "dispatch_spawn_worker_agent": {
      const sessionKey = readRequiredString(params, "sessionKey");
      const goal = readRequiredString(params, "goal");
      const workerType = readRequiredString(params, "workerType");
      const accepted = state.createDispatch({
        kind,
        sessionKey,
        text: `Spawn ${workerType} worker agent`,
        workerType,
        goal,
        approvalId: readOptionalString(params, "approvalId"),
        requireApproval: true
      });
      if (accepted.status !== "accepted") {
        return accepted;
      }

      const dispatchId = extractDispatchId(accepted);

      try {
        const receipt = await env.runtime.subagent.run({
          sessionKey,
          message: goal,
          lane: workerType,
          deliver: true
        });
        if (dispatchId) {
          state.markDispatchDelivered(dispatchId, receipt as Record<string, unknown>);
        }
        return completeResponse(`Spawned ${workerType} worker agent.`, {
          dispatch_id: dispatchId,
          session_key: sessionKey,
          run_id: receipt.runId
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Worker-agent spawn failed.";
        if (dispatchId) {
          state.markDispatchFailed(dispatchId, "DISPATCH_FAILED", message, true);
        }
        return markFailure(accepted, message);
      }
    }
    default:
      return createToolResponse({
        status: "failed",
        summary: `Unsupported dispatch kind: ${kind}.`,
        error: {
          code: "UNSUPPORTED_KIND",
          message: `Unsupported dispatch kind: ${kind}.`,
          retryable: false
        }
      });
  }
}

function createDispatchTool<TName extends DispatchToolName>(spec: {
  name: TName;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: TName;
  env: DispatchRuntimeEnv;
}): AnyAgentTool {
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_toolCallId, params) => {
      try {
        return toToolResult(
          await executeDispatchAction(
            spec.kind,
            params as Record<string, unknown>,
            spec.env,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Dispatch failed.";
        return toToolResult(failureResponse(message));
      }
    }
  };
}

function createDispatchCommand(
  commandName: DispatchCommandName,
  handler: (payload: DispatchActionPayload) => Promise<ToolResponse>,
) {
  return {
    name: commandName.slice(1),
    description: `Execute ${commandName} as a JSON-driven dispatch command.`,
    acceptsArgs: true,
    handler: async (ctx: PluginCommandContext) => {
      const parsed = safeJsonParse<DispatchActionPayload>(ctx.args);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return toCommandReply(
          `Usage: ${commandName} expects a JSON object payload.`,
          true,
        );
      }

      try {
        return responseToCommandReply(await handler(parsed));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Dispatch command failed.";
        return toCommandReply(message, true);
      }
    }
  };
}

function createDispatchTools(
  _ctx: OpenClawPluginToolContext,
  env: DispatchRuntimeEnv,
): AnyAgentTool[] {
  return [
    createDispatchTool({
      name: "dispatch_to_session",
      kind: "dispatch_to_session",
      label: "Dispatch To Session",
      description: "Send a follow-up message to one session.",
      parameters: Type.Object({
        sessionKey: Type.String({ minLength: 1 }),
        text: Type.String({ minLength: 1 }),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      env
    }),
    createDispatchTool({
      name: "dispatch_followup",
      kind: "dispatch_followup",
      label: "Dispatch Followup",
      description: "Send a follow-up message tied to an existing job.",
      parameters: Type.Object({
        jobId: Type.String({ minLength: 1 }),
        text: Type.String({ minLength: 1 }),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      env
    }),
    createDispatchTool({
      name: "dispatch_broadcast",
      kind: "dispatch_broadcast",
      label: "Dispatch Broadcast",
      description: "Broadcast a message to multiple sessions.",
      parameters: Type.Object({
        sessionKeys: Type.Array(Type.String({ minLength: 1 })),
        text: Type.String({ minLength: 1 }),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      env
    }),
    createDispatchTool({
      name: "dispatch_notify_completion",
      kind: "dispatch_notify_completion",
      label: "Dispatch Notify Completion",
      description: "Notify a session that a job completed.",
      parameters: Type.Object({
        jobId: Type.String({ minLength: 1 }),
        text: Type.Optional(Type.String({ minLength: 1 })),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      env
    }),
    createDispatchTool({
      name: "dispatch_spawn_worker_agent",
      kind: "dispatch_spawn_worker_agent",
      label: "Dispatch Spawn Worker Agent",
      description: "Spawn a worker agent in the target session.",
      parameters: Type.Object({
        sessionKey: Type.String({ minLength: 1 }),
        goal: Type.String({ minLength: 1 }),
        workerType: Type.String({ minLength: 1 }),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      env
    })
  ];
}

function createDispatchCommandHandlers(env: DispatchRuntimeEnv) {
  const handlers = {
    dispatch: async (payload: DispatchActionPayload) => {
      if (!payload.kind) {
        throw new Error(
          "dispatch requires a JSON payload with a kind field, for example {\"kind\":\"dispatch_to_session\",...}.",
        );
      }
      return executeDispatchAction(payload.kind, payload as Record<string, unknown>, env);
    },
    followup: async (payload: DispatchActionPayload) =>
      executeDispatchAction("dispatch_followup", payload as Record<string, unknown>, env),
    broadcast: async (payload: DispatchActionPayload) =>
      executeDispatchAction("dispatch_broadcast", payload as Record<string, unknown>, env),
    sendto: async (payload: DispatchActionPayload) =>
      executeDispatchAction("dispatch_to_session", payload as Record<string, unknown>, env)
  } as const;

  return [
    createDispatchCommand("/dispatch", handlers.dispatch),
    createDispatchCommand("/followup", handlers.followup),
    createDispatchCommand("/broadcast", handlers.broadcast),
    createDispatchCommand("/sendto", handlers.sendto)
  ];
}

export const jarvisDispatchToolNames = [...DISPATCH_TOOL_NAMES];
export const jarvisDispatchCommandNames = [...DISPATCH_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-dispatch",
  name: "Jarvis Dispatch",
  description: "Jarvis session dispatch, follow-up, and broadcast plugin",
  register(api) {
    const env: DispatchRuntimeEnv = {
      config: api.config,
      runtime: api.runtime as DispatchRuntimeEnv["runtime"]
    };

    api.registerTool((ctx) => createDispatchTools(ctx, env));
    for (const command of createDispatchCommandHandlers(env)) {
      api.registerCommand(command);
    }
  }
});
