import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  chatCompletion,
  detectRuntimes,
  embedTexts,
  listModels,
  buildModelInfo,
  classifyModelSize,
  inferCapabilities,
  selectEmbeddingModel,
  selectModel,
  selectByProfileWithEvidence,
  loadAllBenchmarks,
  loadRegisteredModels,
  indexDocuments,
  queryRag,
  OpenClawInferAdapter,
  type LlmRuntime,
  type ModelInfo,
  type TaskProfile,
} from "@jarvis/inference";
import type { DatabaseSync } from "node:sqlite";
import type { InferenceAdapter, ExecutionOutcome } from "./adapter.js";
import { InferenceWorkerError } from "./adapter.js";
import type { EmbeddingPipeline } from "@jarvis/agent-framework";
import type { HybridRetriever, RetrievalResult } from "@jarvis/agent-framework";
import type {
  InferenceBatchJobStatus,
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
  InferenceModelEntry,
  InferenceRagIndexInput,
  InferenceRagIndexOutput,
  InferenceRagQueryInput,
  InferenceVisionChatInput,
  InferenceVisionChatOutput,
  InferenceRagQueryOutput
} from "./types.js";

// In-memory batch store; production would use a persistent queue
const batchStore = new Map<
  string,
  { jobs: InferenceBatchJobStatus[]; submittedAt: string }
>();

/** Well-known runtime URLs. LM Studio and llama.cpp URLs can be overridden via config. */
const DEFAULT_RUNTIME_URLS: Record<string, string> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234",
  llamacpp: "http://localhost:8080",
};

export class DefaultInferenceAdapter implements InferenceAdapter {
  private runtimeDb?: DatabaseSync;
  private runtimeUrls: Record<string, string>;
  private embeddingPipeline?: EmbeddingPipeline;
  private hybridRetriever?: HybridRetriever;

  constructor(
    runtimeDb?: DatabaseSync,
    lmStudioUrl?: string,
    embeddingPipeline?: EmbeddingPipeline,
    hybridRetriever?: HybridRetriever,
    llamaCppUrl?: string,
  ) {
    this.runtimeDb = runtimeDb;
    this.runtimeUrls = {
      ...DEFAULT_RUNTIME_URLS,
      ...(lmStudioUrl ? { lmstudio: lmStudioUrl } : {}),
      ...(llamaCppUrl ? { llamacpp: llamaCppUrl } : {}),
    };
    this.embeddingPipeline = embeddingPipeline;
    this.hybridRetriever = hybridRetriever;
  }

  /**
   * Resolve a runtime baseUrl from registry model info.
   * Checks availability before returning.
   */
  private async resolveRuntimeUrl(runtimeName: string): Promise<string> {
    const baseUrl = this.runtimeUrls[runtimeName];
    if (!baseUrl) {
      throw new InferenceWorkerError(
        "RUNTIME_UNAVAILABLE",
        `Unknown runtime '${runtimeName}'. Known: ${Object.keys(this.runtimeUrls).join(", ")}`,
        true,
      );
    }
    return baseUrl;
  }

