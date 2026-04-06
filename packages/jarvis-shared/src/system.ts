import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type SystemMonitorCpuParams = {
  perCore?: boolean;
};

export type SystemMonitorMemoryParams = {
  topN?: number;
};

export type SystemMonitorDiskParams = {
  path?: string;
};

export type SystemMonitorNetworkParams = {
  interfaceName?: string;
};

export type SystemMonitorBatteryParams = Record<string, never>;

export type SystemListProcessesParams = {
  sortBy?: "cpu" | "memory" | "name";
  topN?: number;
  nameContains?: string;
};

export type SystemKillProcessParams = {
  pid?: number;
  name?: string;
  force?: boolean;
};

export type SystemHardwareInfoParams = {
  components?: Array<"cpu" | "gpu" | "memory" | "disk" | "network" | "display" | "battery">;
};

export function submitSystemMonitorCpu(
  ctx: OpenClawPluginToolContext | undefined,
  params: SystemMonitorCpuParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "system.monitor_cpu",
    input: {
      per_core: params.perCore ?? false
    }
  });
}

export function submitSystemMonitorMemory(
  ctx: OpenClawPluginToolContext | undefined,
  params: SystemMonitorMemoryParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "system.monitor_memory",
    input: {
      top_n: params.topN
    }
  });
}

export function submitSystemMonitorDisk(
  ctx: OpenClawPluginToolContext | undefined,
  params: SystemMonitorDiskParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "system.monitor_disk",
    input: {
      path: params.path
    }
  });
}

export function submitSystemMonitorNetwork(
  ctx: OpenClawPluginToolContext | undefined,
  params: SystemMonitorNetworkParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "system.monitor_network",
    input: {
      interface_name: params.interfaceName
    }
  });
}

export function submitSystemMonitorBattery(
  ctx: OpenClawPluginToolContext | undefined,
  params: SystemMonitorBatteryParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "system.monitor_battery",
    input: {}
  });
}

export function submitSystemListProcesses(
  ctx: OpenClawPluginToolContext | undefined,
  params: SystemListProcessesParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "system.list_processes",
    input: {
      sort_by: params.sortBy ?? "cpu",
      top_n: params.topN,
      name_contains: params.nameContains
    }
  });
}

export function submitSystemKillProcess(
  ctx: OpenClawPluginToolContext | undefined,
  params: SystemKillProcessParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "system.kill_process",
    input: {
      pid: params.pid,
      name: params.name,
      force: params.force ?? false
    }
  });
}

export function submitSystemHardwareInfo(
  ctx: OpenClawPluginToolContext | undefined,
  params: SystemHardwareInfoParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "system.hardware_info",
    input: {
      components: params.components
    }
  });
}
