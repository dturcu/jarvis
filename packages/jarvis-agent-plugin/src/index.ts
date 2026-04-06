import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  AGENT_TOOL_NAMES,
  AGENT_COMMAND_NAMES,
  getJarvisState,
  safeJsonParse,
  submitAgentStart,
  submitAgentStep,
  submitAgentStatus,
  submitAgentPause,
  submitAgentResume,
  submitAgentConfigure,
  toCommandReply,
  toToolResult,
  type AgentStartParams,
  type AgentStepParams,
  type AgentStatusParams,
  type AgentPauseParams,
  type AgentResumeParams,
  type AgentConfigureParams,
  type ToolResponse
} from "@jarvis/shared";

type AgentCommandArgs = {
  operation: "start" | "step" | "status" | "pause" | "resume" | "configure";
  agentId?: string;
  runId?: string;
  goal?: string;
  action?: string;
  input?: Record<string, unknown>;
  triggerKind?: "manual" | "schedule" | "event" | "threshold";
  cron?: string;
  eventType?: string;
  alertId?: string;
  label?: string;
  systemPrompt?: string;
  inferenceTier?: "haiku" | "sonnet" | "opus";
  maxStepsPerRun?: number;
  capabilities?: string[];
  outputChannels?: string[];
};

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const triggerKindSchema = asLiteralUnion(["manual", "schedule", "event", "threshold"] as const);
const inferenceTierSchema = asLiteralUnion(["haiku", "sonnet", "opus"] as const);

function createAgentTool(
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

export function createAgentTools(
  ctx: OpenClawPluginToolContext,
): AnyAgentTool[] {
  return [
    createAgentTool(
      ctx,
      "agent_start",
      "Agent Start",
      "Start a new agent run with the given goal and trigger. Returns a run_id for tracking.",
      Type.Object({
        agent_id: Type.String({ minLength: 1, description: "ID of the agent to start." }),
        goal: Type.Optional(Type.String({ minLength: 1, description: "Goal or task description for the agent run." })),
        trigger_kind: Type.Optional(triggerKindSchema),
        cron: Type.Optional(Type.String({ minLength: 1, description: "Cron expression when trigger_kind is 'schedule'." })),
        event_type: Type.Optional(Type.String({ minLength: 1, description: "Event type when trigger_kind is 'event'." })),
        alert_id: Type.Optional(Type.String({ minLength: 1, description: "Alert ID when trigger_kind is 'threshold'." })),
      }),
      (toolCtx, params: { agent_id: string; goal?: string; trigger_kind?: AgentStartParams["triggerKind"]; cron?: string; event_type?: string; alert_id?: string }) =>
        submitAgentStart(toolCtx, {
          agentId: params.agent_id,
          goal: params.goal,
          triggerKind: params.trigger_kind ?? "manual",
          cron: params.cron,
          eventType: params.event_type,
          alertId: params.alert_id,
        })
    ),
    createAgentTool(
      ctx,
      "agent_step",
      "Agent Step",
      "Execute the next step in an active agent run. Provide the run_id, the action name, and optional input.",
      Type.Object({
        run_id: Type.String({ minLength: 1, description: "ID of the active agent run." }),
        action: Type.String({ minLength: 1, description: "Action to execute in this step." }),
        input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Input parameters for the action." })),
      }),
      (toolCtx, params: { run_id: string; action: string; input?: Record<string, unknown> }) =>
        submitAgentStep(toolCtx, {
          runId: params.run_id,
          action: params.action,
          input: params.input,
        })
    ),
    createAgentTool(
      ctx,
      "agent_status",
      "Agent Status",
      "Retrieve the current status and active runs for an agent. Optionally filter to a specific run.",
      Type.Object({
        agent_id: Type.String({ minLength: 1, description: "ID of the agent to query." }),
        run_id: Type.Optional(Type.String({ minLength: 1, description: "Filter to a specific run ID." })),
      }),
      (toolCtx, params: { agent_id: string; run_id?: string }) =>
        submitAgentStatus(toolCtx, {
          agentId: params.agent_id,
          runId: params.run_id,
        })
    ),
    createAgentTool(
      ctx,
      "agent_pause",
      "Agent Pause",
      "Pause an active agent run, preserving its state for later resumption.",
      Type.Object({
        run_id: Type.String({ minLength: 1, description: "ID of the agent run to pause." }),
      }),
      (toolCtx, params: { run_id: string }) =>
        submitAgentPause(toolCtx, { runId: params.run_id })
    ),
    createAgentTool(
      ctx,
      "agent_resume",
      "Agent Resume",
      "Resume a previously paused agent run from where it left off.",
      Type.Object({
        run_id: Type.String({ minLength: 1, description: "ID of the paused agent run to resume." }),
      }),
      (toolCtx, params: { run_id: string }) =>
        submitAgentResume(toolCtx, { runId: params.run_id })
    ),
    createAgentTool(
      ctx,
      "agent_configure",
      "Agent Configure",
      "Update the configuration of a registered agent including its system prompt, inference tier, capabilities, and output channels.",
      Type.Object({
        agent_id: Type.String({ minLength: 1, description: "ID of the agent to configure." }),
        label: Type.Optional(Type.String({ minLength: 1, description: "Human-readable label for the agent." })),
        system_prompt: Type.Optional(Type.String({ minLength: 1, description: "System prompt to use for the agent." })),
        inference_tier: Type.Optional(inferenceTierSchema),
        max_steps_per_run: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum steps allowed per run." })),
        capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "List of capability identifiers for this agent." })),
        output_channels: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Output channel identifiers for agent results." })),
      }),
      (toolCtx, params: { agent_id: string; label?: string; system_prompt?: string; inference_tier?: AgentConfigureParams["inferenceTier"]; max_steps_per_run?: number; capabilities?: string[]; output_channels?: string[] }) =>
        submitAgentConfigure(toolCtx, {
          agentId: params.agent_id,
          label: params.label,
          systemPrompt: params.system_prompt,
          inferenceTier: params.inference_tier,
          maxStepsPerRun: params.max_steps_per_run,
          capabilities: params.capabilities,
          outputChannels: params.output_channels,
        })
    ),
  ];
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

