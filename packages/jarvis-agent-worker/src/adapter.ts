import type {
  AgentStartInput,
  AgentStartOutput,
  AgentStepInput,
  AgentStepOutput,
  AgentStatusInput,
  AgentStatusOutput,
  AgentPauseInput,
  AgentPauseOutput,
  AgentResumeInput,
  AgentResumeOutput,
  AgentConfigureInput,
  AgentConfigureOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class AgentWorkerError extends Error {
  constructor(
    public readonly code: "AGENT_NOT_FOUND" | "AGENT_ALREADY_RUNNING" | "INVALID_TRIGGER" | "RUN_NOT_FOUND" | "INVALID_STATUS_TRANSITION" | "EXECUTION_FAILED",
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentWorkerError";
  }
}

export interface AgentAdapter {
  start(input: AgentStartInput): Promise<ExecutionOutcome<AgentStartOutput>>;
  step(input: AgentStepInput): Promise<ExecutionOutcome<AgentStepOutput>>;
  status(input: AgentStatusInput): Promise<ExecutionOutcome<AgentStatusOutput>>;
  pause(input: AgentPauseInput): Promise<ExecutionOutcome<AgentPauseOutput>>;
  resume(input: AgentResumeInput): Promise<ExecutionOutcome<AgentResumeOutput>>;
  configure(input: AgentConfigureInput): Promise<ExecutionOutcome<AgentConfigureOutput>>;
}