  /**
   * Primary model selection: load from registry, select with evidence.
   * Returns null if registry is empty (triggers fallback to live discovery).
   */
  private selectFromRegistry(
    profile: TaskProfile,
    explicitModel?: string,
  ): { model: ModelInfo; source: "registry" } | null {
    if (!this.runtimeDb) return null;

    try {
      const registered = loadRegisteredModels(this.runtimeDb);
      if (registered.length === 0) return null;

      if (explicitModel) {
        const match = registered.find(m => m.id === explicitModel);
        if (match) return { model: match, source: "registry" };
        return null; // explicit model not in registry — fall through to discovery
      }

      const benchmarks = loadAllBenchmarks(this.runtimeDb);
      const selected = selectByProfileWithEvidence(registered, profile, benchmarks);
      if (selected) return { model: selected, source: "registry" };

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fallback: live discovery (used only on first boot before registry is populated).
   */
  private async discoverAndSelect(
    profile: TaskProfile,
    explicitModel?: string,
  ): Promise<{ model: ModelInfo; runtimeUrl: string }> {
    const runtimes = await detectRuntimes();
    const available = runtimes.filter(r => r.available);
    if (available.length === 0) {
      throw new InferenceWorkerError(
        "RUNTIME_UNAVAILABLE",
        "No local LLM runtimes are available. Ensure Ollama, LM Studio, or llama.cpp is running.",
        true,
      );
    }

    const allModels = await Promise.all(
      available.map(async (runtime) => {
        const ids = await listModels(runtime.baseUrl);
        return ids.map(id => buildModelInfo(id, runtime.name));
      }),
    );
    const flatModels = allModels.flat();

    if (explicitModel) {
      const match = flatModels.find(m => m.id === explicitModel);
      if (!match) {
        throw new InferenceWorkerError("MODEL_NOT_FOUND", `Model '${explicitModel}' not found.`, false);
      }
      const rt = available.find(r => r.name === match.runtime);
      if (!rt) {
        throw new InferenceWorkerError("RUNTIME_UNAVAILABLE", `Runtime '${match.runtime}' unavailable.`, true);
      }
      return { model: match, runtimeUrl: rt.baseUrl };
    }

    const selected = selectModel(flatModels, "balanced_local");
    if (!selected) {
      throw new InferenceWorkerError("NO_SUITABLE_MODEL", "No suitable model available.", true);
    }
    const rt = available.find(r => r.name === selected.runtime);
    if (!rt) {
      throw new InferenceWorkerError("RUNTIME_UNAVAILABLE", `Runtime '${selected.runtime}' unavailable.`, true);
    }
    return { model: selected, runtimeUrl: rt.baseUrl };
  }

  async chat(input: InferenceChatInput): Promise<ExecutionOutcome<InferenceChatOutput>> {
    const profile: TaskProfile = { objective: "answer" };
    let modelId: string;
    let runtimeUrl: string;
    let selectedRuntime: "ollama" | "lmstudio" | "llamacpp" | "openclaw" = "lmstudio";

    // Primary path: registry + evidence-backed selection
    const fromRegistry = this.selectFromRegistry(profile, input.model);
    if (fromRegistry) {
      modelId = fromRegistry.model.id;
      selectedRuntime = fromRegistry.model.runtime;

      // OpenClaw path: route through the gateway adapter instead of local chatCompletion
      if (selectedRuntime === "openclaw") {
        return this.chatViaOpenClaw(input, modelId);
      }

      runtimeUrl = await this.resolveRuntimeUrl(selectedRuntime);
    } else {
      // Fallback: live discovery (first boot only, before daemon populates registry)
      const discovered = await this.discoverAndSelect(profile, input.model);
      modelId = discovered.model.id;
      runtimeUrl = discovered.runtimeUrl;
      selectedRuntime = discovered.model.runtime;
    }

    const result = await chatCompletion({
      baseUrl: runtimeUrl,
      model: modelId,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.max_tokens,
    });

    const output: InferenceChatOutput = {
      content: result.content,
      model: result.model,
      runtime: selectedRuntime,
      usage: {
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
        total_tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
      },
    };

    return {
      summary: `Chat completed via ${output.runtime} (${modelId}): ${output.usage.total_tokens} tokens.`,
      structured_output: output,
    };
  }

  /**
   * Route chat through the OpenClaw inference gateway.
   *
   * Used when model selection picks a model with runtime:"openclaw"
   * (registered via daemon's OpenClaw model discovery loop).
   * Falls back to local if the gateway is unreachable.
   */
  private async chatViaOpenClaw(
    input: InferenceChatInput,
    modelId: string,
  ): Promise<ExecutionOutcome<InferenceChatOutput>> {
    const adapter = new OpenClawInferAdapter();

    const prompt = input.messages
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    try {
      const response = await adapter.complete({
        prompt,
        model: modelId,
        temperature: input.temperature,
        maxTokens: input.max_tokens,
      });

      const output: InferenceChatOutput = {
        content: response.text,
        model: response.model,
        runtime: "openclaw",
        usage: {
          prompt_tokens: response.tokens_used ?? 0,
          completion_tokens: response.tokens_used ?? 0,
          total_tokens: response.tokens_used ?? 0,
        },
      };

      return {
        summary: `Chat completed via openclaw (${modelId}): ${output.usage.total_tokens} tokens, ${response.latency_ms}ms.`,
        structured_output: output,
      };
    } catch (err) {
      // Gateway unreachable — fall back to local inference
      const msg = err instanceof Error ? err.message : String(err);
      throw new InferenceWorkerError(
        "OPENCLAW_UNAVAILABLE",
        `OpenClaw inference failed for model "${modelId}": ${msg}. ` +
        "Ensure the OpenClaw gateway is running. To fall back to local, " +
        "re-run model discovery or select a local model explicitly.",
        true, // retryable
      );
    }
  }

  /**
   * Route vision chat through OpenClaw gateway.
   */
  private async visionChatViaOpenClaw(
    input: InferenceVisionChatInput,
    modelId: string,
  ): Promise<ExecutionOutcome<InferenceVisionChatOutput>> {
    const adapter = new OpenClawInferAdapter();

    // Flatten multimodal messages for the prompt
    const prompt = input.messages.map((m) => {
      if (typeof m.content === "string") return `${m.role}: ${m.content}`;
      const textParts = m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text);
      return `${m.role}: ${textParts.join(" ")}`;
    }).join("\n");

    try {
      const response = await adapter.complete({ prompt, model: modelId, temperature: input.temperature, maxTokens: input.max_tokens });
      const output: InferenceVisionChatOutput = {
        content: response.text,
        model: response.model,
        runtime: "openclaw",
        usage: { prompt_tokens: response.tokens_used ?? 0, completion_tokens: response.tokens_used ?? 0, total_tokens: response.tokens_used ?? 0 },
      };
      return { summary: `Vision chat completed via openclaw (${modelId}).`, structured_output: output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InferenceWorkerError("OPENCLAW_UNAVAILABLE", `OpenClaw vision inference failed: ${msg}`, true);
    }
  }

  /**
   * Route embeddings through OpenClaw gateway.
   */
  private async embedViaOpenClaw(
    input: InferenceEmbedInput,
    modelId: string,
  ): Promise<ExecutionOutcome<InferenceEmbedOutput>> {
    const adapter = new OpenClawInferAdapter();

    try {
      const embeddings = await adapter.embed(input.texts);
      const dimensions = embeddings[0]?.length ?? 0;
      const output: InferenceEmbedOutput = { embeddings, model: modelId, runtime: "openclaw", dimensions };
      return { summary: `Embedded ${input.texts.length} text(s) via openclaw (${modelId}), ${dimensions} dimensions.`, structured_output: output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InferenceWorkerError("OPENCLAW_UNAVAILABLE", `OpenClaw embedding failed: ${msg}`, true);
    }
  }

  async visionChat(input: InferenceVisionChatInput): Promise<ExecutionOutcome<InferenceVisionChatOutput>> {
    const profile: TaskProfile = { objective: "answer", constraints: { require_vision: true } };
    let modelId: string;
    let runtimeUrl: string;
    let discovered: Awaited<ReturnType<typeof this.discoverAndSelect>> | undefined;

    const fromRegistry = this.selectFromRegistry(profile, input.model);
    if (fromRegistry) {
      modelId = fromRegistry.model.id;

      // OpenClaw path for vision models
      if (fromRegistry.model.runtime === "openclaw") {
        return this.visionChatViaOpenClaw(input, modelId);
      }

      runtimeUrl = await this.resolveRuntimeUrl(fromRegistry.model.runtime);
    } else {
      discovered = await this.discoverAndSelect(profile, input.model);
      modelId = discovered.model.id;
      runtimeUrl = discovered.runtimeUrl;
    }

    // Convert multimodal messages to the format expected by Ollama/LM Studio.
    // Both support OpenAI-compatible multimodal message format.
    const messages = input.messages.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }
      // Concatenate text parts, extract image URLs for the images field
      const textParts = msg.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      const images = msg.content
        .filter((p): p is { type: "image_url"; image_url: { url: string } } => p.type === "image_url")
        .map((p) => {
          // Strip data:image/...;base64, prefix if present
          const url = p.image_url.url;
          const base64Match = url.match(/^data:[^;]+;base64,(.+)$/);
          return base64Match ? base64Match[1] : url;
        });
      return { role: msg.role, content: textParts, ...(images.length > 0 ? { images } : {}) };
    });

    const result = await chatCompletion({
      baseUrl: runtimeUrl,
      model: modelId,
      messages: messages as Array<{ role: string; content: string }>,
      temperature: input.temperature,
      maxTokens: input.max_tokens,
    });

    const runtimeName = fromRegistry ? fromRegistry.model.runtime : discovered!.model.runtime;
    const output: InferenceVisionChatOutput = {
      content: result.content,
      model: result.model,
      runtime: runtimeName,
      usage: {
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
        total_tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
      },
    };

    return {
      summary: `Vision chat completed via ${runtimeName} (${modelId}): ${output.usage.total_tokens} tokens.`,
      structured_output: output,
    };
  }

