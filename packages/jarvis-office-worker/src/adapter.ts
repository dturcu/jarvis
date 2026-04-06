import type {
  OfficeInspectInput,
  OfficeInspectOutput,
  OfficeMergeExcelInput,
  OfficeMergeExcelOutput,
  OfficeTransformExcelInput,
  OfficeTransformExcelOutput,
  OfficeFillDocxInput,
  OfficeFillDocxOutput,
  OfficeBuildPptxInput,
  OfficeBuildPptxOutput,
  OfficeExtractTablesInput,
  OfficeExtractTablesOutput,
  OfficePreviewInput,
  OfficePreviewOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class OfficeWorkerError extends Error {
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
    this.name = "OfficeWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface OfficeAdapter {
  inspect(input: OfficeInspectInput): Promise<ExecutionOutcome<OfficeInspectOutput>>;
  mergeExcel(input: OfficeMergeExcelInput): Promise<ExecutionOutcome<OfficeMergeExcelOutput>>;
  transformExcel(input: OfficeTransformExcelInput): Promise<ExecutionOutcome<OfficeTransformExcelOutput>>;
  fillDocx(input: OfficeFillDocxInput): Promise<ExecutionOutcome<OfficeFillDocxOutput>>;
  buildPptx(input: OfficeBuildPptxInput): Promise<ExecutionOutcome<OfficeBuildPptxOutput>>;
  extractTables(input: OfficeExtractTablesInput): Promise<ExecutionOutcome<OfficeExtractTablesOutput>>;
  preview(input: OfficePreviewInput): Promise<ExecutionOutcome<OfficePreviewOutput>>;
}
