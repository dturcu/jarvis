import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type InferenceChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type InferenceChatParams = {
  messages: InferenceChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type InferenceEmbedParams = {
  texts: string[];
  model?: string;
};

export type InferenceListModelsParams = {
  runtime?: "ollama" | "lmstudio" | "llamacpp" | "all";
};

export type InferenceRagIndexParams = {
  paths: string[];
  collection?: string;
};

export type InferenceRagQueryParams = {
  query: string;
  collection?: string;
  topK?: number;
};

export type InferenceBatchJob = {
  messages: Array<{ role: string; content: string }>;
  model?: string;
};

export type InferenceBatchSubmitParams = {
  jobs: InferenceBatchJob[];
};

export type InferenceBatchStatusParams = {
  batchId: string;
};

export function submitInferenceChat(
  ctx: OpenClawPluginToolContext | undefined,
  params: InferenceChatParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "inference.chat",
    input: {
      messages: params.messages,
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens
    }
  });
}

export function submitInferenceEmbed(
  ctx: OpenClawPluginToolContext | undefined,
  params: InferenceEmbedParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "inference.embed",
    input: {
      texts: params.texts,
      model: params.model
    }
  });
}

export function submitInferenceListModels(
  ctx: OpenClawPluginToolContext | undefined,
  params: InferenceListModelsParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "inference.list_models",
    input: {
      runtime: params.runtime ?? "all"
    }
  });
}

export function submitInferenceRagIndex(
  ctx: OpenClawPluginToolContext | undefined,
  params: InferenceRagIndexParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "inference.rag_index",
    input: {
      paths: params.paths,
      collection: params.collection ?? "default"
    }
  });
}

export function submitInferenceRagQuery(
  ctx: OpenClawPluginToolContext | undefined,
  params: InferenceRagQueryParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "inference.rag_query",
    input: {
      query: params.query,
      collection: params.collection ?? "default",
      top_k: params.topK ?? 5
    }
  });
}

export function submitInferenceBatchSubmit(
  ctx: OpenClawPluginToolContext | undefined,
  params: InferenceBatchSubmitParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "inference.batch_submit",
    input: {
      jobs: params.jobs
    }
  });
}

export function submitInferenceBatchStatus(
  ctx: OpenClawPluginToolContext | undefined,
  params: InferenceBatchStatusParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "inference.batch_status",
    input: {
      batch_id: params.batchId
    }
  });
}
