import { describe, expect, it, afterEach } from "vitest";
import {
  HybridRetriever,
  VectorStore,
  SparseStore,
  EntityGraph,
  type EmbedFn,
  type ChatFn,
} from "@jarvis/agent-framework";

/** Mock embed function that returns deterministic 384-dim vectors. */
const mockEmbedFn: EmbedFn = async (params) => ({
  embeddings: params.texts.map((text) =>
    Array.from({ length: 384 }, (_, i) => Math.sin(i + text.length) * 0.5),
  ),
});

/** Mock chat function for re-ranking — always returns "7". */
const mockChatFn: ChatFn = async () => ({
  content: "7",
  model: "mock",
  usage: { prompt_tokens: 10, completion_tokens: 1 },
});

describe("HybridRetriever", () => {
  let vectorStore: VectorStore;
  let sparseStore: SparseStore;

  afterEach(() => {
    vectorStore?.close();
    sparseStore?.close();
  });

  function setup() {
    vectorStore = new VectorStore(":memory:");
    sparseStore = new SparseStore(":memory:");

    // Pre-populate both stores with test data
    const docs = [
      { id: "doc-iso", text: "ISO 26262 functional safety standard automotive hazard analysis risk assessment" },
      { id: "doc-aspice", text: "ASPICE process improvement model software development lifecycle quality" },
      { id: "doc-garden", text: "Tomato planting schedule spring summer harvest garden beds" },
      { id: "doc-contract", text: "Master service agreement liability indemnification intellectual property" },
    ];

    for (const doc of docs) {
      // Add to vector store with deterministic embeddings
      const embedding = Array.from({ length: 384 }, (_, i) =>
        Math.sin(i + doc.text.length) * 0.5,
      );
      vectorStore.addChunks(doc.id, [{ text: doc.text, embedding }]);

      // Add to sparse store
      sparseStore.addChunks(doc.id, [{ id: `chunk-${doc.id}`, text: doc.text }]);
    }
  }

  it("retrieves relevant results via hybrid search", async () => {
    setup();
    const retriever = new HybridRetriever({
      vectorStore,
      sparseStore,
      embeddingBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      embedFn: mockEmbedFn,
    });

    const results = await retriever.retrieve("automotive safety standard", 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    // Should find ISO-related content
    const texts = results.map((r) => r.text);
    expect(texts.some((t) => t.includes("ISO 26262") || t.includes("automotive"))).toBe(true);
  });

  it("returns empty for empty query", async () => {
    setup();
    const retriever = new HybridRetriever({
      vectorStore,
      sparseStore,
      embeddingBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      embedFn: mockEmbedFn,
    });

    const results = await retriever.retrieve("", 5);
    expect(results).toHaveLength(0);
  });

  it("respects topK limit", async () => {
    setup();
    const retriever = new HybridRetriever({
      vectorStore,
      sparseStore,
      embeddingBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      embedFn: mockEmbedFn,
    });

    const results = await retriever.retrieve("safety", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("applies cross-encoder re-ranking when configured", async () => {
    setup();
    const retriever = new HybridRetriever({
      vectorStore,
      sparseStore,
      embeddingBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      embedFn: mockEmbedFn,
      rerankerBaseUrl: "http://localhost:11434",
      rerankerModel: "bge-reranker-base",
      chatFn: mockChatFn,
    });

    const results = await retriever.retrieve("automotive safety", 3);

    expect(results.length).toBeGreaterThan(0);
    // Re-ranked results should have rerankScore
    const reranked = results.filter((r) => r.rerankScore !== undefined);
    expect(reranked.length).toBeGreaterThan(0);
  });

  it("applies entity graph boost", async () => {
    setup();
    const entityGraph = new EntityGraph();

    // Create an entity matching a query term and link to a document entity
    const contactEntity = entityGraph.upsertEntity(
      { entity_type: "contact", name: "automotive", attributes: {} },
      "test-agent",
    );
    const docEntity = entityGraph.upsertEntity(
      { entity_type: "document", name: "doc-iso", canonical_key: "doc-iso", attributes: {} },
      "test-agent",
    );
    entityGraph.addRelation(contactEntity.entity_id, docEntity.entity_id, "referenced_in");

    const retriever = new HybridRetriever({
      vectorStore,
      sparseStore,
      embeddingBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      embedFn: mockEmbedFn,
      entityGraph,
    });

    const results = await retriever.retrieve("automotive", 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it("results have required fields", async () => {
    setup();
    const retriever = new HybridRetriever({
      vectorStore,
      sparseStore,
      embeddingBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      embedFn: mockEmbedFn,
    });

    const results = await retriever.retrieve("safety", 5);

    for (const result of results) {
      expect(typeof result.text).toBe("string");
      expect(result.text.length).toBeGreaterThan(0);
      expect(typeof result.score).toBe("number");
      expect(result.score).toBeGreaterThan(0);
      expect(typeof result.docId).toBe("string");
    }
  });

  it("filters by collection when sparse store has collection data", async () => {
    vectorStore = new VectorStore(":memory:");
    sparseStore = new SparseStore(":memory:");

    // Add with collection metadata
    const emb = Array.from({ length: 384 }, () => 0.1);
    vectorStore.addChunks("doc-iso", [{ text: "safety standard", embedding: emb }]);
    vectorStore.addChunks("doc-garden", [{ text: "tomato planting", embedding: emb }]);
    sparseStore.addChunks("doc-iso", [{ id: "c1", text: "safety standard" }], "iso26262");
    sparseStore.addChunks("doc-garden", [{ id: "c2", text: "tomato planting" }], "garden");

    const retriever = new HybridRetriever({
      vectorStore,
      sparseStore,
      embeddingBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      embedFn: mockEmbedFn,
    });

    const results = await retriever.retrieve("safety", 5, "iso26262");
    expect(results.length).toBeGreaterThan(0);
  });
});
