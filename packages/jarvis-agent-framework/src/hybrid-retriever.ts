import type { VectorStore } from "./vector-store.js";
import type { SparseStore } from "./sparse-store.js";
import { reciprocalRankFusion } from "./sparse-store.js";
import type { EntityGraph } from "./entity-graph.js";
import type { EmbedFn } from "./embedding-pipeline.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Chat completion function signature — injected by the caller so that
 * agent-framework does not depend on @jarvis/inference directly.
 */
export type ChatFn = (params: {
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ content: string; model: string; usage: { prompt_tokens: number; completion_tokens: number } }>;

/** Wiki retrieval source for curated synthesized knowledge (Epic 10). */
export type WikiRetrievalSource = {
  query(queryText: string, limit?: number): Promise<Array<{
    page_id: string;
    title: string;
    snippet: string;
    relevance_score: number;
  }>>;
};

export type HybridRetrieverConfig = {
  vectorStore: VectorStore;
  sparseStore: SparseStore;
  /** Ollama or LM Studio base URL */
  embeddingBaseUrl: string;
  /** Embedding model ID (e.g. "nomic-embed-text") */
  embeddingModel: string;
  /** Embedding function — pass `embedTexts` from @jarvis/inference */
  embedFn: EmbedFn;
  /** Optional cross-encoder re-ranking endpoint */
  rerankerBaseUrl?: string;
  /** Optional re-ranker model ID (e.g. "bge-reranker-base") */
  rerankerModel?: string;
  /** Chat completion function for re-ranking — pass `chatCompletion` from @jarvis/inference */
  chatFn?: ChatFn;
  /** RRF smoothing constant (default 60) */
  rrfK?: number;
  /** Optional entity graph for graph-augmented retrieval */
  entityGraph?: EntityGraph;
  /** Optional wiki retrieval source for curated knowledge (Epic 10). */
  wikiSource?: WikiRetrievalSource;
  /** Weight for wiki results in fusion (0-1, default 0). 0 = disabled. */
  wikiWeight?: number;
};

export type RetrievalResult = {
  text: string;
  score: number;
  docId: string;
  /** Cross-encoder re-rank score, if re-ranking was applied */
  rerankScore?: number;
};

// ─── HybridRetriever ────────────────────────────────────────────────────────

/**
 * Hybrid retriever combining dense vector search, sparse BM25 search,
 * reciprocal rank fusion, optional cross-encoder re-ranking, and optional
 * entity-graph neighbourhood boosting.
 *
 * Retrieve flow:
 *   1. Embed query via the local embedding model
 *   2. Dense search (VectorStore cosine similarity)
 *   3. Sparse search (SparseStore FTS5 BM25)
 *   4. Reciprocal rank fusion (RRF)
 *   5. Optional: cross-encoder re-ranking via LLM
 *   6. Optional: entity graph neighbourhood boost
 */
export class HybridRetriever {
  private vectorStore: VectorStore;
  private sparseStore: SparseStore;
  private embeddingBaseUrl: string;
  private embeddingModel: string;
  private embedFn: EmbedFn;
  private chatFn?: ChatFn;
  private rerankerBaseUrl?: string;
  private rerankerModel?: string;
  private rrfK: number;
  private entityGraph?: EntityGraph;
  private wikiSource?: WikiRetrievalSource;
  private wikiWeight: number;

  constructor(config: HybridRetrieverConfig) {
    this.vectorStore = config.vectorStore;
    this.sparseStore = config.sparseStore;
    this.embeddingBaseUrl = config.embeddingBaseUrl;
    this.embeddingModel = config.embeddingModel;
    this.embedFn = config.embedFn;
    this.chatFn = config.chatFn;
    this.rerankerBaseUrl = config.rerankerBaseUrl;
    this.rerankerModel = config.rerankerModel;
    this.rrfK = config.rrfK ?? 60;
    this.entityGraph = config.entityGraph;
    this.wikiSource = config.wikiSource;
    this.wikiWeight = config.wikiWeight ?? 0;
  }

  /**
   * Execute hybrid retrieval: dense + sparse -> RRF -> optional re-rank.
   *
   * @param query - Natural language search query
   * @param topK - Number of results to return (default 5)
   * @param collection - Optional collection filter
   */
  async retrieve(
    query: string,
    topK = 5,
    collection?: string,
  ): Promise<RetrievalResult[]> {
    if (!query.trim()) return [];

    // Wider candidate pool for fusion
    const candidateK = Math.max(topK * 4, 20);

    // Step 1: Embed the query
    const embedResult = await this.embedFn({
      baseUrl: this.embeddingBaseUrl,
      model: this.embeddingModel,
      texts: [query],
    });
    const queryEmbedding = embedResult.embeddings[0];
    if (!queryEmbedding || queryEmbedding.length === 0) {
      // Fallback to sparse-only if embedding fails
      return this.sparseStore
        .search(query, topK, collection)
        .map((r) => ({ ...r, rerankScore: undefined }));
    }

    // Step 2: Dense search
    const denseResults = this.vectorStore.search(
      queryEmbedding,
      candidateK,
      collection,
    );

    // Step 3: Sparse BM25 search
    const sparseResults = this.sparseStore.search(query, candidateK, collection);

    // Step 4: Reciprocal rank fusion
    const fusedTopK = Math.max(topK * 2, 10);
    let fused = reciprocalRankFusion(
      denseResults,
      sparseResults,
      this.rrfK,
      fusedTopK,
    );

    // Step 5: Optional entity graph boost
    if (this.entityGraph) {
      fused = this.applyGraphBoost(fused, query);
    }

    // Step 5b: Optional wiki retrieval (Epic 10)
    if (this.wikiSource && this.wikiWeight > 0) {
      try {
        const wikiResults = await this.wikiSource.query(query, topK);
        if (wikiResults.length > 0) {
          const wikiAsRetrieval = wikiResults.map((w) => ({
            text: `[Wiki: ${w.title}] ${w.snippet}`,
            score: w.relevance_score * this.wikiWeight,
            docId: w.page_id,
          }));
          // Merge wiki results with fused results, re-sort by score
          fused = [...fused, ...wikiAsRetrieval]
            .sort((a, b) => b.score - a.score)
            .slice(0, fusedTopK);
        }
      } catch {
        // Wiki unavailable — continue with local results only
      }
    }

    // Step 6: Optional cross-encoder re-ranking
    if (this.rerankerBaseUrl && this.rerankerModel && this.chatFn && fused.length > 1) {
      return this.crossEncoderRerank(query, fused, topK);
    }

    return fused.slice(0, topK).map((r) => ({
      ...r,
      rerankScore: undefined,
    }));
  }

  /**
   * Cross-encoder re-ranking via LLM relevance scoring.
   *
   * Sends each candidate passage to the LLM with a simple relevance prompt
   * and parses the score. This is cheaper than a true cross-encoder but
   * effective for small candidate sets (< 20).
   */
  private async crossEncoderRerank(
    query: string,
    candidates: Array<{ text: string; score: number; docId: string }>,
    topK: number,
  ): Promise<RetrievalResult[]> {
    const scored: RetrievalResult[] = [];

    for (const candidate of candidates) {
      try {
        const result = await this.chatFn!({
          baseUrl: this.rerankerBaseUrl!,
          model: this.rerankerModel!,
          messages: [
            {
              role: "system",
              content:
                "You are a relevance scorer. Given a query and a passage, output ONLY a number from 0 to 10 indicating how relevant the passage is to the query. 0 = completely irrelevant, 10 = perfectly relevant. Output ONLY the number.",
            },
            {
              role: "user",
              content: `Query: ${query}\n\nPassage: ${candidate.text.slice(0, 500)}`,
            },
          ],
          temperature: 0,
          maxTokens: 5,
        });

        const rerankScore = parseFloat(result.content.trim());
        scored.push({
          text: candidate.text,
          score: candidate.score,
          docId: candidate.docId,
          rerankScore: Number.isFinite(rerankScore) ? rerankScore : 5,
        });
      } catch {
        // If re-ranking fails for one candidate, keep the RRF score
        scored.push({
          text: candidate.text,
          score: candidate.score,
          docId: candidate.docId,
          rerankScore: undefined,
        });
      }
    }

    // Sort by re-rank score (higher = better), fall back to RRF score
    scored.sort((a, b) => {
      const sa = a.rerankScore ?? a.score * 10;
      const sb = b.rerankScore ?? b.score * 10;
      return sb - sa;
    });

    return scored.slice(0, topK);
  }

  /**
   * Boost documents that are connected to entities mentioned in the query.
   *
   * Scans the query for entity names, finds neighbours in the entity graph,
   * and applies a small score boost to chunks from related documents.
   */
  private applyGraphBoost(
    results: Array<{ text: string; score: number; docId: string }>,
    query: string,
  ): Array<{ text: string; score: number; docId: string }> {
    if (!this.entityGraph) return results;

    const queryLower = query.toLowerCase();
    const relatedDocIds = new Set<string>();

    // Find entities whose names appear in the query
    for (const entity of this.entityGraph.listEntities()) {
      if (queryLower.includes(entity.name.toLowerCase())) {
        // Get neighbouring documents
        const { neighbors } = this.entityGraph.neighborhood(entity.entity_id);
        for (const neighbor of neighbors) {
          if (neighbor.entity_type === "document") {
            relatedDocIds.add(neighbor.entity_id);
          }
        }
      }
    }

    if (relatedDocIds.size === 0) return results;

    // Boost score for related documents (1.2x multiplier)
    const GRAPH_BOOST = 1.2;
    return results.map((r) => ({
      ...r,
      score: relatedDocIds.has(r.docId) ? r.score * GRAPH_BOOST : r.score,
    }));
  }
}
