import type {
  SecurityScanProcessesInput,
  SecurityScanProcessesOutput,
  SecurityWhitelistUpdateInput,
  SecurityWhitelistUpdateOutput,
  SecurityNetworkAuditInput,
  SecurityNetworkAuditOutput,
  SecurityFileIntegrityCheckInput,
  SecurityFileIntegrityCheckOutput,
  SecurityFileIntegrityBaselineInput,
  SecurityFileIntegrityBaselineOutput,
  SecurityFirewallRuleInput,
  SecurityFirewallRuleOutput,
  SecurityLockdownInput,
  SecurityLockdownOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class SecurityWorkerError extends Error {
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
    this.name = "SecurityWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface SecurityAdapter {
  scanProcesses(input: SecurityScanProcessesInput): Promise<ExecutionOutcome<SecurityScanProcessesOutput>>;
  whitelistUpdate(input: SecurityWhitelistUpdateInput): Promise<ExecutionOutcome<SecurityWhitelistUpdateOutput>>;
  networkAudit(input: SecurityNetworkAuditInput): Promise<ExecutionOutcome<SecurityNetworkAuditOutput>>;
  fileIntegrityCheck(input: SecurityFileIntegrityCheckInput): Promise<ExecutionOutcome<SecurityFileIntegrityCheckOutput>>;
  fileIntegrityBaseline(input: SecurityFileIntegrityBaselineInput): Promise<ExecutionOutcome<SecurityFileIntegrityBaselineOutput>>;
  firewallRule(input: SecurityFirewallRuleInput): Promise<ExecutionOutcome<SecurityFirewallRuleOutput>>;
  lockdown(input: SecurityLockdownInput): Promise<ExecutionOutcome<SecurityLockdownOutput>>;
}
