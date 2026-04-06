import type {
  CrmAddContactInput,
  CrmAddContactOutput,
  CrmAddNoteInput,
  CrmAddNoteOutput,
  CrmDigestInput,
  CrmDigestOutput,
  CrmListPipelineInput,
  CrmListPipelineOutput,
  CrmMoveStageInput,
  CrmMoveStageOutput,
  CrmSearchInput,
  CrmSearchOutput,
  CrmUpdateContactInput,
  CrmUpdateContactOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class CrmWorkerError extends Error {
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
    this.name = "CrmWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface CrmAdapter {
  addContact(input: CrmAddContactInput): Promise<ExecutionOutcome<CrmAddContactOutput>>;
  updateContact(input: CrmUpdateContactInput): Promise<ExecutionOutcome<CrmUpdateContactOutput>>;
  listPipeline(input: CrmListPipelineInput): Promise<ExecutionOutcome<CrmListPipelineOutput>>;
  moveStage(input: CrmMoveStageInput): Promise<ExecutionOutcome<CrmMoveStageOutput>>;
  addNote(input: CrmAddNoteInput): Promise<ExecutionOutcome<CrmAddNoteOutput>>;
  search(input: CrmSearchInput): Promise<ExecutionOutcome<CrmSearchOutput>>;
  digest(input: CrmDigestInput): Promise<ExecutionOutcome<CrmDigestOutput>>;
}
