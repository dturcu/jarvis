import { beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, resetJarvisState } from "@jarvis/shared";
import {
  MockInferenceAdapter,
  createMockInferenceAdapter,
  createInferenceWorker,
  executeInferenceJob,
  isInferenceJobType,
  INFERENCE_JOB_TYPES,
  InferenceWorkerError
} from "@jarvis/inference-worker";
import { classifyModelSize } from "@jarvis/inference";
import type { JobEnvelope } from "@jarvis/shared";

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:main:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 30,
    attempt: 1,
    input,
    artifacts_in: [],
    retry_policy: { mode: "manual", max_attempts: 3 },
    metadata: {
      agent_id: "main",
      thread_key: null
    },
    ...overrides
  };
}

// ── classifyModelSize ────────────────────────────────────────────────────────

describe("classifyModelSize", () => {
  it("classifies tiny/mini/small models as small", () => {
    expect(classifyModelSize("llama3.2:1b")).toBe("small");
    expect(classifyModelSize("phi3:mini")).toBe("small");
    expect(classifyModelSize("gemma2:2b")).toBe("small");
    expect(classifyModelSize("qwen2.5:3b")).toBe("small");
    expect(classifyModelSize("tinyllama:1.5b")).toBe("small");
    expect(classifyModelSize("smollm:tiny")).toBe("small");
  });

  it("classifies 70B+ models as large", () => {
    expect(classifyModelSize("llama3.1:70b")).toBe("large");
    expect(classifyModelSize("qwen2.5:72b")).toBe("large");
    expect(classifyModelSize("llama3.3:70b-instruct")).toBe("large");
    expect(classifyModelSize("mixtral:8x7b-large")).toBe("large");
    expect(classifyModelSize("command-r-plus:110b")).toBe("large");
  });

  it("classifies mid-range models as medium by default", () => {
    expect(classifyModelSize("llama3.1:8b")).toBe("medium");
    expect(classifyModelSize("mistral:7b")).toBe("medium");
    expect(classifyModelSize("codellama:13b")).toBe("medium");
    expect(classifyModelSize("phi3:medium")).toBe("medium");
    expect(classifyModelSize("nomic-embed-text")).toBe("medium");
  });

  it("is case-insensitive", () => {
    expect(classifyModelSize("Llama3.2:1B")).toBe("small");
    expect(classifyModelSize("LLAMA3.1:70B")).toBe("large");
    expect(classifyModelSize("MISTRAL:7B")).toBe("medium");
  });
});

// ── INFERENCE_JOB_TYPES ───────────────────────────────────────────────────────

describe("INFERENCE_JOB_TYPES", () => {
  it("contains all 8 inference job types", () => {
    expect(INFERENCE_JOB_TYPES).toHaveLength(8);
    expect(INFERENCE_JOB_TYPES).toContain("inference.chat");
    expect(INFERENCE_JOB_TYPES).toContain("inference.vision_chat");
    expect(INFERENCE_JOB_TYPES).toContain("inference.embed");
    expect(INFERENCE_JOB_TYPES).toContain("inference.list_models");
    expect(INFERENCE_JOB_TYPES).toContain("inference.rag_index");
    expect(INFERENCE_JOB_TYPES).toContain("inference.rag_query");
    expect(INFERENCE_JOB_TYPES).toContain("inference.batch_submit");
    expect(INFERENCE_JOB_TYPES).toContain("inference.batch_status");
  });
});

describe("isInferenceJobType", () => {
  it("returns true for known inference job types", () => {
    for (const type of INFERENCE_JOB_TYPES) {
      expect(isInferenceJobType(type)).toBe(true);
    }
  });

  it("returns false for unknown job types", () => {
    expect(isInferenceJobType("device.snapshot")).toBe(false);
    expect(isInferenceJobType("system.monitor_cpu")).toBe(false);
    expect(isInferenceJobType("unknown.job")).toBe(false);
    expect(isInferenceJobType("")).toBe(false);
  });
});

// ── MockInferenceAdapter ──────────────────────────────────────────────────────

