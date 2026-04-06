import { VectorStore, chunkText } from "@jarvis/agent-framework";
import type { WorkerRegistry } from "./worker-registry.js";
import { buildEnvelope } from "./worker-registry.js";
import type { Logger } from "./logger.js";

/**
 * RAG pipeline: index documents into the vector store and query for
 * semantically relevant chunks using embeddings.
 *
 * Uses the inference worker's `embed()` capability (via the worker registry)
 * to generate embedding vectors.
 */
export class RagPipeline {
  constructor(
    private vectorStore: VectorStore,
    private registry: WorkerRegistry,
    private logger: Logger,
  ) {}

  /**
   * Index a document: chunk the text, embed each chunk, and store in the vector store.
   *
   * @param docId - Unique document identifier (matches knowledge store doc_id)
   * @param text - Full document text to chunk and embed
   * @returns The number of chunks indexed
   */
  async indexDocument(docId: string, text: string): Promise<number> {
    // Remove existing chunks for this doc (re-index)
    this.vectorStore.deleteChunks(docId);

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      this.logger.debug(`No chunks generated for doc ${docId} — empty text`);
      return 0;
    }

    this.logger.debug(
      `Indexing doc ${docId}: ${chunks.length} chunks`,
    );

    // Embed all chunks in a single batch call
    const embeddings = await this.embed(chunks);

    // Pair chunks with their embeddings and store
    const paired = chunks.map((text, i) => ({
      text,
      embedding: embeddings[i],
    }));

    this.vectorStore.addChunks(docId, paired);

    this.logger.debug(
      `Indexed doc ${docId}: ${paired.length} chunks stored`,
    );

    return paired.length;
  }

  /**
   * Query the vector store for chunks relevant to a natural-language query.
   *
   * @param query - The search query in natural language
   * @param topK - Number of results to return (default: 5)
   * @param collection - Optional collection filter (requires documents table)
   * @returns Ranked list of relevant text chunks with scores
   */
  async query(
    query: string,
    topK = 5,
    collection?: string,
  ): Promise<Array<{ text: string; score: number; docId: string }>> {
    // Embed the query
    const [queryEmbedding] = await this.embed([query]);

    // Search the vector store
    const results = this.vectorStore.search(queryEmbedding, topK, collection);

    this.logger.debug(
      `RAG query "${query.slice(0, 60)}..." returned ${results.length} results`,
    );

    return results;
  }

  /**
   * Call the inference worker's embed endpoint to get embedding vectors.
   */
  private async embed(texts: string[]): Promise<number[][]> {
    const envelope = buildEnvelope("inference.embed", { texts });
    const result = await this.registry.executeJob(envelope);

    if (result.status === "failed") {
      throw new Error(
        `Embedding failed: ${result.error?.message ?? result.summary}`,
      );
    }

    const output = result.structured_output as
      | { embeddings: number[][] }
      | undefined;

    if (!output?.embeddings || output.embeddings.length !== texts.length) {
      throw new Error(
        `Embedding returned ${output?.embeddings?.length ?? 0} vectors for ${texts.length} texts`,
      );
    }

    return output.embeddings;
  }
}
