import type {
  EmailDraftInput,
  EmailDraftOutput,
  EmailLabelInput,
  EmailLabelOutput,
  EmailListThreadsInput,
  EmailListThreadsOutput,
  EmailReadInput,
  EmailReadOutput,
  EmailSearchInput,
  EmailSearchOutput,
  EmailSendInput,
  EmailSendOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class EmailWorkerError extends Error {
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
    this.name = "EmailWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface EmailAdapter {
  search(input: EmailSearchInput): Promise<ExecutionOutcome<EmailSearchOutput>>;
  read(input: EmailReadInput): Promise<ExecutionOutcome<EmailReadOutput>>;
  draft(input: EmailDraftInput): Promise<ExecutionOutcome<EmailDraftOutput>>;
  send(input: EmailSendInput): Promise<ExecutionOutcome<EmailSendOutput>>;
  label(input: EmailLabelInput): Promise<ExecutionOutcome<EmailLabelOutput>>;
  listThreads(input: EmailListThreadsInput): Promise<ExecutionOutcome<EmailListThreadsOutput>>;
}