describe("MockInferenceAdapter", () => {
  let adapter: MockInferenceAdapter;

  beforeEach(() => {
    adapter = new MockInferenceAdapter();
  });

  describe("chat", () => {
    it("returns a non-empty content string", async () => {
      const result = await adapter.chat({
        messages: [{ role: "user", content: "Hello, world!" }]
      });
      expect(result.structured_output.content).toBeTruthy();
      expect(typeof result.structured_output.content).toBe("string");
    });

    it("echoes the user message in the response content", async () => {
      const result = await adapter.chat({
        messages: [{ role: "user", content: "What is 2+2?" }]
      });
      expect(result.structured_output.content).toContain("What is 2+2?");
    });

    it("includes token usage", async () => {
      const result = await adapter.chat({
        messages: [{ role: "user", content: "Hello" }]
      });
      const usage = result.structured_output.usage;
      expect(usage.prompt_tokens).toBeGreaterThanOrEqual(0);
      expect(usage.completion_tokens).toBeGreaterThanOrEqual(0);
      expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
    });

    it("picks the default medium model when no model is specified", async () => {
      const result = await adapter.chat({
        messages: [{ role: "user", content: "Hi" }],
      });
      expect(result.structured_output.model).toContain("8b");
    });

    it("tracks chat calls", async () => {
      await adapter.chat({ messages: [{ role: "user", content: "First" }] });
      await adapter.chat({ messages: [{ role: "user", content: "Second" }] });
      expect(adapter.getChatCalls()).toHaveLength(2);
    });
  });

  describe("embed", () => {
    it("returns embeddings for each input text", async () => {
      const result = await adapter.embed({ texts: ["Hello", "World"] });
      expect(result.structured_output.embeddings).toHaveLength(2);
    });

    it("each embedding has the expected dimension count", async () => {
      const result = await adapter.embed({ texts: ["test"] });
      const dim = result.structured_output.dimensions;
      expect(dim).toBe(768);
      expect(result.structured_output.embeddings[0]).toHaveLength(dim);
    });

    it("embeddings are deterministic for the same input", async () => {
      const r1 = await adapter.embed({ texts: ["same text"] });
      const r2 = await adapter.embed({ texts: ["same text"] });
      expect(r1.structured_output.embeddings[0]).toEqual(r2.structured_output.embeddings[0]);
    });

    it("different inputs produce different embeddings", async () => {
      const r1 = await adapter.embed({ texts: ["hello"] });
      const r2 = await adapter.embed({ texts: ["goodbye"] });
      expect(r1.structured_output.embeddings[0]).not.toEqual(r2.structured_output.embeddings[0]);
    });

    it("tracks embed calls", async () => {
      await adapter.embed({ texts: ["A"] });
      await adapter.embed({ texts: ["B"] });
      expect(adapter.getEmbedCalls()).toHaveLength(2);
    });
  });

  describe("listModels", () => {
    it("returns all models when runtime is all", async () => {
      const result = await adapter.listModels({ runtime: "all" });
      expect(result.structured_output.total_count).toBeGreaterThan(0);
      expect(result.structured_output.models.length).toBe(result.structured_output.total_count);
    });

    it("filters by ollama runtime", async () => {
      const result = await adapter.listModels({ runtime: "ollama" });
      expect(result.structured_output.models.every((m) => m.runtime === "ollama")).toBe(true);
    });

    it("filters by lmstudio runtime", async () => {
      const result = await adapter.listModels({ runtime: "lmstudio" });
      expect(result.structured_output.models.every((m) => m.runtime === "lmstudio")).toBe(true);
    });

    it("filters by llamacpp runtime", async () => {
      const result = await adapter.listModels({ runtime: "llamacpp" });
      expect(result.structured_output.models.every((m) => m.runtime === "llamacpp")).toBe(true);
      expect(result.structured_output.models.length).toBeGreaterThan(0);
    });

    it("each model entry has required fields", async () => {
      const result = await adapter.listModels({});
      for (const model of result.structured_output.models) {
        expect(model.id).toBeTruthy();
        expect(["ollama", "lmstudio", "llamacpp"]).toContain(model.runtime);
        expect(["small", "medium", "large"]).toContain(model.size_class);
        expect(Array.isArray(model.capabilities)).toBe(true);
      }
    });
  });

  describe("ragIndex", () => {
    it("indexes documents into the named collection", async () => {
      const result = await adapter.ragIndex({
        paths: ["/docs/file1.txt", "/docs/file2.txt"],
        collection: "test-docs"
      });
      expect(result.structured_output.collection).toBe("test-docs");
      expect(result.structured_output.document_count).toBe(2);
      expect(result.structured_output.last_indexed_at).toBeTruthy();
    });

    it("tracks indexed collections", async () => {
      await adapter.ragIndex({ paths: ["/doc1.txt"], collection: "col-a" });
      await adapter.ragIndex({ paths: ["/doc2.txt"], collection: "col-b" });
      const cols = adapter.getIndexedCollections();
      expect(cols).toContain("col-a");
      expect(cols).toContain("col-b");
    });
  });

  describe("ragQuery", () => {
    it("returns results from a previously indexed collection", async () => {
      await adapter.ragIndex({ paths: ["/doc.txt"], collection: "my-col" });
      const result = await adapter.ragQuery({
        query: "What is the policy?",
        collection: "my-col",
        top_k: 5
      });
      expect(result.structured_output.returned_count).toBeGreaterThanOrEqual(0);
      expect(result.structured_output.collection).toBe("my-col");
      expect(result.structured_output.query).toBe("What is the policy?");
    });

    it("returns empty results for an empty collection", async () => {
      const result = await adapter.ragQuery({
        query: "irrelevant",
        collection: "nonexistent",
        top_k: 5
      });
      expect(result.structured_output.results).toHaveLength(0);
      expect(result.structured_output.returned_count).toBe(0);
    });

    it("each result has text, score, and source", async () => {
      await adapter.ragIndex({ paths: ["/a.txt", "/b.txt"], collection: "scored-col" });
      const result = await adapter.ragQuery({
        query: "test",
        collection: "scored-col",
        top_k: 2
      });
      for (const r of result.structured_output.results) {
        expect(r.text).toBeTruthy();
        expect(typeof r.score).toBe("number");
        expect(r.source).toBeTruthy();
      }
    });
  });

  describe("batchSubmit", () => {
    it("accepts a batch and returns a batch_id", async () => {
      const result = await adapter.batchSubmit({
        jobs: [
          { messages: [{ role: "user", content: "Hello" }] },
          { messages: [{ role: "user", content: "World" }] }
        ]
      });
      expect(result.structured_output.batch_id).toBeTruthy();
      expect(result.structured_output.job_count).toBe(2);
      expect(result.structured_output.status).toBe("accepted");
      expect(result.structured_output.submitted_at).toBeTruthy();
    });

    it("returns unique batch IDs for separate submissions", async () => {
      const r1 = await adapter.batchSubmit({ jobs: [{ messages: [{ role: "user", content: "A" }] }] });
      const r2 = await adapter.batchSubmit({ jobs: [{ messages: [{ role: "user", content: "B" }] }] });
      expect(r1.structured_output.batch_id).not.toBe(r2.structured_output.batch_id);
    });
  });

  describe("batchStatus", () => {
    it("returns pending status for a freshly submitted batch", async () => {
      const submitted = await adapter.batchSubmit({
        jobs: [{ messages: [{ role: "user", content: "Hello" }] }]
      });
      const status = await adapter.batchStatus({
        batch_id: submitted.structured_output.batch_id
      });
      expect(status.structured_output.total_jobs).toBe(1);
      expect(["pending", "running", "completed"]).toContain(
        status.structured_output.overall_status
      );
    });

    it("reflects completed state after completeBatch is called", async () => {
      const submitted = await adapter.batchSubmit({
        jobs: [
          { messages: [{ role: "user", content: "First" }] },
          { messages: [{ role: "user", content: "Second" }] }
        ]
      });
      const batchId = submitted.structured_output.batch_id;
      adapter.completeBatch(batchId);

      const status = await adapter.batchStatus({ batch_id: batchId });
      expect(status.structured_output.overall_status).toBe("completed");
      expect(status.structured_output.completed_jobs).toBe(2);
      expect(status.structured_output.pending_jobs).toBe(0);
    });

    it("throws InferenceWorkerError for unknown batch IDs", async () => {
      await expect(
        adapter.batchStatus({ batch_id: "nonexistent-batch-id" })
      ).rejects.toThrow(InferenceWorkerError);
    });
  });
});

