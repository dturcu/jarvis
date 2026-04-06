import type {
  CalendarListEventsInput,
  CalendarListEventsOutput,
  CalendarCreateEventInput,
  CalendarCreateEventOutput,
  CalendarUpdateEventInput,
  CalendarUpdateEventOutput,
  CalendarFindFreeInput,
  CalendarFindFreeOutput,
  CalendarBriefInput,
  CalendarBriefOutput
} from "./types.js";

export type CalendarExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class CalendarWorkerError extends Error {
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
    this.name = "CalendarWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface CalendarAdapter {
  listEvents(input: CalendarListEventsInput): Promise<CalendarExecutionOutcome<CalendarListEventsOutput>>;
  createEvent(input: CalendarCreateEventInput): Promise<CalendarExecutionOutcome<CalendarCreateEventOutput>>;
  updateEvent(input: CalendarUpdateEventInput): Promise<CalendarExecutionOutcome<CalendarUpdateEventOutput>>;
  findFree(input: CalendarFindFreeInput): Promise<CalendarExecutionOutcome<CalendarFindFreeOutput>>;
  brief(input: CalendarBriefInput): Promise<CalendarExecutionOutcome<CalendarBriefOutput>>;
}
