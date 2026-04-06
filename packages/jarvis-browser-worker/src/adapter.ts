import type {
  BrowserNavigateInput,
  BrowserNavigateOutput,
  BrowserClickInput,
  BrowserClickOutput,
  BrowserTypeInput,
  BrowserTypeOutput,
  BrowserEvaluateInput,
  BrowserEvaluateOutput,
  BrowserWaitForInput,
  BrowserWaitForOutput,
  BrowserScreenshotInput,
  BrowserScreenshotOutput,
  BrowserExtractInput,
  BrowserExtractOutput,
  BrowserRunTaskInput,
  BrowserRunTaskOutput,
  BrowserDownloadInput,
  BrowserDownloadOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class BrowserWorkerError extends Error {
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
    this.name = "BrowserWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface BrowserAdapter {
  navigate(input: BrowserNavigateInput): Promise<ExecutionOutcome<BrowserNavigateOutput>>;
  click(input: BrowserClickInput): Promise<ExecutionOutcome<BrowserClickOutput>>;
  type(input: BrowserTypeInput): Promise<ExecutionOutcome<BrowserTypeOutput>>;
  evaluate(input: BrowserEvaluateInput): Promise<ExecutionOutcome<BrowserEvaluateOutput>>;
  waitFor(input: BrowserWaitForInput): Promise<ExecutionOutcome<BrowserWaitForOutput>>;
  screenshot(input: BrowserScreenshotInput): Promise<ExecutionOutcome<BrowserScreenshotOutput>>;
  extract(input: BrowserExtractInput): Promise<ExecutionOutcome<BrowserExtractOutput>>;
  runTask(input: BrowserRunTaskInput): Promise<ExecutionOutcome<BrowserRunTaskOutput>>;
  download(input: BrowserDownloadInput): Promise<ExecutionOutcome<BrowserDownloadOutput>>;
}
