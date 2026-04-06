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
  VoiceWorkerError,
  type VoiceAdapter,
  type VoiceExecutionOutcome
} from "./adapter.js";
import type {
  VoiceListenInput,
  VoiceTranscribeInput,
  VoiceSpeakInput,
  VoiceWakeWordStartInput,
  VoiceWakeWordStopInput
} from "./types.js";

export const VOICE_WORKER_ID = "voice-worker";

export const VOICE_JOB_TYPES = [
  "voice.listen",
  "voice.transcribe",
  "voice.speak",
  "voice.wake_word_start",
  "voice.wake_word_stop"
] as const;

export type VoiceJobType = (typeof VOICE_JOB_TYPES)[number];

export type VoiceWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type VoiceWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isVoiceJobType(jobType: string): jobType is VoiceJobType {
  return (VOICE_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createVoiceWorker(config: {
  adapter: VoiceAdapter;
  workerId?: string;
  now?: () => Date;
}): VoiceWorker {
  const workerId = config.workerId ?? VOICE_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeVoiceJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeVoiceJob(
  envelope: JobEnvelope,
  adapter: VoiceAdapter,
  options: VoiceWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? VOICE_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isVoiceJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Voice worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...VOICE_JOB_TYPES]
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
  adapter: VoiceAdapter,
): Promise<VoiceExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "voice.listen":
        return await adapter.listen(envelope.input as VoiceListenInput);
      case "voice.transcribe":
        return await adapter.transcribe(envelope.input as VoiceTranscribeInput);
      case "voice.speak":
        return await adapter.speak(envelope.input as VoiceSpeakInput);
      case "voice.wake_word_start":
        return await adapter.wakeWordStart(envelope.input as VoiceWakeWordStartInput);
      case "voice.wake_word_stop":
        return await adapter.wakeWordStop(envelope.input as VoiceWakeWordStopInput);
      default:
        throw new VoiceWorkerError(
          "INVALID_INPUT",
          `Unsupported voice job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof VoiceWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new VoiceWorkerError(
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
  if (error instanceof VoiceWorkerError) {
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