  async embed(input: InferenceEmbedInput): Promise<ExecutionOutcome<InferenceEmbedOutput>> {
    type LocalModelInfo = ModelInfo & { runtime: "ollama" | "lmstudio" | "llamacpp" };

    const runtimes = await detectRuntimes();
    const availableRuntimes = runtimes.filter((runtime) => runtime.available);
    if (availableRuntimes.length === 0) {
      throw new InferenceWorkerError(
        "RUNTIME_UNAVAILABLE",
        "No local LLM runtimes are available. Ensure Ollama, LM Studio, or llama.cpp is running.",
        true,
      );
    }

    const reachableRuntimeNames = new Set<string>(availableRuntimes.map((runtime) => runtime.name));
    const localAvailableRuntimes = availableRuntimes.filter(
      (runtime): runtime is typeof runtime & { name: "ollama" | "lmstudio" | "llamacpp" } =>
        runtime.name === "ollama" || runtime.name === "lmstudio" || runtime.name === "llamacpp",
    );
    const localRuntimeByName = new Map(localAvailableRuntimes.map((runtime) => [runtime.name, runtime]));
    const discoverReachableModels = async (): Promise<LocalModelInfo[]> => {
      const discovered = await Promise.all(
        localAvailableRuntimes.map(async (runtime) => {
          const ids = await listModels(runtime.baseUrl);
          return ids.map((id) => buildModelInfo(id, runtime.name));
        }),
      );
      return discovered.flat() as LocalModelInfo[];
    };

    let modelId: string;
    let runtimeUrl: string;
    let runtimeName: "ollama" | "lmstudio" | "llamacpp" | "openclaw";

    // Explicit model selection: trust the caller, but only on reachable runtimes.
    if (input.model) {
      const registered = this.runtimeDb
        ? loadRegisteredModels(this.runtimeDb).filter((model) => reachableRuntimeNames.has(model.runtime))
        : [];
      const registeredMatch = registered.find((model) => model.id === input.model);

      if (registeredMatch) {
        if (registeredMatch.runtime === "openclaw") {
          return this.embedViaOpenClaw(input, registeredMatch.id);
        }
        const localRuntime = registeredMatch.runtime;
        modelId = registeredMatch.id;
        runtimeUrl = localRuntimeByName.get(localRuntime)!.baseUrl;
        runtimeName = localRuntime;
      } else {
        const discovered = await discoverReachableModels();
        const discoveredMatch = discovered.find((model) => model.id === input.model);
        if (!discoveredMatch) {
          throw new InferenceWorkerError(
            "MODEL_NOT_FOUND",
            `Embedding model '${input.model}' is not available on any reachable runtime.`,
            false,
          );
        }
        modelId = discoveredMatch.id;
        runtimeUrl = localRuntimeByName.get(discoveredMatch.runtime)!.baseUrl;
        runtimeName = discoveredMatch.runtime;
      }
    } else {
      const registered = this.runtimeDb
        ? loadRegisteredModels(this.runtimeDb).filter((model) => reachableRuntimeNames.has(model.runtime))
        : [];
      const selectedRegistered = selectEmbeddingModel(registered);

      if (selectedRegistered) {
        if (selectedRegistered.runtime === "openclaw") {
          return this.embedViaOpenClaw(input, selectedRegistered.id);
        }
        const localRuntime = selectedRegistered.runtime;
        modelId = selectedRegistered.id;
        runtimeUrl = localRuntimeByName.get(localRuntime)!.baseUrl;
        runtimeName = localRuntime;
      } else {
        const discovered = await discoverReachableModels();
        const selectedDiscovered = selectEmbeddingModel(discovered) as LocalModelInfo | null;
        if (!selectedDiscovered) {
          throw new InferenceWorkerError(
            "NO_EMBEDDING_MODEL",
            "No reachable embedding-capable model is available. Start LM Studio, llama.cpp, or install an embedding model in Ollama.",
            true,
          );
        }
        modelId = selectedDiscovered.id;
        runtimeUrl = localRuntimeByName.get(selectedDiscovered.runtime)!.baseUrl;
        runtimeName = selectedDiscovered.runtime;
      }
    }

    const result = await embedTexts({
      baseUrl: runtimeUrl,
      model: modelId,
      texts: input.texts,
    });

    const dimensions = result.embeddings[0]?.length ?? 0;
    const output: InferenceEmbedOutput = {
      embeddings: result.embeddings,
      model: modelId,
      runtime: runtimeName!,
      dimensions,
    };

    return {
      summary: `Embedded ${input.texts.length} text(s) via ${runtimeName!} (${modelId}), ${dimensions} dimensions.`,
      structured_output: output,
    };
  }

