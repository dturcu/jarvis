import type {
  InferenceBatchStatusInput,
  InferenceBatchStatusOutput,
  InferenceBatchSubmitInput,
  InferenceBatchSubmitOutput,
  InferenceChatInput,
  InferenceChatOutput,
  InferenceEmbedInput,
  InferenceEmbedOutput,
  InferenceListModelsInput,
  InferenceListModelsOutput,
  InferenceRagIndexInput,
  InferenceRagIndexOutput,
  InferenceRagQueryInput,
  InferenceRagQueryOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class InferenceWorkerError extends Error {
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
    this.name = "InferenceWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface InferenceAdapter {
  chat(input: InferenceChatInput): Promise<ExecutionOutcome<InferenceChatOutput>>;
  embed(input: InferenceEmbedInput): Promise<ExecutionOutcome<InferenceEmbedOutput>>;
  listModels(input: InferenceListModelsInput): Promise<ExecutionOutcome<InferenceListModelsOutput>>;
  ragIndex(input: InferenceRagIndexInput): Promise<ExecutionOutcome<InferenceRagIndexOutput>>;
  ragQuery(input: InferenceRagQueryInput): Promise<ExecutionOutcome<InferenceRagQueryOutput>>;
  batchSubmit(input: InferenceBatchSubmitInput): Promise<ExecutionOutcome<InferenceBatchSubmitOutput>>;
  batchStatus(input: InferenceBatchStatusInput): Promise<ExecutionOutcome<InferenceBatchStatusOutput>>;
}
