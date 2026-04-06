import type {
  WebCompetitiveIntelInput,
  WebCompetitiveIntelOutput,
  WebEnrichContactInput,
  WebEnrichContactOutput,
  WebMonitorPageInput,
  WebMonitorPageOutput,
  WebScrapeProfileInput,
  WebScrapeProfileOutput,
  WebSearchNewsInput,
  WebSearchNewsOutput,
  WebTrackJobsInput,
  WebTrackJobsOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class WebWorkerError extends Error {
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
    this.name = "WebWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface WebAdapter {
  searchNews(input: WebSearchNewsInput): Promise<ExecutionOutcome<WebSearchNewsOutput>>;
  scrapeProfile(input: WebScrapeProfileInput): Promise<ExecutionOutcome<WebScrapeProfileOutput>>;
  monitorPage(input: WebMonitorPageInput): Promise<ExecutionOutcome<WebMonitorPageOutput>>;
  enrichContact(input: WebEnrichContactInput): Promise<ExecutionOutcome<WebEnrichContactOutput>>;
  trackJobs(input: WebTrackJobsInput): Promise<ExecutionOutcome<WebTrackJobsOutput>>;
  competitiveIntel(input: WebCompetitiveIntelInput): Promise<ExecutionOutcome<WebCompetitiveIntelOutput>>;
}