// ── executeInferenceJob ───────────────────────────────────────────────────────

describe("executeInferenceJob", () => {
  let adapter: MockInferenceAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockInferenceAdapter();
  });

  it("produces a completed JobResult for inference.chat", async () => {
    const envelope = makeEnvelope("inference.chat", {
      messages: [{ role: "user", content: "Hello" }],
    });
    const result = await executeInferenceJob(envelope, adapter);

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_id).toBe(envelope.job_id);
    expect(result.job_type).toBe("inference.chat");
    expect(result.status).toBe("completed");
    expect(result.attempt).toBe(1);
    expect(result.summary).toBeTruthy();
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.content).toBe("string");
    expect(out.runtime).toBe("ollama");
    expect(result.metrics?.worker_id).toBe("inference-worker");
  });

  it("produces a completed JobResult for inference.embed", async () => {
    const envelope = makeEnvelope("inference.embed", {
      texts: ["Hello", "World"]
    });
    const result = await executeInferenceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("inference.embed");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.embeddings)).toBe(true);
    expect(out.dimensions).toBe(768);
  });

  it("produces a completed JobResult for inference.list_models", async () => {
    const envelope = makeEnvelope("inference.list_models", { runtime: "all" });
    const result = await executeInferenceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("inference.list_models");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.models)).toBe(true);
    expect(typeof out.total_count).toBe("number");
  });

  it("produces a completed JobResult for inference.rag_index", async () => {
    const envelope = makeEnvelope("inference.rag_index", {
      paths: ["/docs/test.txt"],
      collection: "test"
    });
    const result = await executeInferenceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("inference.rag_index");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.collection).toBe("test");
    expect(out.document_count).toBe(1);
  });

  it("produces a completed JobResult for inference.rag_query", async () => {
    await adapter.ragIndex({ paths: ["/doc.txt"], collection: "col" });
    const envelope = makeEnvelope("inference.rag_query", {
      query: "test query",
      collection: "col",
      top_k: 3
    });
    const result = await executeInferenceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("inference.rag_query");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.query).toBe("test query");
    expect(out.collection).toBe("col");
    expect(Array.isArray(out.results)).toBe(true);
  });

  it("produces a completed JobResult for inference.batch_submit", async () => {
    const envelope = makeEnvelope("inference.batch_submit", {
      jobs: [{ messages: [{ role: "user", content: "Test" }] }]
    });
    const result = await executeInferenceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("inference.batch_submit");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.batch_id).toBeTruthy();
    expect(out.job_count).toBe(1);
    expect(out.status).toBe("accepted");
  });

  it("produces a completed JobResult for inference.batch_status", async () => {
    const submitted = await adapter.batchSubmit({
      jobs: [{ messages: [{ role: "user", content: "Test" }] }]
    });
    const batchId = submitted.structured_output.batch_id;

    const envelope = makeEnvelope("inference.batch_status", { batch_id: batchId });
    const result = await executeInferenceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("inference.batch_status");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.batch_id).toBe(batchId);
    expect(typeof out.total_jobs).toBe("number");
  });

  it("falls through unsupported job type to inference.chat", async () => {
    const envelope = makeEnvelope("device.snapshot", {});
    const result = await executeInferenceJob(envelope, adapter);

    // Unknown job types now fall through to inference.chat with a descriptive prompt
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("device.snapshot");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.content).toBe("string");
  });

  it("wraps InferenceWorkerError from adapter correctly", async () => {
    const faultyAdapter = new MockInferenceAdapter();
    faultyAdapter.batchStatus = async () => {
      throw new InferenceWorkerError("BATCH_NOT_FOUND", "Batch not found.", false);
    };

    const envelope = makeEnvelope("inference.batch_status", { batch_id: "missing" });
    const result = await executeInferenceJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BATCH_NOT_FOUND");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps generic Error from adapter into INTERNAL_ERROR", async () => {
    const faultyAdapter = new MockInferenceAdapter();
    (faultyAdapter as unknown as { chat: unknown }).chat = async () => {
      throw new Error("Unexpected failure");
    };

    const envelope = makeEnvelope("inference.chat", {
      messages: [{ role: "user", content: "Hi" }]
    });
    const result = await executeInferenceJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toBe("Unexpected failure");
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("inference.list_models", {});
    const result = await executeInferenceJob(envelope, adapter, {
      workerId: "my-inference-worker"
    });

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("my-inference-worker");
  });
});

// ── createInferenceWorker ─────────────────────────────────────────────────────

describe("createInferenceWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId", () => {
    const worker = createInferenceWorker({ adapter: createMockInferenceAdapter() });
    expect(worker.workerId).toBe("inference-worker");
  });

  it("uses the provided workerId", () => {
    const worker = createInferenceWorker({
      adapter: createMockInferenceAdapter(),
      workerId: "custom-inference-worker"
    });
    expect(worker.workerId).toBe("custom-inference-worker");
  });

  it("executes a chat job via the worker facade", async () => {
    const worker = createInferenceWorker({ adapter: createMockInferenceAdapter() });
    const envelope = makeEnvelope("inference.chat", {
      messages: [{ role: "user", content: "Hello" }],
    });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("inference-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.content).toBe("string");
  });

  it("executes a list_models job via the worker facade", async () => {
    const worker = createInferenceWorker({ adapter: createMockInferenceAdapter() });
    const envelope = makeEnvelope("inference.list_models", { runtime: "ollama" });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.models)).toBe(true);
  });
});
