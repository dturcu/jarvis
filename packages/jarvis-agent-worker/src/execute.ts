import {
  CONTRACT_VERSION,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobType,
  type Metrics,
  type WorkerCallback
} from "@jarvis/shared";
import {
  AgentWorkerError,
  type AgentAdapter,
  type ExecutionOutcome
} from "./adapter.js";
import type {
  AgentStartInput,
  AgentStepInput,
  AgentStatusInput,
  AgentPauseInput,
  AgentResumeInput,
  AgentConfigureInput
} from "./types.js";

export const AGENT_WORKER_ID = "agent-worker";

export const AGENT_JOB_TYPES = [
  "agent.start",
  "agent.step",
  "agent.status",
  "agent.pause",
  "agent.resume",
  "agent.configure"
] as const;

export type AgentJobType = (typeof AGENT_JOB_TYPES)[number];

export type AgentWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type AgentWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
  toCallback(result: JobResult): WorkerCallback;
};

export function isAgentJobType(jobType: string): jobType is AgentJobType {
  return (AGENT_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createAgentWorker(config: {
  adapter: AgentAdapter;
  workerId?: string;
  now?: () => Date;
}): AgentWorker {
  const workerId = config.workerId ?? AGENT_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeAgentJob(envelope, config.adapter, { workerId, now: config.now }),
    toCallback: (result) => toWorkerCallback(result, workerId)
  };
}

export async function executeAgentJob(
  envelope: JobEnvelope,
  adapter: AgentAdapter,
  options: AgentWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? AGENT_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isAgentJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      {
        code: "INVALID_INPUT",
        message: `Agent worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: { supported_job_types: [...AGENT_JOB_TYPES] }
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
    const jobError = toJobError(error, envelope.type as unknown as JarvisJobType);
    return createFailureResult(
      envelope,
      jobError,
      workerId,
      startedAt,
      now().toISOString()
    );
  }
}

export function toWorkerCallback(
  result: JobResult,
  workerId = AGENT_WORKER_ID,
): WorkerCallback {
  return {
    contract_version: result.contract_version,
    job_id: result.job_id,
    job_type: result.job_type,
    attempt: result.attempt,
    status: result.status,
    summary: result.summary,
    worker_id: workerId,
    approval_id: result.approval_id,
    artifacts: result.artifacts,
    structured_output: result.structured_output,
    error: result.error,
    logs: result.logs,
    metrics: {
      ...result.metrics,
      worker_id: workerId
    }
  };
}

async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: AgentAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "agent.start":
        return await adapter.start(envelope.input as AgentStartInput);
      case "agent.step":
        return await adapter.step(envelope.input as AgentStepInput);
      case "agent.status":
        return await adapter.status(envelope.input as AgentStatusInput);
      case "agent.pause":
        return await adapter.pause(envelope.input as AgentPauseInput);
      case "agent.resume":
        return await adapter.resume(envelope.input as AgentResumeInput);
      case "agent.configure":
        return await adapter.configure(envelope.input as AgentConfigureInput);
      default:
        throw new AgentWorkerError(
          "EXECUTION_FAILED",
          `Unsupported agent job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof AgentWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new AgentWorkerError(
        "EXECUTION_FAILED",
        `Input validation failed for ${envelope.type}: ${(error as Error).message}`,
        false
      );
    }
    throw error;
  }
}

function createFailureResult(
  envelope: JobEnvelope,
  error: JobError,
  workerId: string,
  startedAt: string,
  finishedAt: string,
): JobResult {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: envelope.job_id,
    job_type: envelope.type,
    status: "failed",
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
  if (error instanceof AgentWorkerError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details
    };
  }

  if (error instanceof Error) {
    return {
      code: "EXECUTION_FAILED",
      message: error.message || `Unexpected failure while running ${jobType}.`,
      retryable: false
    };
  }

  return {
    code: "EXECUTION_FAILED",
    message: `Unexpected failure while running ${jobType}.`,
    retryable: false
  };
}
