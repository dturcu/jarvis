import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type SchedulerCreateScheduleParams = {
  jobType: string;
  input: Record<string, unknown>;
  cronExpression?: string;
  intervalSeconds?: number;
  enabled?: boolean;
  scopeGroup?: string;
  label?: string;
};

export type SchedulerListSchedulesParams = {
  scopeGroup?: string;
  enabledOnly?: boolean;
};

export type SchedulerDeleteScheduleParams = {
  scheduleId: string;
};

export type SchedulerCreateAlertParams = {
  label: string;
  monitorJobType: string;
  metricPath: string;
  operator: "gt" | "lt" | "eq" | "gte" | "lte";
  threshold: number;
  notifySeverity?: "info" | "warning" | "critical";
  cooldownSeconds?: number;
};

export function submitSchedulerCreateSchedule(
  ctx: OpenClawPluginToolContext | undefined,
  params: SchedulerCreateScheduleParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "scheduler.create_schedule",
    input: {
      job_type: params.jobType,
      input: params.input,
      cron_expression: params.cronExpression,
      interval_seconds: params.intervalSeconds,
      enabled: params.enabled ?? true,
      scope_group: params.scopeGroup,
      label: params.label
    }
  });
}

export function submitSchedulerListSchedules(
  ctx: OpenClawPluginToolContext | undefined,
  params: SchedulerListSchedulesParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "scheduler.list_schedules",
    input: {
      scope_group: params.scopeGroup,
      enabled_only: params.enabledOnly ?? false
    }
  });
}

export function submitSchedulerDeleteSchedule(
  ctx: OpenClawPluginToolContext | undefined,
  params: SchedulerDeleteScheduleParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "scheduler.delete_schedule",
    input: {
      schedule_id: params.scheduleId
    }
  });
}

export function submitSchedulerCreateAlert(
  ctx: OpenClawPluginToolContext | undefined,
  params: SchedulerCreateAlertParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "scheduler.create_alert",
    input: {
      label: params.label,
      monitor_job_type: params.monitorJobType,
      metric_path: params.metricPath,
      operator: params.operator,
      threshold: params.threshold,
      notify_severity: params.notifySeverity ?? "warning",
      cooldown_seconds: params.cooldownSeconds ?? 300
    }
  });
}

export type SchedulerCreateWorkflowParams = {
  label: string;
  steps: Array<{ jobType: string; input: Record<string, unknown>; delaySeconds?: number }>;
  scopeGroup?: string;
};

export type SchedulerRunWorkflowParams = {
  workflowId: string;
};

export type SchedulerHabitTrackParams = {
  habitId?: string;
  label?: string;
  action: "create" | "log" | "delete";
  value?: number;
};

export type SchedulerHabitStatusParams = {
  habitId?: string;
  daysBack?: number;
};

export function submitSchedulerCreateWorkflow(
  ctx: OpenClawPluginToolContext | undefined,
  params: SchedulerCreateWorkflowParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "scheduler.create_workflow",
    input: {
      label: params.label,
      steps: params.steps.map((step) => ({
        job_type: step.jobType,
        input: step.input,
        delay_seconds: step.delaySeconds
      })),
      scope_group: params.scopeGroup
    }
  });
}

export function submitSchedulerRunWorkflow(
  ctx: OpenClawPluginToolContext | undefined,
  params: SchedulerRunWorkflowParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "scheduler.run_workflow",
    input: {
      workflow_id: params.workflowId
    }
  });
}

export function submitSchedulerHabitTrack(
  ctx: OpenClawPluginToolContext | undefined,
  params: SchedulerHabitTrackParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "scheduler.habit_track",
    input: {
      habit_id: params.habitId,
      label: params.label,
      action: params.action,
      value: params.value
    }
  });
}

export function submitSchedulerHabitStatus(
  ctx: OpenClawPluginToolContext | undefined,
  params: SchedulerHabitStatusParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "scheduler.habit_status",
    input: {
      habit_id: params.habitId,
      days_back: params.daysBack
    }
  });
}
