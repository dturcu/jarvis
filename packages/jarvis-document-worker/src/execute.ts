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
  DocumentWorkerError,
  type ExecutionOutcome,
  type DocumentAdapter
} from "./adapter.js";
import type {
  DocumentIngestInput,
  DocumentExtractClausesInput,
  DocumentAnalyzeComplianceInput,
  DocumentCompareInput,
  DocumentGenerateReportInput
} from "./types.js";

export const DOCUMENT_WORKER_ID = "document-worker";

export const DOCUMENT_JOB_TYPES = [
  "document.ingest",
  "document.extract_clauses",
  "document.analyze_compliance",
  "document.compare",
  "document.generate_report"
] as const;

export type DocumentJobType = (typeof DOCUMENT_JOB_TYPES)[number];

export type DocumentWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type DocumentWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isDocumentJobType(jobType: string): jobType is DocumentJobType {
  return (DOCUMENT_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createDocumentWorker(
  config: {
    adapter: DocumentAdapter;
    workerId?: string;
    now?: () => Date;
  },
): DocumentWorker {
  const workerId = config.workerId ?? DOCUMENT_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeDocumentJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeDocumentJob(
  envelope: JobEnvelope,
  adapter: DocumentAdapter,
  options: DocumentWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? DOCUMENT_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isDocumentJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Document worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...DOCUMENT_JOB_TYPES]
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
  adapter: DocumentAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "document.ingest":
        return await adapter.ingest(envelope.input as DocumentIngestInput);
      case "document.extract_clauses":
        return await adapter.extractClauses(envelope.input as DocumentExtractClausesInput);
      case "document.analyze_compliance":
        return await adapter.analyzeCompliance(envelope.input as DocumentAnalyzeComplianceInput);
      case "document.compare":
        return await adapter.compare(envelope.input as DocumentCompareInput);
      case "document.generate_report":
        return await adapter.generateReport(envelope.input as DocumentGenerateReportInput);
      default:
        throw new DocumentWorkerError(
          "INVALID_INPUT",
          `Unsupported document job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof DocumentWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new DocumentWorkerError(
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
  if (error instanceof DocumentWorkerError) {
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