function parseJsonArgs<T>(ctx: PluginCommandContext): T | null {
  return safeJsonParse<T>(ctx.args);
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createAgentCommand() {
  return {
    name: "agent",
    description: "Manage agent runs: start, step, status, pause, resume, configure.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<AgentCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("agent");
      }

      const toolCtx = toToolContext(ctx);

      switch (args.operation) {
        case "start": {
          if (!args.agentId) {
            return toCommandReply("Usage: /agent {\"operation\":\"start\",\"agentId\":\"...\",\"goal\":\"...\"}", true);
          }
          const response = submitAgentStart(toolCtx, {
            agentId: args.agentId,
            goal: args.goal,
            triggerKind: args.triggerKind ?? "manual",
            cron: args.cron,
            eventType: args.eventType,
            alertId: args.alertId,
          });
          return toCommandReply(formatJobReply(response));
        }
        case "step": {
          if (!args.runId || !args.action) {
            return toCommandReply("Usage: /agent {\"operation\":\"step\",\"runId\":\"...\",\"action\":\"...\"}", true);
          }
          const response = submitAgentStep(toolCtx, {
            runId: args.runId,
            action: args.action,
            input: args.input,
          });
          return toCommandReply(formatJobReply(response));
        }
        case "status": {
          if (!args.agentId) {
            return toCommandReply("Usage: /agent {\"operation\":\"status\",\"agentId\":\"...\"}", true);
          }
          const response = submitAgentStatus(toolCtx, {
            agentId: args.agentId,
            runId: args.runId,
          });
          return toCommandReply(formatJobReply(response));
        }
        case "pause": {
          if (!args.runId) {
            return toCommandReply("Usage: /agent {\"operation\":\"pause\",\"runId\":\"...\"}", true);
          }
          const response = submitAgentPause(toolCtx, { runId: args.runId });
          return toCommandReply(formatJobReply(response));
        }
        case "resume": {
          if (!args.runId) {
            return toCommandReply("Usage: /agent {\"operation\":\"resume\",\"runId\":\"...\"}", true);
          }
          const response = submitAgentResume(toolCtx, { runId: args.runId });
          return toCommandReply(formatJobReply(response));
        }
        case "configure": {
          if (!args.agentId) {
            return toCommandReply("Usage: /agent {\"operation\":\"configure\",\"agentId\":\"...\"}", true);
          }
          const response = submitAgentConfigure(toolCtx, {
            agentId: args.agentId,
            label: args.label,
            systemPrompt: args.systemPrompt,
            inferenceTier: args.inferenceTier,
            maxStepsPerRun: args.maxStepsPerRun,
            capabilities: args.capabilities,
            outputChannels: args.outputChannels,
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /agent operation: ${String((args as AgentCommandArgs).operation)}. Valid operations: start, step, status, pause, resume, configure.`,
            true
          );
      }
    }
  };
}

export function createAgentsCommand() {
  return {
    name: "agents",
    description: "List or query registered agents. Pass JSON with {agentId} to filter.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<{ agentId?: string }>(ctx) ?? {};
      const toolCtx = toToolContext(ctx);
      if (!args.agentId) {
        return toCommandReply("Usage: /agents {\"agentId\":\"...\"}", true);
      }
      const response = submitAgentStatus(toolCtx, { agentId: args.agentId });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisAgentToolNames = [...AGENT_TOOL_NAMES];
export const jarvisAgentCommandNames = [...AGENT_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-agent",
  name: "Jarvis Agent",
  description: "Agent lifecycle management plugin for starting, stepping, pausing, resuming, and configuring autonomous agents",
  register(api) {
    api.registerTool((ctx) => createAgentTools(ctx));
    api.registerCommand(createAgentCommand());
    api.registerCommand(createAgentsCommand());
  }
});