  async listModels(input: InferenceListModelsInput): Promise<ExecutionOutcome<InferenceListModelsOutput>> {
    const all = await detectRuntimes();
    const filter = input.runtime ?? "all";

    const filtered = filter === "all" ? all : all.filter((r) => r.name === filter);
    const available = filtered.filter((r) => r.available);
    const availableNames: Array<"ollama" | "lmstudio" | "llamacpp" | "openclaw"> = available.map((r) => r.name as "ollama" | "lmstudio" | "llamacpp");

    const allModelEntries = await Promise.all(
      available.map(async (runtime) => {
        const ids = await listModels(runtime.baseUrl);
        return ids.map<InferenceModelEntry>((id) => ({
          id,
          runtime: runtime.name,
          size_class: classifyModelSize(id),
          capabilities: inferCapabilities(id),
        }));
      }),
    );
    let models = allModelEntries.flat();

    // Include OpenClaw models when filter allows it
    if (filter === "all" || filter === "openclaw") {
      try {
        const openClawAdapter = new OpenClawInferAdapter();
        const openClawModels = await openClawAdapter.listModels();
        if (openClawModels.length > 0) {
          if (!availableNames.includes("openclaw")) {
            availableNames.push("openclaw");
          }
          models = [
            ...models,
            ...openClawModels.map<InferenceModelEntry>((m) => ({
              id: m.id,
              runtime: "openclaw",
              size_class: "medium",
              capabilities: m.capabilities,
            })),
          ];
        }
      } catch {
        // Gateway unavailable — skip OpenClaw models
      }
    }

    const output: InferenceListModelsOutput = {
      models,
      runtimes_available: availableNames,
      total_count: models.length,
    };

    const runtimeLabel = filter === "all" ? "all runtimes" : filter;
    return {
      summary: `Found ${models.length} model(s) across ${runtimeLabel}.`,
      structured_output: output,
    };
  }

