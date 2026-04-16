import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  INFERENCE_COMMAND_NAMES,
  INFERENCE_TOOL_NAMES,
  getJarvisState,
  safeJsonParse,
  submitInferenceBatchStatus,
  submitInferenceBatchSubmit,
  submitInferenceChat,
  submitInferenceEmbed,
  submitInferenceListModels,
  submitInferenceRagIndex,
  submitInferenceRagQuery,
  toCommandReply,
  toToolResult,
  type InferenceBatchStatusParams,
  type InferenceBatchSubmitParams,
  type InferenceChatParams,
  type InferenceEmbedParams,
  type InferenceListModelsParams,
  type InferenceRagIndexParams,
  type InferenceRagQueryParams,
  type ToolResponse
} from "@jarvis/shared";

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const runtimeSchema = asLiteralUnion(["ollama", "lmstudio", "llamacpp", "all"] as const);

const messageSchema = Type.Object({
  role: asLiteralUnion(["system", "user", "assistant"] as const),
  content: Type.String({ minLength: 1 })
});

function createInferenceTool(
  ctx: OpenClawPluginToolContext,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  submit: (ctx: OpenClawPluginToolContext | undefined, params: any) => ToolResponse,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(submit(ctx, params))
  };
}

export function createInferenceTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createInferenceTool(
      ctx,
      "inference_chat",
      "Inference Chat",
      "Send a chat completion request to a local LLM runtime (Ollama, LM Studio, or llama.cpp) with intelligent profile-based routing.",
      Type.Object({
        messages: Type.Array(messageSchema, { minItems: 1 }),
        model: Type.Optional(Type.String({ minLength: 1 })),
        temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
        maxTokens: Type.Optional(Type.Integer({ minimum: 1 }))
      }),
      submitInferenceChat
    ),
    createInferenceTool(
      ctx,
      "inference_embed",
      "Inference Embed",
      "Generate vector embeddings for one or more texts using a local embedding model.",
      Type.Object({
        texts: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        model: Type.Optional(Type.String({ minLength: 1 }))
      }),
      submitInferenceEmbed
    ),
    createInferenceTool(
      ctx,
      "inference_list_models",
      "Inference List Models",
      "List all available models across local LLM runtimes.",
      Type.Object({
        runtime: Type.Optional(runtimeSchema)
      }),
      submitInferenceListModels
    ),
    createInferenceTool(
      ctx,
      "inference_rag_index",
      "Inference RAG Index",
      "Index documents from disk into a RAG collection using local embeddings.",
      Type.Object({
        paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        collection: Type.Optional(Type.String({ minLength: 1 }))
      }),
      submitInferenceRagIndex
    ),
    createInferenceTool(
      ctx,
      "inference_rag_query",
      "Inference RAG Query",
      "Query a RAG collection and retrieve the top-K most relevant chunks.",
      Type.Object({
        query: Type.String({ minLength: 1 }),
        collection: Type.Optional(Type.String({ minLength: 1 })),
        topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
      }),
      submitInferenceRagQuery
    ),
    createInferenceTool(
      ctx,
      "inference_batch_submit",
      "Inference Batch Submit",
      "Submit a batch of chat completion jobs for asynchronous execution.",
      Type.Object({
        jobs: Type.Array(
          Type.Object({
            messages: Type.Array(
              Type.Object({
                role: Type.String({ minLength: 1 }),
                content: Type.String({ minLength: 1 })
              }),
              { minItems: 1 }
            ),
            model: Type.Optional(Type.String({ minLength: 1 }))
          }),
          { minItems: 1 }
        )
      }),
      submitInferenceBatchSubmit
    ),
    createInferenceTool(
      ctx,
      "inference_batch_status",
      "Inference Batch Status",
      "Check the status of a previously submitted batch of inference jobs.",
      Type.Object({
        batchId: Type.String({ minLength: 1 })
      }),
      submitInferenceBatchStatus
    )
  ];
}

function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) {
    parts.push(`job=${response.job_id}`);
  }
  if (response.approval_id) {
    parts.push(`approval=${response.approval_id}`);
  }
  return parts.join(" | ");
}

