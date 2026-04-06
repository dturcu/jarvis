import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  SYSTEM_TOOL_NAMES,
  SYSTEM_COMMAND_NAMES,
  getJarvisState,
  safeJsonParse,
  submitSystemMonitorCpu,
  submitSystemMonitorMemory,
  submitSystemMonitorDisk,
  submitSystemMonitorNetwork,
  submitSystemMonitorBattery,
  submitSystemListProcesses,
  submitSystemKillProcess,
  submitSystemHardwareInfo,
  toCommandReply,
  toToolResult,
  type SystemMonitorCpuParams,
  type SystemMonitorMemoryParams,
  type SystemMonitorDiskParams,
  type SystemMonitorNetworkParams,
  type SystemMonitorBatteryParams,
  type SystemListProcessesParams,
  type SystemKillProcessParams,
  type SystemHardwareInfoParams,
  type ToolResponse
} from "@jarvis/shared";

type SystemCommandArgs = {
  operation:
    | "cpu"
    | "memory"
    | "disk"
    | "network"
    | "battery";
  perCore?: boolean;
  topN?: number;
  path?: string;
  interfaceName?: string;
};

type ProcessesCommandArgs = {
  sortBy?: "cpu" | "memory" | "name";
  topN?: number;
  nameContains?: string;
};

type HardwareCommandArgs = {
  components?: Array<"cpu" | "gpu" | "memory" | "disk" | "network" | "display" | "battery">;
};

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const sortBySchema = asLiteralUnion(["cpu", "memory", "name"] as const);
const hardwareComponentSchema = asLiteralUnion([
  "cpu",
  "gpu",
  "memory",
  "disk",
  "network",
  "display",
  "battery"
] as const);

