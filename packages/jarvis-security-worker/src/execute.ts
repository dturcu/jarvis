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
  SecurityWorkerError,
  type ExecutionOutcome,
  type SecurityAdapter
} from "./adapter.js";
import type {
  SecurityScanProcessesInput,
  SecurityWhitelistUpdateInput,
  SecurityNetworkAuditInput,
  SecurityFileIntegrityCheckInput,
  SecurityFileIntegrityBaselineInput,
  SecurityFirewallRuleInput,
  SecurityLockdownInput
} from "./types.js";

export const SECURITY_WORKER_ID = "security-worker";

export const SECURITY_JOB_TYPES = [
  "security.scan_processes",
  "security.whitelist_update",
  "security.network_audit",
  "security.file_integrity_check",
  "security.file_integrity_baseline",
  "security.firewall_rule",
  "security.lockdown"
] as const;

export type SecurityJobType = (typeof SECURITY_JOB_TYPES)[number];

export type SecurityWorkerOptions = {
  workerId?: string;
  now?: () => Date;
};

export type SecurityWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
};

export function isSecurityJobType(jobType: string): jobType is SecurityJobType {
  return (SECURITY_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createSecurityWorker(
  config: {
    adapter: SecurityAdapter;
    workerId?: string;
    now?: () => Date;
  },
): SecurityWorker {
  const workerId = config.workerId ?? SECURITY_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeSecurityJob(envelope, config.adapter, { workerId, now: config.now })
  };
}

export async function executeSecurityJob(
  envelope: JobEnvelope,
  adapter: SecurityAdapter,
  options: SecurityWorkerOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? SECURITY_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isSecurityJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Security worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...SECURITY_JOB_TYPES]
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
    const jobError = toJobError(error, envelope.type as JarvisJobType);
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
  adapter: SecurityAdapter,
): Promise<ExecutionOutcome<unknown>> {
  try {
    switch (envelope.type) {
      case "security.scan_processes":
        return await adapter.scanProcesses(envelope.input as SecurityScanProcessesInput);
      case "security.whitelist_update":
        return await adapter.whitelistUpdate(envelope.input as SecurityWhitelistUpdateInput);
      case "security.network_audit":
        return await adapter.networkAudit(envelope.input as SecurityNetworkAuditInput);
      case "security.file_integrity_check":
        return await adapter.fileIntegrityCheck(envelope.input as SecurityFileIntegrityCheckInput);
      case "security.file_integrity_baseline":
        return await adapter.fileIntegrityBaseline(envelope.input as SecurityFileIntegrityBaselineInput);
      case "security.firewall_rule":
        return await adapter.firewallRule(envelope.input as SecurityFirewallRuleInput);
      case "security.lockdown":
        return await adapter.lockdown(envelope.input as SecurityLockdownInput);
      default:
        throw new SecurityWorkerError(
          "INVALID_INPUT",
          `Unsupported security job type: ${String(envelope.type)}.`
        );
    }
  } catch (error) {
    if (error instanceof SecurityWorkerError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new SecurityWorkerError(
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
  if (error instanceof SecurityWorkerError) {
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
