import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type AgentStartParams = {
  agentId: string;
  goal?: string;
  triggerKind: "manual" | "schedule" | "event" | "threshold";
  cron?: string;
  eventType?: string;
  alertId?: string;
};

export type AgentStepParams = {
  runId: string;
  action: string;
  input?: Record<string, unknown>;
};

export type AgentStatusParams = {
  agentId: string;
  runId?: string;
};

export type AgentPauseParams = {
  runId: string;
};

export type AgentResumeParams = {
  runId: string;
};

export type AgentConfigureParams = {
  agentId: string;
  label?: string;
  systemPrompt?: string;
  taskProfile?: { objective: string; constraints?: Record<string, unknown>; preferences?: Record<string, unknown> };
  maxStepsPerRun?: number;
  capabilities?: string[];
  outputChannels?: string[];
};

export function submitAgentStart(
  ctx: OpenClawPluginToolContext | undefined,
  params: AgentStartParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "agent.start",
    input: {
      agent_id: params.agentId,
      goal: params.goal,
      trigger_kind: params.triggerKind,
      cron: params.cron,
      event_type: params.eventType,
      alert_id: params.alertId,
    }
  });
}

export function submitAgentStep(
  ctx: OpenClawPluginToolContext | undefined,
  params: AgentStepParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "agent.step",
    input: {
      run_id: params.runId,
      action: params.action,
      input: params.input ?? {},
    }
  });
}

export function submitAgentStatus(
  ctx: OpenClawPluginToolContext | undefined,
  params: AgentStatusParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "agent.status",
    input: {
      agent_id: params.agentId,
      run_id: params.runId,
    }
  });
}

export function submitAgentPause(
  ctx: OpenClawPluginToolContext | undefined,
  params: AgentPauseParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "agent.pause",
    input: {
      run_id: params.runId,
    }
  });
}

export function submitAgentResume(
  ctx: OpenClawPluginToolContext | undefined,
  params: AgentResumeParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "agent.resume",
    input: {
      run_id: params.runId,
    }
  });
}

export function submitAgentConfigure(
  ctx: OpenClawPluginToolContext | undefined,
  params: AgentConfigureParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "agent.configure",
    input: {
      agent_id: params.agentId,
      label: params.label,
      system_prompt: params.systemPrompt,
      task_profile: params.taskProfile,
      max_steps_per_run: params.maxStepsPerRun,
      capabilities: params.capabilities,
      output_channels: params.outputChannels,
    }
  });
}
