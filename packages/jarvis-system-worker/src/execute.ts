import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobStatus,
  type JarvisJobType,
  type Metrics
} from "@jarvis/shared";
import {
  SystemWorkerError,
  type ExecutionOutcome,
  type SystemAdapter
} from "./adapter.js";
import type {
  SystemHardwareInfoInput,
  SystemKillProcessInput,
  SystemListProcessesInput,
  SystemMonitorCpuInput,
  SystemMonitorDiskInput,
  SystemMonitorMemoryInput,
  SystemMonitorNetworkInput
} from "./types.js";

export const SYSTEM_WORKER_ID = "system-worker";

export const SYSTEM_JOB_TYPES = [
  "system.monitor_cpu",
  "system.monitor_memory",
  "system.monitor_disk",
  "system.monitor_network",
  "system.monitor_battery",
  "system.list_processes",
  "system.kill_process",
  "system.hardware_info"
] as const;

export type SystemJobType = (typeof SYSTEM_JOB_TYPES)[number];

export type SystemWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type SystemWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isSystemJobType(jobType: string): jobType is SystemJobType {
  return (SYSTEM_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createSystemWorker(
  config: {
    adapter: SystemAdapter;
    workerId?: string;
    now?: () => Date;
  },
): SystemWorker {
  const workerId = config.workerId ?? SYSTEM_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeSystemJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeSystemJob(
  envelope: JobEnvelope,
  adapter: SystemAdapter,
  options: SystemWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? SYSTEM_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isSystemJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `System worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...SYSTEM_JOB_TYPES]
        }
      },
      workerId,
      startedAt,
      now().toISOString()
    );
  }

  try {
    const outcome = await routeEnvelope(envelope, adapter);
    return {
      contract_version: CONTRACT_VERSION,
      job_id: envelope.job_id,
      job_type: envelope.type,
      status: "completed",
      summary: outcome.summary,
      attempt: envelope.attempt,
      structured_output: outcome.structured_output as Record<string, unknown>,
      metrics: createMetrics(envelope.attempt, workerId, startedAt, now().toISOString())
    };
  } catch (error) {
    const jobError = toJobError(error, envelope.type);
    const status: JarvisJobStatus = "failed";
    return createFailureResult(
      envelope,
      status,
      jobError,
      workerId,
      startedAt,
      now().toISOString()
    );
  }
}

async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: SystemAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "system.monitor_cpu":
        return await adapter.monitorCpu(envelope.input as SystemMonitorCpuInput);
      case "system.monitor_memory":
        return await adapter.monitorMemory(envelope.input as SystemMonitorMemoryInput);
      case "system.monitor_disk":
        return await adapter.monitorDisk(envelope.input as SystemMonitorDiskInput);
      case "system.monitor_network":
        return await adapter.monitorNetwork(envelope.input as SystemMonitorNetworkInput);
      case "system.monitor_battery":
        return await adapter.monitorBattery();
      case "system.list_processes":
        return await adapter.listProcesses(envelope.input as SystemListProcessesInput);
      case "system.kill_process":
        return await adapter.killProcess(envelope.input as SystemKillProcessInput);
      case "system.hardware_info":
        return await adapter.hardwareInfo(envelope.input as SystemHardwareInfoInput);
      default:
        throw new SystemWorkerError(
          "INVALID_INPUT",
          `Unsupported system job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof SystemWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new SystemWorkerError(
        "INVALID_INPUT",
        `Input validation failed for ${envelope.type}: ${(error as Error).message}`,
        false
      );
    }
    throw error;
  }
}

function createFailureResult(
  envelope: JobEnvelope,
  status: JarvisJobStatus,
  error: JobError,
  workerId: string,
  startedAt: string,
  finishedAt: string,
): JobResult {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: envelope.job_id,
    job_type: envelope.type,
    status,
    summary: `Failed to run ${envelope.type}.`,
    attempt: envelope.attempt,
    error,
    metrics: createMetrics(envelope.attempt, workerId, startedAt, finishedAt)
  };
}

function createMetrics(
  attempt: number,
  workerId: string,
  startedAt: string,
  finishedAt: string,
): Metrics {
  return {
    started_at: startedAt,
    finished_at: finishedAt,
    attempt,
    worker_id: workerId
  };
}

function toJobError(error: unknown, jobType: JarvisJobType): JobError {
  if (error instanceof SystemWorkerError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message || `Unexpected failure while running ${jobType}.`,
      retryable: false
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: `Unexpected failure while running ${jobType}.`,
    retryable: false
  };
}
