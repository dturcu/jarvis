import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobStatus,
  type JarvisJobType,
  type Metrics,
} from "@jarvis/shared";
import {
  DriveWorkerError,
  type ExecutionOutcome,
  type DriveAdapter,
} from "./adapter.js";
import type {
  DriveListFilesInput,
  DriveDownloadFileInput,
  DriveWatchFolderInput,
  DriveSyncFolderInput,
} from "./types.js";

export const DRIVE_WORKER_ID = "drive-worker";

export const DRIVE_JOB_TYPES = [
  "drive.list_files",
  "drive.download_file",
  "drive.watch_folder",
  "drive.sync_folder",
] as const;

export type DriveJobType = (typeof DRIVE_JOB_TYPES)[number];

export type DriveWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type DriveWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isDriveJobType(jobType: string): jobType is DriveJobType {
  return (DRIVE_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createDriveWorker(
  config: {
    adapter: DriveAdapter;
    workerId?: string;
    now?: () => Date;
  },
): DriveWorker {
  const workerId = config.workerId ?? DRIVE_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeDriveJob(envelope, config.adapter, { workerId, now: config.now }),
  };
}

export async function executeDriveJob(
  envelope: JobEnvelope,
  adapter: DriveAdapter,
  options: DriveWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? DRIVE_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isDriveJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Drive worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: { supported_job_types: [...DRIVE_JOB_TYPES] },
      },
      workerId,
      startedAt,
      now().toISOString(),
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
      metrics: createMetrics(envelope.attempt, workerId, startedAt, now().toISOString()),
    };
  } catch (error) {
    const jobError = toJobError(error, envelope.type as JarvisJobType);
    const status: JarvisJobStatus = "failed";
    return createFailureResult(envelope, status, jobError, workerId, startedAt, now().toISOString());
  }
}

async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: DriveAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "drive.list_files":
        return await adapter.listFiles(envelope.input as DriveListFilesInput);
      case "drive.download_file":
        return await adapter.downloadFile(envelope.input as DriveDownloadFileInput);
      case "drive.watch_folder":
        return await adapter.watchFolder(envelope.input as DriveWatchFolderInput);
      case "drive.sync_folder":
        return await adapter.syncFolder(envelope.input as DriveSyncFolderInput);
      default:
        throw new DriveWorkerError(
          "INVALID_INPUT",
          `Unsupported drive job type: ${String(envelope.type)}.`,
        );
    }
  } catch (error) {
    if (error instanceof DriveWorkerError) throw error;
    if (error instanceof TypeError) {
      throw new DriveWorkerError(
        "INVALID_INPUT",
        `Input validation failed for ${envelope.type}: ${(error as Error).message}`,
        false,
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
    metrics: createMetrics(envelope.attempt, workerId, startedAt, finishedAt),
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
    worker_id: workerId,
  };
}

function toJobError(error: unknown, jobType: JarvisJobType): JobError {
  if (error instanceof DriveWorkerError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message || `Unexpected failure while running ${jobType}.`,
      retryable: false,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: `Unexpected failure while running ${jobType}.`,
    retryable: false,
  };
}