  async ragIndex(input: InferenceRagIndexInput): Promise<ExecutionOutcome<InferenceRagIndexOutput>> {
    // Use hybrid RAG pipeline when available
    if (this.embeddingPipeline) {
      let totalChunks = 0;
      for (const filePath of input.paths) {
        if (!existsSync(filePath)) {
          throw new InferenceWorkerError(
            "FILE_NOT_FOUND",
            `File not found for RAG indexing: ${filePath}`,
            false,
          );
        }
        const content = await readFile(filePath, "utf-8");
        const docId = `${input.collection}:${filePath}`;
        const result = await this.embeddingPipeline.ingestDocument(
          docId,
          content,
          input.collection,
        );
        totalChunks += result.chunkCount;
      }

      const output: InferenceRagIndexOutput = {
        collection: input.collection,
        document_count: input.paths.length,
        chunk_count: totalChunks,
        last_indexed_at: new Date().toISOString(),
      };
      return {
        summary: `Indexed ${input.paths.length} document(s) into '${input.collection}' (${totalChunks} chunks, hybrid RAG).`,
        structured_output: output,
      };
    }

    // Fallback: in-memory TF-based RAG
    const collection = await indexDocuments(input.paths, input.collection);

    const output: InferenceRagIndexOutput = {
      collection: collection.name,
      document_count: collection.documentCount,
      chunk_count: input.paths.length * 10,
      last_indexed_at: collection.lastIndexedAt,
    };

    return {
      summary: `Indexed ${collection.documentCount} document(s) into collection '${collection.name}'.`,
      structured_output: output,
    };
  }

