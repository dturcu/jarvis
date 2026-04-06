import type {
  InterpreterRunCodeInput,
  InterpreterRunCodeOutput,
  InterpreterRunTaskInput,
  InterpreterRunTaskOutput,
  InterpreterStatusInput,
  InterpreterStatusOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class InterpreterWorkerError extends Error {
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
    this.name = "InterpreterWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface InterpreterAdapter {
  runTask(input: InterpreterRunTaskInput): Promise<ExecutionOutcome<InterpreterRunTaskOutput>>;
  runCode(input: InterpreterRunCodeInput): Promise<ExecutionOutcome<InterpreterRunCodeOutput>>;
  status(input: InterpreterStatusInput): Promise<ExecutionOutcome<InterpreterStatusOutput>>;
}
