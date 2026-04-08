/**
 * Retrieval quality benchmark harness.
 *
 * Measures recall@k, precision@k, MRR, and hit-rate for the hybrid
 * retriever across domain-specific query/relevance-doc pairs.
 *
 * Designed for deterministic local runs (no LLM calls needed).
 * Uses the in-memory VectorStore and SparseStore with mock embeddings.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type BenchmarkQuery = {
  query_id: string;
  query: string;
  collection?: string;
  relevant_doc_ids: string[];
};

export type BenchmarkCorpus = {
  domain: string;
  documents: Array<{
    doc_id: string;
    collection: string;
    text: string;
  }>;
  queries: BenchmarkQuery[];
};

export type BenchmarkResult = {
  domain: string;
  total_queries: number;
  recall_at_5: number;
  precision_at_5: number;
  mrr: number;
  hit_rate: number;
  per_query: Array<{
    query_id: string;
    retrieved_ids: string[];
    relevant_ids: string[];
    recall: number;
    precision: number;
    reciprocal_rank: number;
    hit: boolean;
  }>;
};

// ─── Scoring ────────────────────────────────────────────────────────────────

export function scoreBenchmark(
  corpus: BenchmarkCorpus,
  retrieveFn: (query: string, topK: number, collection?: string) => Array<{ docId: string; score: number }>,
  topK = 5,
): BenchmarkResult {
  const perQuery: BenchmarkResult["per_query"] = [];

  for (const q of corpus.queries) {
    const results = retrieveFn(q.query, topK, q.collection);
    // Deduplicate retrieved docIds (multiple chunks from same doc)
    const seen = new Set<string>();
    const retrievedIds: string[] = [];
    for (const r of results) {
      if (!seen.has(r.docId)) {
        seen.add(r.docId);
        retrievedIds.push(r.docId);
      }
      if (retrievedIds.length >= topK) break;
    }
    const relevantSet = new Set(q.relevant_doc_ids);

    const hits = retrievedIds.filter(id => relevantSet.has(id));
    const recall = relevantSet.size === 0 ? 1.0 : hits.length / relevantSet.size;
    const precision = retrievedIds.length === 0 ? 0 : hits.length / retrievedIds.length;

    let reciprocalRank = 0;
    for (let i = 0; i < retrievedIds.length; i++) {
      if (relevantSet.has(retrievedIds[i])) {
        reciprocalRank = 1 / (i + 1);
        break;
      }
    }

    perQuery.push({
      query_id: q.query_id,
      retrieved_ids: retrievedIds,
      relevant_ids: q.relevant_doc_ids,
      recall,
      precision,
      reciprocal_rank: reciprocalRank,
      hit: hits.length > 0,
    });
  }

  const n = perQuery.length || 1;
  return {
    domain: corpus.domain,
    total_queries: corpus.queries.length,
    recall_at_5: perQuery.reduce((s, q) => s + q.recall, 0) / n,
    precision_at_5: perQuery.reduce((s, q) => s + q.precision, 0) / n,
    mrr: perQuery.reduce((s, q) => s + q.reciprocal_rank, 0) / n,
    hit_rate: perQuery.filter(q => q.hit).length / n,
    per_query: perQuery,
  };
}