  async ragQuery(input: InferenceRagQueryInput): Promise<ExecutionOutcome<InferenceRagQueryOutput>> {
    // Use hybrid retriever when available (dense + sparse + RRF)
    if (this.hybridRetriever) {
      const retrieved = await this.hybridRetriever.retrieve(
        input.query,
        input.top_k,
        input.collection,
      );

      const results = retrieved.map((r) => ({
        text: r.text,
        score: r.rerankScore ?? r.score,
        source: r.docId,
      }));

      const output: InferenceRagQueryOutput = {
        results,
        collection: input.collection,
        query: input.query,
        returned_count: results.length,
      };
      return {
        summary: `Hybrid RAG query returned ${results.length} result(s) from '${input.collection}'.`,
        structured_output: output,
      };
    }

    // Fallback: in-memory TF-based RAG
    const results = await queryRag(input.query, input.collection, input.top_k);

    const output: InferenceRagQueryOutput = {
      results,
      collection: input.collection,
      query: input.query,
      returned_count: results.length,
    };

    return {
      summary: `RAG query returned ${results.length} result(s) from collection '${input.collection}'.`,
      structured_output: output,
    };
  }

  async batchSubmit(input: InferenceBatchSubmitInput): Promise<ExecutionOutcome<InferenceBatchSubmitOutput>> {
    const batchId = randomUUID();
    const submittedAt = new Date().toISOString();

    const jobs: InferenceBatchJobStatus[] = input.jobs.map((_, i) => ({
      index: i,
      status: "pending",
    }));

    batchStore.set(batchId, { jobs, submittedAt });
    void this._processBatch(batchId, input);

    const output: InferenceBatchSubmitOutput = {
      batch_id: batchId,
      job_count: input.jobs.length,
      status: "accepted",
      submitted_at: submittedAt,
    };

    return {
      summary: `Batch of ${input.jobs.length} job(s) accepted (batch_id=${batchId}).`,
      structured_output: output,
    };
  }

  private async _processBatch(
    batchId: string,
    input: InferenceBatchSubmitInput,
  ): Promise<void> {
    const stored = batchStore.get(batchId);
    if (!stored) return;

    for (let i = 0; i < input.jobs.length; i++) {
      const job = input.jobs[i];
      if (!job) continue;
      const jobStatus = stored.jobs[i];
      if (!jobStatus) continue;

      jobStatus.status = "running";
      try {
        const result = await this.chat({
          messages: job.messages,
          model: job.model,
        });
        jobStatus.status = "completed";
        jobStatus.content = result.structured_output.content;
      } catch (error) {
        jobStatus.status = "failed";
        jobStatus.error =
          error instanceof Error ? error.message : "Unknown error";
      }
    }
  }

  async batchStatus(input: InferenceBatchStatusInput): Promise<ExecutionOutcome<InferenceBatchStatusOutput>> {
    const stored = batchStore.get(input.batch_id);
    if (!stored) {
      throw new InferenceWorkerError(
        "BATCH_NOT_FOUND",
        `Batch '${input.batch_id}' was not found.`,
        false,
      );
    }

    const { jobs } = stored;
    const completedJobs = jobs.filter((j) => j.status === "completed").length;
    const failedJobs = jobs.filter((j) => j.status === "failed").length;
    const pendingJobs = jobs.filter((j) => j.status === "pending" || j.status === "running").length;

    let overallStatus: InferenceBatchStatusOutput["overall_status"];
    if (pendingJobs > 0) {
      overallStatus = completedJobs + failedJobs > 0 ? "running" : "pending";
    } else if (failedJobs === 0) {
      overallStatus = "completed";
    } else if (completedJobs === 0) {
      overallStatus = "failed";
    } else {
      overallStatus = "partial_failure";
    }

    const output: InferenceBatchStatusOutput = {
      batch_id: input.batch_id,
      total_jobs: jobs.length,
      completed_jobs: completedJobs,
      failed_jobs: failedJobs,
      pending_jobs: pendingJobs,
      overall_status: overallStatus,
      jobs: [...jobs],
    };

    return {
      summary: `Batch ${input.batch_id}: ${completedJobs}/${jobs.length} complete, ${failedJobs} failed, ${pendingJobs} pending.`,
      structured_output: output,
    };
  }
}

export function createDefaultInferenceAdapter(): InferenceAdapter {
  return new DefaultInferenceAdapter();
}
