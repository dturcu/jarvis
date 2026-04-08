import { describe, expect, it, afterEach } from "vitest";
import { EmbeddingPipeline, VectorStore, SparseStore, type EmbedFn } from "@jarvis/agent-framework";

/** Mock embed function that returns deterministic 384-dim vectors. */
const mockEmbedFn: EmbedFn = async (params) => ({
  embeddings: params.texts.map((_, i) =>
    Array.from({ length: 384 }, (_, j) => Math.sin(j + i) * 0.5),
  ),
});

describe("EmbeddingPipeline", () => {
  let vectorStore: VectorStore;
  let sparseStore: SparseStore;
  let pipeline: EmbeddingPipeline;

  afterEach(() => {
    vectorStore?.close();
    sparseStore?.close();
  });

  function setup(opts?: { batchSize?: number }) {
    vectorStore = new VectorStore(":memory:");
    sparseStore = new SparseStore(":memory:");
    pipeline = new EmbeddingPipeline({
      vectorStore,
      sparseStore,
      embeddingBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      embedFn: mockEmbedFn,
      batchSize: opts?.batchSize ?? 32,
    });
  }

  it("ingests a document into both stores", async () => {
    setup();
    const text = "ISO 26262 is the functional safety standard for automotive systems. " +
      "It covers the full safety lifecycle including hazard analysis and risk assessment. " +
      "ASPICE is a process improvement model used in automotive software development.";

    const result = await pipeline.ingestDocument("doc-1", text, "iso26262");

    expect(result.docId).toBe("doc-1");
    expect(result.chunkCount).toBeGreaterThan(0);

    // Verify vector store has chunks
    expect(vectorStore.getChunkCount()).toBe(result.chunkCount);

    // Verify sparse store has searchable chunks
    const sparseResults = sparseStore.search("automotive safety", 5);
    expect(sparseResults.length).toBeGreaterThan(0);
  });

  it("returns zero chunks for empty text", async () => {
    setup();
    const result = await pipeline.ingestDocument("doc-empty", "");
    expect(result.chunkCount).toBe(0);
    expect(vectorStore.getChunkCount()).toBe(0);
  });

  it("returns zero chunks for whitespace-only text", async () => {
    setup();
    const result = await pipeline.ingestDocument("doc-ws", "   \n\n  ");
    expect(result.chunkCount).toBe(0);
  });

  it("deletes document from both stores", async () => {
    setup();
    await pipeline.ingestDocument("doc-1", "Some test content about automotive safety standards.");

    expect(vectorStore.getChunkCount()).toBeGreaterThan(0);

    pipeline.deleteDocument("doc-1");

    expect(vectorStore.getChunkCount()).toBe(0);
    expect(sparseStore.search("automotive", 5)).toHaveLength(0);
  });

  it("handles batch embedding for large documents", async () => {
    setup({ batchSize: 2 });

    // Generate enough text for multiple chunks
    const sentences = Array.from({ length: 50 }, (_, i) =>
      `Sentence ${i} discusses automotive safety standard ISO 26262 Part ${i % 12 + 1}.`
    );
    const text = sentences.join(" ");

    const result = await pipeline.ingestDocument("doc-large", text);

    expect(result.chunkCount).toBeGreaterThan(1);
    expect(vectorStore.getChunkCount()).toBe(result.chunkCount);
  });

  it("reindexes a collection", async () => {
    setup();
    await pipeline.ingestDocument("doc-1", "First document about safety.");
    await pipeline.ingestDocument("doc-2", "Second document about compliance.");

    const initialCount = vectorStore.getChunkCount();
    expect(initialCount).toBeGreaterThan(0);

    const result = await pipeline.reindexCollection(
      [
        { docId: "doc-1", text: "Updated first document about hazard analysis." },
        { docId: "doc-2", text: "Updated second document about risk assessment." },
      ],
      "iso26262",
    );

    expect(result.totalChunks).toBeGreaterThan(0);
  });

  it("populates sparse store with collection metadata", async () => {
    setup();
    await pipeline.ingestDocument("doc-a", "Content about functional safety.", "iso26262");
    await pipeline.ingestDocument("doc-b", "Content about garden planting.", "garden");

    const isoResults = sparseStore.search("safety", 5, "iso26262");
    const gardenResults = sparseStore.search("planting", 5, "garden");

    expect(isoResults.length).toBeGreaterThan(0);
    expect(gardenResults.length).toBeGreaterThan(0);

    // Cross-collection should not match
    expect(sparseStore.search("planting", 5, "iso26262")).toHaveLength(0);
  });
});
