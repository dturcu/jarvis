// ── inference.chat ────────────────────────────────────────────────────────────

export type InferenceChatMessage = {
  role: string;
  content: string;
};

export type InferenceChatInput = {
  messages: InferenceChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
};

export type InferenceChatOutput = {
  content: string;
  model: string;
  runtime: "ollama" | "lmstudio" | "openclaw";
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// ── inference.vision_chat ─────────────────────────────────────────────────────

export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type InferenceVisionChatMessage = {
  role: string;
  content: string | VisionContentPart[];
};

export type InferenceVisionChatInput = {
  messages: InferenceVisionChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
};

export type InferenceVisionChatOutput = InferenceChatOutput;

// ── inference.embed ───────────────────────────────────────────────────────────

export type InferenceEmbedInput = {
  texts: string[];
  model?: string;
};

export type InferenceEmbedOutput = {
  embeddings: number[][];
  model: string;
  runtime: "ollama" | "lmstudio" | "openclaw";
  dimensions: number;
};

// ── inference.list_models ─────────────────────────────────────────────────────

export type InferenceListModelsInput = {
  runtime?: "ollama" | "lmstudio" | "openclaw" | "all";
};

export type InferenceModelEntry = {
  id: string;
  runtime: "ollama" | "lmstudio" | "openclaw";
  size_class: "small" | "medium" | "large";
  capabilities: string[];
};

export type InferenceListModelsOutput = {
  models: InferenceModelEntry[];
  runtimes_available: Array<"ollama" | "lmstudio" | "openclaw">;
  total_count: number;
};

// ── inference.rag_index ───────────────────────────────────────────────────────

export type InferenceRagIndexInput = {
  paths: string[];
  collection: string;
};

export type InferenceRagIndexOutput = {
  collection: string;
  document_count: number;
  chunk_count: number;
  last_indexed_at: string;
};

// ── inference.rag_query ───────────────────────────────────────────────────────

export type InferenceRagQueryInput = {
  query: string;
  collection: string;
  top_k: number;
};

export type InferenceRagResult = {
  text: string;
  score: number;
  source: string;
};

export type InferenceRagQueryOutput = {
  results: InferenceRagResult[];
  collection: string;
  query: string;
  returned_count: number;
};

// ── inference.batch_submit ────────────────────────────────────────────────────

export type InferenceBatchJobInput = {
  messages: Array<{ role: string; content: string }>;
  model?: string;
};

export type InferenceBatchSubmitInput = {
  jobs: InferenceBatchJobInput[];
};

export type InferenceBatchSubmitOutput = {
  batch_id: string;
  job_count: number;
  status: "accepted" | "queued";
  submitted_at: string;
};

// ── inference.batch_status ────────────────────────────────────────────────────

export type InferenceBatchStatusInput = {
  batch_id: string;
};

export type InferenceBatchJobStatus = {
  index: number;
  status: "pending" | "running" | "completed" | "failed";
  content?: string;
  error?: string;
};

export type InferenceBatchStatusOutput = {
  batch_id: string;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  pending_jobs: number;
  overall_status: "pending" | "running" | "completed" | "partial_failure" | "failed";
  jobs: InferenceBatchJobStatus[];
};