function parseJsonArgs<T>(ctx: PluginCommandContext): T | null {
  return safeJsonParse<T>(ctx.args);
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

function missingJsonReply(commandName: string, usage: string) {
  return toCommandReply(`Usage: /${commandName} ${usage}`, true);
}

type InferenceCommandArgs = {
  operation: "chat" | "embed" | "list_models";
  messages?: InferenceChatParams["messages"];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  texts?: string[];
  runtime?: InferenceListModelsParams["runtime"];
};

type RagCommandArgs = {
  operation: "index" | "query";
  paths?: string[];
  collection?: string;
  query?: string;
  topK?: number;
};

export function createInferenceCommand() {
  return {
    name: "inference",
    description: "Submit an inference job (chat, embed, or list_models) from deterministic JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<InferenceCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("inference");
      }

      switch (args.operation) {
        case "chat": {
          if (!args.messages?.length) {
            return missingJsonReply(
              "inference",
              "{\"operation\":\"chat\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
            );
          }
          const response = submitInferenceChat(toToolContext(ctx), {
            messages: args.messages,
            model: args.model,
            temperature: args.temperature,
            maxTokens: args.maxTokens
          });
          return toCommandReply(formatJobReply(response));
        }
        case "embed": {
          if (!args.texts?.length) {
            return missingJsonReply(
              "inference",
              "{\"operation\":\"embed\",\"texts\":[\"Hello world\"]}"
            );
          }
          const response = submitInferenceEmbed(toToolContext(ctx), {
            texts: args.texts,
            model: args.model
          });
          return toCommandReply(formatJobReply(response));
        }
        case "list_models": {
          const response = submitInferenceListModels(toToolContext(ctx), {
            runtime: args.runtime
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /inference operation: ${String((args as { operation?: unknown }).operation)}`,
            true
          );
      }
    }
  };
}

export function createModelsCommand() {
  return {
    name: "models",
    description: "List available local LLM models with optional runtime filter.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<{ runtime?: InferenceListModelsParams["runtime"] }>(ctx) ?? {};
      const response = submitInferenceListModels(toToolContext(ctx), {
        runtime: args.runtime
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export function createRagCommand() {
  return {
    name: "rag",
    description: "Index documents or query a RAG collection from deterministic JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<RagCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("rag");
      }

      if (args.operation === "index") {
        if (!args.paths?.length) {
          return missingJsonReply(
            "rag",
            "{\"operation\":\"index\",\"paths\":[\"/path/to/doc.txt\"],\"collection\":\"my-docs\"}"
          );
        }
        const response = submitInferenceRagIndex(toToolContext(ctx), {
          paths: args.paths,
          collection: args.collection
        });
        return toCommandReply(formatJobReply(response));
      }

      if (args.operation === "query") {
        if (!args.query) {
          return missingJsonReply(
            "rag",
            "{\"operation\":\"query\",\"query\":\"What is the policy?\",\"collection\":\"my-docs\",\"topK\":5}"
          );
        }
        const response = submitInferenceRagQuery(toToolContext(ctx), {
          query: args.query,
          collection: args.collection,
          topK: args.topK
        });
        return toCommandReply(formatJobReply(response));
      }

      return toCommandReply(
        `Unsupported /rag operation: ${String((args as { operation?: unknown }).operation)}`,
        true
      );
    }
  };
}

export const jarvisInferenceToolNames = [...INFERENCE_TOOL_NAMES];
export const jarvisInferenceCommandNames = [...INFERENCE_COMMAND_NAMES];

// Re-export runtime, router, rag, streaming, and task-profile modules for worker consumption
export * from "./runtime.js";
export * from "./router.js";
export * from "./rag.js";
export * from "./streaming.js";
export * from "./task-profile.js";
export * from "./registry.js";
export * from "./benchmark.js";
export * from "./openclaw-adapter.js";
export * from "./governance.js";

export default definePluginEntry({
  id: "jarvis-inference",
  name: "Jarvis Inference",
  description: "Local LLM runtime integration with intelligent cost-optimized routing for Ollama and LM Studio",
  register(api) {
    api.registerTool((ctx) => createInferenceTools(ctx));
    api.registerCommand(createInferenceCommand());
    api.registerCommand(createModelsCommand());
    api.registerCommand(createRagCommand());
  }
});
