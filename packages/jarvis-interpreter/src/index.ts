import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  INTERPRETER_COMMAND_NAMES,
  INTERPRETER_TOOL_NAMES,
  safeJsonParse,
  submitInterpreterRunCode,
  submitInterpreterRunTask,
  submitInterpreterStatus,
  toCommandReply,
  toToolResult,
  type InterpreterRunCodeParams,
  type InterpreterRunTaskParams,
  type InterpreterStatusParams,
  type ToolResponse
} from "@jarvis/shared";

const languageSchema = Type.Union([
  Type.Literal("python"),
  Type.Literal("javascript"),
  Type.Literal("shell")
]);

function createInterpreterTool(
  ctx: OpenClawPluginToolContext,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  submit: (ctx: OpenClawPluginToolContext | undefined, params: any) => ToolResponse,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(submit(ctx, params))
  };
}

export function createInterpreterTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createInterpreterTool(
      ctx,
      "interpreter_run_task",
      "Interpreter Run Task",
      "Run a complex multi-step automation task using Open Interpreter. The interpreter will plan and execute code autonomously to complete the task.",
      Type.Object({
        task: Type.String({ minLength: 1, description: "The high-level task description for Open Interpreter to execute." }),
        context: Type.Optional(Type.String({ description: "Additional context or constraints for the task." })),
        autoApprove: Type.Optional(Type.Boolean({ description: "Whether to auto-approve code execution without user confirmation." })),
        model: Type.Optional(Type.String({ description: "Override the default LLM model used by Open Interpreter." }))
      }),
      submitInterpreterRunTask
    ),
    createInterpreterTool(
      ctx,
      "interpreter_run_code",
      "Interpreter Run Code",
      "Execute a specific code snippet in Python, JavaScript, or shell. Returns stdout, stderr, and exit code.",
      Type.Object({
        language: languageSchema,
        code: Type.String({ minLength: 1, description: "The code to execute." }),
        timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600, description: "Timeout in seconds (default: 60)." }))
      }),
      submitInterpreterRunCode
    ),
    createInterpreterTool(
      ctx,
      "interpreter_status",
      "Interpreter Status",
      "List active Open Interpreter sessions and their current status.",
      Type.Object({
        sessionId: Type.Optional(Type.String({ description: "Filter to a specific session ID." }))
      }),
      submitInterpreterStatus
    )
  ];
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) {
    parts.push(`job=${response.job_id}`);
  }
  if (response.approval_id) {
    parts.push(`approval=${response.approval_id}`);
  }
  return parts.join(" | ");
}

type InterpretCommandArgs = {
  task: string;
  context?: string;
  autoApprove?: boolean;
  model?: string;
};

type RunCodeCommandArgs = {
  language: InterpreterRunCodeParams["language"];
  code: string;
  timeout?: number;
};

export function createInterpretCommand() {
  return {
    name: "interpret",
    description: "Submit a high-level automation task to Open Interpreter.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const toolCtx = toToolContext(ctx);
      const args = safeJsonParse<InterpretCommandArgs>(ctx.args);
      if (!args || !args.task) {
        return toCommandReply(
          'Usage: /interpret {"task": "Download the latest sales report and summarize it"}',
          true
        );
      }
      const response = submitInterpreterRunTask(toolCtx, {
        task: args.task,
        context: args.context,
        autoApprove: args.autoApprove,
        model: args.model
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export function createRunCodeCommand() {
  return {
    name: "run-code",
    description: "Execute a code snippet via Open Interpreter.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const toolCtx = toToolContext(ctx);
      const args = safeJsonParse<RunCodeCommandArgs>(ctx.args);
      if (!args || !args.language || !args.code) {
        return toCommandReply(
          'Usage: /run-code {"language": "python", "code": "print(\'hello\')"}',
          true
        );
      }
      const response = submitInterpreterRunCode(toolCtx, {
        language: args.language,
        code: args.code,
        timeout: args.timeout
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisInterpreterToolNames = [...INTERPRETER_TOOL_NAMES];
export const jarvisInterpreterCommandNames = [...INTERPRETER_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-interpreter",
  name: "Jarvis Interpreter",
  description: "Open Interpreter bridge for complex multi-step automation using autonomous LLM-driven code execution",
  register(api) {
    api.registerTool((ctx) => createInterpreterTools(ctx));
    api.registerCommand(createInterpretCommand());
    api.registerCommand(createRunCodeCommand());
  }
});
