import type {
  SystemHardwareInfoInput,
  SystemHardwareInfoOutput,
  SystemKillProcessInput,
  SystemKillProcessOutput,
  SystemListProcessesInput,
  SystemListProcessesOutput,
  SystemMonitorBatteryOutput,
  SystemMonitorCpuInput,
  SystemMonitorCpuOutput,
  SystemMonitorDiskInput,
  SystemMonitorDiskOutput,
  SystemMonitorMemoryInput,
  SystemMonitorMemoryOutput,
  SystemMonitorNetworkInput,
  SystemMonitorNetworkOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class SystemWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SystemWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface SystemAdapter {
  monitorCpu(input: SystemMonitorCpuInput): Promise<ExecutionOutcome<SystemMonitorCpuOutput>>;
  monitorMemory(input: SystemMonitorMemoryInput): Promise<ExecutionOutcome<SystemMonitorMemoryOutput>>;
  monitorDisk(input: SystemMonitorDiskInput): Promise<ExecutionOutcome<SystemMonitorDiskOutput>>;
  monitorNetwork(input: SystemMonitorNetworkInput): Promise<ExecutionOutcome<SystemMonitorNetworkOutput>>;
  monitorBattery(): Promise<ExecutionOutcome<SystemMonitorBatteryOutput>>;
  listProcesses(input: SystemListProcessesInput): Promise<ExecutionOutcome<SystemListProcessesOutput>>;
  killProcess(input: SystemKillProcessInput): Promise<ExecutionOutcome<SystemKillProcessOutput>>;
  hardwareInfo(input: SystemHardwareInfoInput): Promise<ExecutionOutcome<SystemHardwareInfoOutput>>;
}