function createSystemTool(
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

export function createSystemTools(
  ctx: OpenClawPluginToolContext,
): AnyAgentTool[] {
  return [
    createSystemTool(
      ctx,
      "system_monitor_cpu",
      "System Monitor CPU",
      "Monitor current CPU utilisation, per-core if requested.",
      Type.Object({
        per_core: Type.Optional(Type.Boolean({ description: "Include per-core breakdown." }))
      }),
      (toolCtx, params: { per_core?: boolean }) =>
        submitSystemMonitorCpu(toolCtx, { perCore: params.per_core })
    ),
    createSystemTool(
      ctx,
      "system_monitor_memory",
      "System Monitor Memory",
      "Report current memory usage including total, used, free, and top consumers.",
      Type.Object({
        top_n: Type.Optional(Type.Integer({
          minimum: 1,
          maximum: 100,
          description: "Number of top memory-consuming processes to include."
        }))
      }),
      (toolCtx, params: { top_n?: number }) =>
        submitSystemMonitorMemory(toolCtx, { topN: params.top_n })
    ),
    createSystemTool(
      ctx,
      "system_monitor_disk",
      "System Monitor Disk",
      "Report disk usage for a specific path or all mounted volumes.",
      Type.Object({
        path: Type.Optional(Type.String({
          minLength: 1,
          description: "Filesystem path or drive letter to inspect. Omit for all volumes."
        }))
      }),
      (toolCtx, params: { path?: string }) =>
        submitSystemMonitorDisk(toolCtx, { path: params.path })
    ),
    createSystemTool(
      ctx,
      "system_monitor_network",
      "System Monitor Network",
      "Report network interface statistics including bytes sent/received and interface addresses.",
      Type.Object({
        interface_name: Type.Optional(Type.String({
          minLength: 1,
          description: "Network interface name to inspect. Omit for all interfaces."
        }))
      }),
      (toolCtx, params: { interface_name?: string }) =>
        submitSystemMonitorNetwork(toolCtx, { interfaceName: params.interface_name })
    ),
    createSystemTool(
      ctx,
      "system_monitor_battery",
      "System Monitor Battery",
      "Report battery status, charge level, and estimated time remaining.",
      Type.Object({}),
      (toolCtx, _params: SystemMonitorBatteryParams) =>
        submitSystemMonitorBattery(toolCtx, {})
    ),
    createSystemTool(
      ctx,
      "system_list_processes",
      "System List Processes",
      "List running processes, optionally filtered and sorted by CPU, memory, or name.",
      Type.Object({
        sort_by: Type.Optional(sortBySchema),
        top_n: Type.Optional(Type.Integer({
          minimum: 1,
          maximum: 500,
          description: "Limit the number of processes returned."
        })),
        name_contains: Type.Optional(Type.String({
          minLength: 1,
          description: "Filter processes whose name contains this substring (case-insensitive)."
        }))
      }),
      (toolCtx, params: { sort_by?: "cpu" | "memory" | "name"; top_n?: number; name_contains?: string }) =>
        submitSystemListProcesses(toolCtx, {
          sortBy: params.sort_by,
          topN: params.top_n,
          nameContains: params.name_contains
        })
    ),
    createSystemTool(
      ctx,
      "system_kill_process",
      "System Kill Process",
      "Terminate a process by PID or name. Force-kills if requested.",
      Type.Object({
        pid: Type.Optional(Type.Integer({
          minimum: 1,
          description: "Process ID to terminate."
        })),
        name: Type.Optional(Type.String({
          minLength: 1,
          description: "Process name to terminate (terminates the first match)."
        })),
        force: Type.Optional(Type.Boolean({
          description: "If true, force-kill the process without waiting for graceful exit."
        }))
      }),
      (toolCtx, params: { pid?: number; name?: string; force?: boolean }) =>
        submitSystemKillProcess(toolCtx, {
          pid: params.pid,
          name: params.name,
          force: params.force
        })
    ),
    createSystemTool(
      ctx,
      "system_hardware_info",
      "System Hardware Info",
      "Report hardware information for selected components such as CPU, GPU, memory, disk, network, display, and battery.",
      Type.Object({
        components: Type.Optional(Type.Array(hardwareComponentSchema, {
          description: "Hardware components to include. Omit for all components."
        }))
      }),
      (toolCtx, params: { components?: string[] }) =>
        submitSystemHardwareInfo(toolCtx, { components: params.components as SystemHardwareInfoParams["components"] })
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

function missingJsonReply(commandName: string, usage: string) {
  return toCommandReply(`Usage: /${commandName} ${usage}`, true);
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createSystemCommand() {
  return {
    name: "system",
    description: "Monitor system resources (cpu, memory, disk, network, battery) with JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<SystemCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("system");
      }

      const toolCtx = toToolContext(ctx);

      switch (args.operation) {
        case "cpu": {
          const response = submitSystemMonitorCpu(toolCtx, {
            perCore: args.perCore
          });
          return toCommandReply(formatJobReply(response));
        }
        case "memory": {
          const response = submitSystemMonitorMemory(toolCtx, {
            topN: args.topN
          });
          return toCommandReply(formatJobReply(response));
        }
        case "disk": {
          const response = submitSystemMonitorDisk(toolCtx, {
            path: args.path
          });
          return toCommandReply(formatJobReply(response));
        }
        case "network": {
          const response = submitSystemMonitorNetwork(toolCtx, {
            interfaceName: args.interfaceName
          });
          return toCommandReply(formatJobReply(response));
        }
        case "battery": {
          const response = submitSystemMonitorBattery(toolCtx, {});
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /system operation: ${String((args as SystemCommandArgs).operation)}. Valid operations: cpu, memory, disk, network, battery.`,
            true
          );
      }
    }
  };
}

export function createProcessesCommand() {
  return {
    name: "processes",
    description: "List running processes with optional filtering and sorting.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<ProcessesCommandArgs>(ctx) ?? {};
      const toolCtx = toToolContext(ctx);
      const response = submitSystemListProcesses(toolCtx, {
        sortBy: args.sortBy,
        topN: args.topN,
        nameContains: args.nameContains
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export function createHardwareCommand() {
  return {
    name: "hardware",
    description: "Report hardware information for selected system components.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<HardwareCommandArgs>(ctx) ?? {};
      const toolCtx = toToolContext(ctx);
      const response = submitSystemHardwareInfo(toolCtx, {
        components: args.components as SystemHardwareInfoParams["components"]
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisSystemToolNames = [...SYSTEM_TOOL_NAMES];
export const jarvisSystemCommandNames = [...SYSTEM_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-system",
  name: "Jarvis System",
  description: "System monitoring and hardware information plugin for CPU, memory, disk, network, battery, and process management",
  register(api) {
    api.registerTool((ctx) => createSystemTools(ctx));
    api.registerCommand(createSystemCommand());
    api.registerCommand(createProcessesCommand());
    api.registerCommand(createHardwareCommand());
  }
});
