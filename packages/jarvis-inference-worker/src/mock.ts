import { randomUUID } from "node:crypto";
import type { InferenceAdapter, ExecutionOutcome } from "./adapter.js";
import { InferenceWorkerError } from "./adapter.js";
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

const MOCK_MODELS = [
  {
    id: "llama3.2:1b",
    runtime: "ollama" as const,
    tier: "haiku" as const,
    capabilities: ["chat"] as string[]
  },
  {
    id: "llama3.1:8b",
    runtime: "ollama" as const,
    tier: "sonnet" as const,
    capabilities: ["chat", "code"] as string[]
  },
  {
    id: "llama3.1:70b",
    runtime: "lmstudio" as const,
    tier: "opus" as const,
    capabilities: ["chat", "code"] as string[]
  },
  {
    id: "nomic-embed-text",
    runtime: "ollama" as const,
    tier: "haiku" as const,
    capabilities: ["embedding"] as string[]
  }
];

const MOCK_EMBEDDING_DIM = 768;

function makeMockEmbedding(text: string): number[] {
  // Deterministic mock embeddings based on text length
  const seed = text.length;
  return Array.from({ length: MOCK_EMBEDDING_DIM }, (_, i) =>
    Math.sin((seed + i) * 0.1) * 0.5
  );
}

export class MockInferenceAdapter implements InferenceAdapter {
  private chatCalls: InferenceChatInput[] = [];
  private embedCalls: InferenceEmbedInput[] = [];
  private indexedCollections: Map<string, string[]> = new Map();
  private batchStore: Map<
    string,
    { jobs: Array<{ status: string; content?: string; error?: string }>; submittedAt: string }
  > = new Map();

  getChatCalls(): InferenceChatInput[] {
    return [...this.chatCalls];
  }

  getEmbedCalls(): InferenceEmbedInput[] {
    return [...this.embedCalls];
  }

  getIndexedCollections(): string[] {
    return [...this.indexedCollections.keys()];
  }

  async chat(input: InferenceChatInput): Promise<ExecutionOutcome<InferenceChatOutput>> {
    this.chatCalls.push(input);

    const tier = input.tier ?? "sonnet";
    const model = input.model ?? MOCK_MODELS.find((m) => m.tier === tier && m.capabilities.includes("chat"))?.id ?? "llama3.1:8b";
    const lastMessage = input.messages[input.messages.length - 1];
    const content = `Mock response to: ${lastMessage?.content?.slice(0, 50) ?? "(empty)"}`;
    const promptTokens = input.messages.reduce((sum, m) => sum + m.content.split(" ").length, 0);
    const completionTokens = content.split(" ").length;

    return {
      summary: `Chat completed via ollama (${model}): ${promptTokens + completionTokens} tokens.`,
      structured_output: {
        content,
        model,
        runtime: "ollama",
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        }
      }
    };
  }

  async embed(input: InferenceEmbedInput): Promise<ExecutionOutcome<InferenceEmbedOutput>> {
    this.embedCalls.push(input);

    const model = input.model ?? "nomic-embed-text";
    const embeddings = input.texts.map((t) => makeMockEmbedding(t));

    return {
      summary: `Embedded ${input.texts.length} text(s) via ollama (${model}), ${MOCK_EMBEDDING_DIM} dimensions.`,
      structured_output: {
        embeddings,
        model,
        runtime: "ollama",
        dimensions: MOCK_EMBEDDING_DIM
      }
    };
  }

  async listModels(input: InferenceListModelsInput): Promise<ExecutionOutcome<InferenceListModelsOutput>> {
    const filter = input.runtime ?? "all";
    const models = filter === "all"
      ? MOCK_MODELS
      : MOCK_MODELS.filter((m) => m.runtime === filter);

    const runtimesAvailable = [...new Set(models.map((m) => m.runtime))];

    return {
      summary: `Found ${models.length} model(s) across ${filter === "all" ? "all runtimes" : filter}.`,
      structured_output: {
        models,
        runtimes_available: runtimesAvailable,
        total_count: models.length
      }
    };
  }

  async ragIndex(input: InferenceRagIndexInput): Promise<ExecutionOutcome<InferenceRagIndexOutput>> {
    this.indexedCollections.set(input.collection, input.paths);
    const indexedAt = new Date().toISOString();

    return {
      summary: `Indexed ${input.paths.length} document(s) into collection '${input.collection}'.`,
      structured_output: {
        collection: input.collection,
        document_count: input.paths.length,
        chunk_count: input.paths.length * 8,
        last_indexed_at: indexedAt
      }
    };
  }

  async ragQuery(input: InferenceRagQueryInput): Promise<ExecutionOutcome<InferenceRagQueryOutput>> {
    const paths = this.indexedCollections.get(input.collection) ?? [];
    const mockResults = paths.slice(0, input.top_k).map((source, i) => ({
      text: `Mock result ${i + 1} from ${source} for query: ${input.query.slice(0, 30)}`,
      score: 1 - i * 0.1,
      source
    }));

    return {
      summary: `RAG query returned ${mockResults.length} result(s) from collection '${input.collection}'.`,
      structured_output: {
        results: mockResults,
        collection: input.collection,
        query: input.query,
        returned_count: mockResults.length
      }
    };
  }

  async batchSubmit(input: InferenceBatchSubmitInput): Promise<ExecutionOutcome<InferenceBatchSubmitOutput>> {
    const batchId = randomUUID();
    const submittedAt = new Date().toISOString();

    const jobs = input.jobs.map((_, i) => ({ index: i, status: "pending" as const }));
    this.batchStore.set(batchId, { jobs, submittedAt });

    return {
      summary: `Batch of ${input.jobs.length} job(s) accepted (batch_id=${batchId}).`,
      structured_output: {
        batch_id: batchId,
        job_count: input.jobs.length,
        status: "accepted",
        submitted_at: submittedAt
      }
    };
  }

  async batchStatus(input: InferenceBatchStatusInput): Promise<ExecutionOutcome<InferenceBatchStatusOutput>> {
    const stored = this.batchStore.get(input.batch_id);
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

    const overallStatus: InferenceBatchStatusOutput["overall_status"] =
      pendingJobs > 0 ? "pending" : failedJobs === 0 ? "completed" : "partial_failure";

    return {
      summary: `Batch ${input.batch_id}: ${completedJobs}/${jobs.length} complete.`,
      structured_output: {
        batch_id: input.batch_id,
        total_jobs: jobs.length,
        completed_jobs: completedJobs,
        failed_jobs: failedJobs,
        pending_jobs: pendingJobs,
        overall_status: overallStatus,
        jobs: jobs.map((j, i) => ({ index: i, status: j.status as InferenceBatchStatusOutput["jobs"][number]["status"] }))
      }
    };
  }

  // Test helper to mark batch jobs as complete
  completeBatch(batchId: string): void {
    const stored = this.batchStore.get(batchId);
    if (!stored) return;
    for (const job of stored.jobs) {
      job.status = "completed";
      job.content = "Mock completed content.";
    }
  }
}

export function createMockInferenceAdapter(): InferenceAdapter {
  return new MockInferenceAdapter();
}
