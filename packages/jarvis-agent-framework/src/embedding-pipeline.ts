import { randomUUID } from "node:crypto";
import { chunkText } from "./vector-store.js";
import type { VectorStore } from "./vector-store.js";
import type { SparseStore } from "./sparse-store.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Embedding function signature — injected by the caller so that
 * agent-framework does not depend on @jarvis/inference directly.
 */
export type EmbedFn = (params: {
  baseUrl: string;
  model: string;
  texts: string[];
}) => Promise<{ embeddings: number[][] }>;

export type EmbeddingPipelineConfig = {
  vectorStore: VectorStore;
  sparseStore: SparseStore;
  /** Ollama, LM Studio, or llama.cpp base URL (e.g. "http://localhost:11434") */
  embeddingBaseUrl: string;
  /** Embedding model ID (e.g. "nomic-embed-text") */
  embeddingModel: string;
  /** Embedding function — pass `embedTexts` from @jarvis/inference */
  embedFn: EmbedFn;
  /** Target chunk size in tokens (default 500) */
  chunkSize?: number;
  /** Token overlap between chunks (default 50) */
  chunkOverlap?: number;
  /** Number of texts to embed per HTTP request (default 32) */
  batchSize?: number;
};

export type IngestResult = {
  docId: string;
  chunkCount: number;
};

// ─── EmbeddingPipeline ──────────────────────────────────────────────────────

/**
 * Connects the chunking, embedding, and dual-store (dense + sparse) pipeline.
 *
 * On ingest, text is:
 *   1. Split into chunks via {@link chunkText}
 *   2. Batch-embedded via the injected embedding function
 *   3. Stored in both the {@link VectorStore} (dense cosine) and
 *      {@link SparseStore} (FTS5 BM25) with matching chunk IDs so that
 *      reciprocal rank fusion can correlate results across both stores.
 */
export class EmbeddingPipeline {
  private vectorStore: VectorStore;
  private sparseStore: SparseStore;
  private baseUrl: string;
  private model: string;
  private embedFn: EmbedFn;
  private chunkSize: number;
  private chunkOverlap: number;
  private batchSize: number;

  constructor(config: EmbeddingPipelineConfig) {
    this.vectorStore = config.vectorStore;
    this.sparseStore = config.sparseStore;
    this.baseUrl = config.embeddingBaseUrl;
    this.model = config.embeddingModel;
    this.embedFn = config.embedFn;
    this.chunkSize = config.chunkSize ?? 500;
    this.chunkOverlap = config.chunkOverlap ?? 50;
    this.batchSize = config.batchSize ?? 32;
  }

  /**
   * Chunk, embed, and store a document in both dense and sparse stores.
   *
   * Chunk IDs are shared between stores so reciprocal rank fusion can
   * correlate dense and sparse results by text identity.
   */
  async ingestDocument(
    docId: string,
    text: string,
    collection?: string,
  ): Promise<IngestResult> {
    const chunks = chunkText(text, this.chunkSize, this.chunkOverlap);
    if (chunks.length === 0) {
      return { docId, chunkCount: 0 };
    }

    // Generate stable chunk IDs shared between both stores
    const chunkIds = chunks.map(() => randomUUID());

    // Batch-embed all chunks
    const embeddings = await this.batchEmbed(chunks);

    // Store in dense (vector) store
    const vectorChunks = chunks.map((text, i) => ({
      text,
      embedding: embeddings[i]!,
    }));
    this.vectorStore.addChunks(docId, vectorChunks);

    // Store in sparse (BM25) store with matching chunk IDs
    const sparseChunks = chunks.map((text, i) => ({
      id: chunkIds[i]!,
      text,
    }));
    this.sparseStore.addChunks(docId, sparseChunks, collection);

    return { docId, chunkCount: chunks.length };
  }

  /**
   * Remove a document from both stores.
   */
  deleteDocument(docId: string): void {
    this.vectorStore.deleteChunks(docId);
    this.sparseStore.deleteChunks(docId);
  }

  /**
   * Re-embed and re-index an entire collection.
   * Deletes existing chunks and re-ingests all documents.
   */
  async reindexCollection(
    docs: Array<{ docId: string; text: string }>,
    collection: string,
  ): Promise<{ totalChunks: number }> {
    let totalChunks = 0;
    for (const doc of docs) {
      this.deleteDocument(doc.docId);
      const result = await this.ingestDocument(doc.docId, doc.text, collection);
      totalChunks += result.chunkCount;
    }
    return { totalChunks };
  }

  /**
   * Embed texts in batches to avoid overloading the inference runtime.
   */
  private async batchEmbed(texts: string[]): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const result = await this.embedFn({
        baseUrl: this.baseUrl,
        model: this.model,
        texts: batch,
      });
      allEmbeddings.push(...result.embeddings);
    }

    return allEmbeddings;
  }
}
