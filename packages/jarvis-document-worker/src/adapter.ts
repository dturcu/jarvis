import type {
  DocumentAnalyzeComplianceInput,
  DocumentAnalyzeComplianceOutput,
  DocumentCompareInput,
  DocumentCompareOutput,
  DocumentExtractClausesInput,
  DocumentExtractClausesOutput,
  DocumentGenerateReportInput,
  DocumentGenerateReportOutput,
  DocumentIngestInput,
  DocumentIngestOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class DocumentWorkerError extends Error {
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
    this.name = "DocumentWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface DocumentAdapter {
  ingest(input: DocumentIngestInput): Promise<ExecutionOutcome<DocumentIngestOutput>>;
  extractClauses(input: DocumentExtractClausesInput): Promise<ExecutionOutcome<DocumentExtractClausesOutput>>;
  analyzeCompliance(input: DocumentAnalyzeComplianceInput): Promise<ExecutionOutcome<DocumentAnalyzeComplianceOutput>>;
  compare(input: DocumentCompareInput): Promise<ExecutionOutcome<DocumentCompareOutput>>;
  generateReport(input: DocumentGenerateReportInput): Promise<ExecutionOutcome<DocumentGenerateReportOutput>>;
}
