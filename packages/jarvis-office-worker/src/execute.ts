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
  OfficeWorkerError,
  type ExecutionOutcome,
  type OfficeAdapter
} from "./adapter.js";
import type {
  OfficeInspectInput,
  OfficeMergeExcelInput,
  OfficeTransformExcelInput,
  OfficeFillDocxInput,
  OfficeBuildPptxInput,
  OfficeExtractTablesInput,
  OfficePreviewInput
} from "./types.js";

export const OFFICE_WORKER_ID = "office-worker";

export const OFFICE_JOB_TYPES = [
  "office.inspect",
  "office.merge_excel",
  "office.transform_excel",
  "office.fill_docx",
  "office.build_pptx",
  "office.extract_tables",
  "office.preview"
] as const;

export type OfficeJobType = (typeof OFFICE_JOB_TYPES)[number];

export type OfficeWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type OfficeWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isOfficeJobType(jobType: string): jobType is OfficeJobType {
  return (OFFICE_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createOfficeWorker(config: {
  adapter: OfficeAdapter;
  workerId?: string;
  now?: () => Date;
}): OfficeWorker {
  const workerId = config.workerId ?? OFFICE_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeOfficeJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeOfficeJob(
  envelope: JobEnvelope,
  adapter: OfficeAdapter,
  options: OfficeWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? OFFICE_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isOfficeJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Office worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...OFFICE_JOB_TYPES]
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

export async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: OfficeAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "office.inspect":
        return await adapter.inspect(envelope.input as OfficeInspectInput);
      case "office.merge_excel":
        return await adapter.mergeExcel(envelope.input as OfficeMergeExcelInput);
      case "office.transform_excel":
        return await adapter.transformExcel(envelope.input as OfficeTransformExcelInput);
      case "office.fill_docx":
        return await adapter.fillDocx(envelope.input as OfficeFillDocxInput);
      case "office.build_pptx":
        return await adapter.buildPptx(envelope.input as OfficeBuildPptxInput);
      case "office.extract_tables":
        return await adapter.extractTables(envelope.input as OfficeExtractTablesInput);
      case "office.preview":
        return await adapter.preview(envelope.input as OfficePreviewInput);
      default:
        throw new OfficeWorkerError(
          "INVALID_INPUT",
          `Unsupported office job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof OfficeWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new OfficeWorkerError(
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
  if (error instanceof OfficeWorkerError) {
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
