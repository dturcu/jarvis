import { randomUUID } from "node:crypto";
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
  indexDocuments,
  queryRag,
  type LlmRuntime
} from "@jarvis/inference";
import type { InferenceAdapter, ExecutionOutcome } from "./adapter.js";
import { InferenceWorkerError } from "./adapter.js";
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
  InferenceRagQueryOutput
} from "./types.js";

// In-memory batch store; production would use a persistent queue
const batchStore = new Map<
  string,
  { jobs: InferenceBatchJobStatus[]; submittedAt: string }
>();

async function getAvailableRuntimes(): Promise<LlmRuntime[]> {
  const runtimes = await detectRuntimes();
  return runtimes.filter((r) => r.available);
}

export class DefaultInferenceAdapter implements InferenceAdapter {
  async chat(input: InferenceChatInput): Promise<ExecutionOutcome<InferenceChatOutput>> {
    const available = await getAvailableRuntimes();
    if (available.length === 0) {
      throw new InferenceWorkerError(
        "RUNTIME_UNAVAILABLE",
        "No local LLM runtimes are available. Ensure Ollama or LM Studio is running.",
        true
      );
    }

    // Build model list across all available runtimes
    const allModels = await Promise.all(
      available.map(async (runtime) => {
        const ids = await listModels(runtime.baseUrl);
        return ids.map((id) => buildModelInfo(id, runtime.name));
      })
    );
    const flatModels = allModels.flat();

    // If a specific model was requested, use it
    let targetRuntime: LlmRuntime;
    let modelId: string;

    if (input.model) {
      const match = flatModels.find((m) => m.id === input.model);
      if (!match) {
        throw new InferenceWorkerError(
          "MODEL_NOT_FOUND",
          `Model '${input.model}' was not found on any available runtime.`,
          false
        );
      }
      const rt = available.find((r) => r.name === match.runtime);
      if (!rt) {
        throw new InferenceWorkerError("RUNTIME_UNAVAILABLE", `Runtime '${match.runtime}' is not available.`, true);
      }
      targetRuntime = rt;
      modelId = match.id;
    } else {
      const selected = selectModel(flatModels, "balanced_local");
      if (!selected) {
        throw new InferenceWorkerError(
          "NO_SUITABLE_MODEL",
          "No suitable model available.",
          true
        );
      }
      const rt = available.find((r) => r.name === selected.runtime);
      if (!rt) {
        throw new InferenceWorkerError("RUNTIME_UNAVAILABLE", `Runtime '${selected.runtime}' is not available.`, true);
      }
      targetRuntime = rt;
      modelId = selected.id;
    }

    const result = await chatCompletion({
      baseUrl: targetRuntime.baseUrl,
      model: modelId,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.max_tokens
    });

    const output: InferenceChatOutput = {
      content: result.content,
      model: result.model,
      runtime: targetRuntime.name,
      usage: {
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
        total_tokens: result.usage.prompt_tokens + result.usage.completion_tokens
      }
    };

    const tokenSummary = `${output.usage.total_tokens} tokens`;
    return {
      summary: `Chat completed via ${targetRuntime.name} (${modelId}): ${tokenSummary}.`,
      structured_output: output
    };
  }

  async embed(input: InferenceEmbedInput): Promise<ExecutionOutcome<InferenceEmbedOutput>> {
    const available = await getAvailableRuntimes();
    if (available.length === 0) {
      throw new InferenceWorkerError(
        "RUNTIME_UNAVAILABLE",
        "No local LLM runtimes are available for embedding.",
        true
      );
    }

    const allModels = await Promise.all(
      available.map(async (runtime) => {
        const ids = await listModels(runtime.baseUrl);
        return ids.map((id) => buildModelInfo(id, runtime.name));
      })
    );
    const flatModels = allModels.flat();

    let targetRuntime: LlmRuntime;
    let modelId: string;

    if (input.model) {
      const match = flatModels.find((m) => m.id === input.model);
      if (!match) {
        throw new InferenceWorkerError(
          "MODEL_NOT_FOUND",
          `Embedding model '${input.model}' was not found.`,
          false
        );
      }
      const rt = available.find((r) => r.name === match.runtime);
      if (!rt) {
        throw new InferenceWorkerError("RUNTIME_UNAVAILABLE", `Runtime '${match.runtime}' is not available.`, true);
      }
      targetRuntime = rt;
      modelId = match.id;
    } else {
      const selected = selectEmbeddingModel(flatModels);
      if (!selected) {
        throw new InferenceWorkerError("NO_SUITABLE_MODEL", "No embedding model available.", true);
      }
      const rt = available.find((r) => r.name === selected.runtime);
      if (!rt) {
        throw new InferenceWorkerError("RUNTIME_UNAVAILABLE", `Runtime '${selected.runtime}' is not available.`, true);
      }
      targetRuntime = rt;
      modelId = selected.id;
    }

    const result = await embedTexts({
      baseUrl: targetRuntime.baseUrl,
      model: modelId,
      texts: input.texts
    });

    const dimensions = result.embeddings[0]?.length ?? 0;
    const output: InferenceEmbedOutput = {
      embeddings: result.embeddings,
      model: modelId,
      runtime: targetRuntime.name,
      dimensions
    };

    return {
      summary: `Embedded ${input.texts.length} text(s) via ${targetRuntime.name} (${modelId}), ${dimensions} dimensions.`,
      structured_output: output
    };
  }

