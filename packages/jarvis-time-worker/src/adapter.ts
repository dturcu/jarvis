import type {
  TimeListEntriesInput,
  TimeListEntriesOutput,
  TimeCreateEntryInput,
  TimeCreateEntryOutput,
  TimeSummaryInput,
  TimeSummaryOutput,
  TimeSyncInput,
  TimeSyncOutput,
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class TimeWorkerError extends Error {
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
    this.name = "TimeWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface TimeAdapter {
  listEntries(input: TimeListEntriesInput): Promise<ExecutionOutcome<TimeListEntriesOutput>>;
  createEntry(input: TimeCreateEntryInput): Promise<ExecutionOutcome<TimeCreateEntryOutput>>;
  summary(input: TimeSummaryInput): Promise<ExecutionOutcome<TimeSummaryOutput>>;
  sync(input: TimeSyncInput): Promise<ExecutionOutcome<TimeSyncOutput>>;
}
