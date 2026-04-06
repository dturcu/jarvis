import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  SCHEDULER_COMMAND_NAMES,
  SCHEDULER_TOOL_NAMES,
  getJarvisState,
  safeJsonParse,
  submitSchedulerCreateAlert,
  submitSchedulerCreateSchedule,
  submitSchedulerCreateWorkflow,
  submitSchedulerDeleteSchedule,
  submitSchedulerHabitStatus,
  submitSchedulerHabitTrack,
  submitSchedulerListSchedules,
  submitSchedulerRunWorkflow,
  toCommandReply,
  toToolResult,
  type SchedulerCreateAlertParams,
  type SchedulerCreateScheduleParams,
  type SchedulerCreateWorkflowParams,
  type SchedulerDeleteScheduleParams,
  type SchedulerHabitStatusParams,
  type SchedulerHabitTrackParams,
  type SchedulerListSchedulesParams,
  type SchedulerRunWorkflowParams,
  type ToolResponse
} from "@jarvis/shared";

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const operatorSchema = asLiteralUnion(["gt", "lt", "eq", "gte", "lte"] as const);
const severitySchema = asLiteralUnion(["info", "warning", "critical"] as const);

function createSchedulerTool(
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

export function createSchedulerTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createSchedulerTool(
      ctx,
      "scheduler_create_schedule",
      "Create Schedule",
      "Creates a recurring schedule that automatically fires a job type on a cron expression or fixed interval.",
      Type.Object({
        jobType: Type.String({ minLength: 1 }),
        input: Type.Record(Type.String(), Type.Unknown()),
        cronExpression: Type.Optional(Type.String({ minLength: 1 })),
        intervalSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
        enabled: Type.Optional(Type.Boolean()),
        scopeGroup: Type.Optional(Type.String({ minLength: 1 })),
        label: Type.Optional(Type.String({ minLength: 1 }))
      }),
      submitSchedulerCreateSchedule
    ),
    createSchedulerTool(
      ctx,
      "scheduler_list_schedules",
      "List Schedules",
      "Lists all recurring schedules, optionally filtered by scope group or enabled state.",
      Type.Object({
        scopeGroup: Type.Optional(Type.String({ minLength: 1 })),
        enabledOnly: Type.Optional(Type.Boolean())
      }),
      submitSchedulerListSchedules
    ),
    createSchedulerTool(
      ctx,
      "scheduler_delete_schedule",
      "Delete Schedule",
      "Removes a recurring schedule by its ID, stopping all future automatic firing.",
      Type.Object({
        scheduleId: Type.String({ minLength: 1 })
      }),
      submitSchedulerDeleteSchedule
    ),
    createSchedulerTool(
      ctx,
      "scheduler_create_alert",
      "Create Alert",
      "Creates a threshold alert rule that monitors a metric path in job outputs and triggers notifications when the threshold is crossed.",
      Type.Object({
        label: Type.String({ minLength: 1 }),
        monitorJobType: Type.String({ minLength: 1 }),
        metricPath: Type.String({ minLength: 1 }),
        operator: operatorSchema,
        threshold: Type.Number(),
        notifySeverity: Type.Optional(severitySchema),
        cooldownSeconds: Type.Optional(Type.Integer({ minimum: 0 }))
      }),
      submitSchedulerCreateAlert
    ),
    createSchedulerTool(
      ctx,
      "scheduler_create_workflow",
      "Create Workflow",
      "Creates a named multi-step workflow that can be run on demand.",
      Type.Object({
        label: Type.String({ minLength: 1 }),
        steps: Type.Array(
          Type.Object({
            jobType: Type.String({ minLength: 1 }),
            input: Type.Record(Type.String(), Type.Unknown()),
            delaySeconds: Type.Optional(Type.Integer({ minimum: 0 }))
          }),
          { minItems: 1 }
        ),
        scopeGroup: Type.Optional(Type.String({ minLength: 1 }))
      }),
      submitSchedulerCreateWorkflow
    ),
    createSchedulerTool(
      ctx,
      "scheduler_run_workflow",
      "Run Workflow",
      "Queues all steps of a stored workflow for execution.",
      Type.Object({
        workflowId: Type.String({ minLength: 1 })
      }),
      submitSchedulerRunWorkflow
    ),
    createSchedulerTool(
      ctx,
      "scheduler_habit_track",
      "Track Habit",
      "Creates a new habit, logs a value for an existing habit, or deletes a habit.",
      Type.Object({
        habitId: Type.Optional(Type.String({ minLength: 1 })),
        label: Type.Optional(Type.String({ minLength: 1 })),
        action: asLiteralUnion(["create", "log", "delete"] as const),
        value: Type.Optional(Type.Number())
      }),
      submitSchedulerHabitTrack
    ),
    createSchedulerTool(
      ctx,
      "scheduler_habit_status",
      "Habit Status",
      "Returns habit completion statistics for a given time window.",
      Type.Object({
        habitId: Type.Optional(Type.String({ minLength: 1 })),
        daysBack: Type.Optional(Type.Integer({ minimum: 1 }))
      }),
      submitSchedulerHabitStatus
    )
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

function missingJsonReply(commandName: string, usage: string) {
  return toCommandReply(`Usage: /${commandName} ${usage}`, true);
}

type ScheduleCommandArgs = {
  operation: "create" | "list" | "delete";
  jobType?: string;
  input?: Record<string, unknown>;
  cronExpression?: string;
  intervalSeconds?: number;
  enabled?: boolean;
  scopeGroup?: string;
  label?: string;
  scheduleId?: string;
  enabledOnly?: boolean;
};

type AlertsCommandArgs = {
  operation: "create";
  label?: string;
  monitorJobType?: string;
  metricPath?: string;
  operator?: SchedulerCreateAlertParams["operator"];
  threshold?: number;
  notifySeverity?: SchedulerCreateAlertParams["notifySeverity"];
  cooldownSeconds?: number;
};

export function createScheduleCommand() {
  return {
    name: "schedule",
    description: "Manage recurring schedules: create, list, or delete scheduled job automations.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<ScheduleCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("schedule");
      }

      switch (args.operation) {
        case "create": {
          if (!args.jobType) {
            return missingJsonReply(
              "schedule",
              '{"operation":"create","jobType":"system.monitor_cpu","input":{},"intervalSeconds":300}'
            );
          }
          const response = submitSchedulerCreateSchedule(toToolContext(ctx), {
            jobType: args.jobType,
            input: args.input ?? {},
            cronExpression: args.cronExpression,
            intervalSeconds: args.intervalSeconds,
            enabled: args.enabled,
            scopeGroup: args.scopeGroup,
            label: args.label
          });
          return toCommandReply(formatJobReply(response));
        }
        case "list": {
          const response = submitSchedulerListSchedules(toToolContext(ctx), {
            scopeGroup: args.scopeGroup,
            enabledOnly: args.enabledOnly
          });
          return toCommandReply(formatJobReply(response));
        }
        case "delete": {
          if (!args.scheduleId) {
            return missingJsonReply(
              "schedule",
              '{"operation":"delete","scheduleId":"<uuid>"}'
            );
          }
          const response = submitSchedulerDeleteSchedule(toToolContext(ctx), {
            scheduleId: args.scheduleId
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /schedule operation: ${String((args as { operation?: unknown }).operation)}`,
            true
          );
      }
    }
  };
}

export function createAlertsCommand() {
  return {
    name: "alerts",
    description: "Manage threshold alert rules: create alerts that fire when job metrics cross thresholds.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<AlertsCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("alerts");
      }

      if (args.operation === "create") {
        if (!args.label || !args.monitorJobType || !args.metricPath || args.operator === undefined || args.threshold === undefined) {
          return missingJsonReply(
            "alerts",
            '{"operation":"create","label":"High CPU","monitorJobType":"system.monitor_cpu","metricPath":"cpu_percent","operator":"gt","threshold":90}'
          );
        }
        const response = submitSchedulerCreateAlert(toToolContext(ctx), {
          label: args.label,
          monitorJobType: args.monitorJobType,
          metricPath: args.metricPath,
          operator: args.operator,
          threshold: args.threshold,
          notifySeverity: args.notifySeverity,
          cooldownSeconds: args.cooldownSeconds
        });
        return toCommandReply(formatJobReply(response));
      }

      return toCommandReply(
        `Unsupported /alerts operation: ${String((args as { operation?: unknown }).operation)}`,
        true
      );
    }
  };
}

export const jarvisSchedulerToolNames = [...SCHEDULER_TOOL_NAMES];
export const jarvisSchedulerCommandNames = [...SCHEDULER_COMMAND_NAMES];

export * from "./store.js";
export * from "./evaluator.js";

export default definePluginEntry({
  id: "jarvis-scheduler",
  name: "Jarvis Scheduler",
  description: "Proactive scheduler for recurring jobs, interval automation, cron-based triggers, and threshold alert rules",
  register(api) {
    api.registerTool((ctx) => createSchedulerTools(ctx));
    api.registerCommand(createScheduleCommand());
    api.registerCommand(createAlertsCommand());
  }
});