  async listModels(input: InferenceListModelsInput): Promise<ExecutionOutcome<InferenceListModelsOutput>> {
    const all = await detectRuntimes();
    const filter = input.runtime ?? "all";

    const filtered = filter === "all" ? all : all.filter((r) => r.name === filter);
    const available = filtered.filter((r) => r.available);
    const availableNames = available.map((r) => r.name);

    const allModelEntries = await Promise.all(
      available.map(async (runtime) => {
        const ids = await listModels(runtime.baseUrl);
        return ids.map<InferenceModelEntry>((id) => ({
          id,
          runtime: runtime.name,
          size_class: classifyModelSize(id),
          capabilities: inferCapabilities(id)
        }));
      })
    );
    const models = allModelEntries.flat();

    const output: InferenceListModelsOutput = {
      models,
      runtimes_available: availableNames,
      total_count: models.length
    };

    const runtimeLabel = filter === "all" ? "all runtimes" : filter;
    return {
      summary: `Found ${models.length} model(s) across ${runtimeLabel}.`,
      structured_output: output
    };
  }

  async ragIndex(input: InferenceRagIndexInput): Promise<ExecutionOutcome<InferenceRagIndexOutput>> {
    const collection = await indexDocuments(input.paths, input.collection);

    const output: InferenceRagIndexOutput = {
      collection: collection.name,
      document_count: collection.documentCount,
      chunk_count: input.paths.length * 10, // estimated; real implementation would count chunks
      last_indexed_at: collection.lastIndexedAt
    };

    return {
      summary: `Indexed ${collection.documentCount} document(s) into collection '${collection.name}'.`,
      structured_output: output
    };
  }

  async ragQuery(input: InferenceRagQueryInput): Promise<ExecutionOutcome<InferenceRagQueryOutput>> {
    const results = await queryRag(input.query, input.collection, input.top_k);

    const output: InferenceRagQueryOutput = {
      results,
      collection: input.collection,
      query: input.query,
      returned_count: results.length
    };

    return {
      summary: `RAG query returned ${results.length} result(s) from collection '${input.collection}'.`,
      structured_output: output
    };
  }

  async batchSubmit(input: InferenceBatchSubmitInput): Promise<ExecutionOutcome<InferenceBatchSubmitOutput>> {
    const batchId = randomUUID();
    const submittedAt = new Date().toISOString();

    const jobs: InferenceBatchJobStatus[] = input.jobs.map((_, i) => ({
      index: i,
      status: "pending"
    }));

    batchStore.set(batchId, { jobs, submittedAt });

    // Fire-and-forget: process jobs asynchronously
    void this._processBatch(batchId, input);

    const output: InferenceBatchSubmitOutput = {
      batch_id: batchId,
      job_count: input.jobs.length,
      status: "accepted",
      submitted_at: submittedAt
    };

    return {
      summary: `Batch of ${input.jobs.length} job(s) accepted (batch_id=${batchId}).`,
      structured_output: output
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
        false
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
      jobs: [...jobs]
    };

    return {
      summary: `Batch ${input.batch_id}: ${completedJobs}/${jobs.length} complete, ${failedJobs} failed, ${pendingJobs} pending.`,
      structured_output: output
    };
  }
}

export function createDefaultInferenceAdapter(): InferenceAdapter {
  return new DefaultInferenceAdapter();
}
