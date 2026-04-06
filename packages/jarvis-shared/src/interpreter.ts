import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type InterpreterRunTaskParams = {
  task: string;
  context?: string;
  autoApprove?: boolean;
  model?: string;
};

export type InterpreterRunCodeParams = {
  language: "python" | "javascript" | "shell";
  code: string;
  timeout?: number;
};

export type InterpreterStatusParams = {
  sessionId?: string;
};

export function submitInterpreterRunTask(
  ctx: OpenClawPluginToolContext | undefined,
  params: InterpreterRunTaskParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "interpreter.run_task",
    input: {
      task: params.task,
      context: params.context,
      auto_approve: params.autoApprove ?? false,
      model: params.model
    }
  });
}

export function submitInterpreterRunCode(
  ctx: OpenClawPluginToolContext | undefined,
  params: InterpreterRunCodeParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "interpreter.run_code",
    input: {
      language: params.language,
      code: params.code,
      timeout_seconds: params.timeout ?? 60
    }
  });
}

export function submitInterpreterStatus(
  ctx: OpenClawPluginToolContext | undefined,
  params: InterpreterStatusParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "interpreter.status",
    input: {
      session_id: params.sessionId
    }
  });
}
