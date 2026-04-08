import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { SparseStore } from "@jarvis/agent-framework";
import { scoreBenchmark } from "./benchmark.js";
import type { BenchmarkResult } from "./benchmark.js";
import { ALL_CORPORA, CONTRACT_CORPUS, EVIDENCE_CORPUS, PROPOSAL_CORPUS, REGULATORY_CORPUS } from "./corpora.js";
import os from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";

// ─── Sparse-only benchmark (deterministic, no model needed) ─────────────────

describe("retrieval benchmark harness", () => {
  it("scoreBenchmark computes correct metrics for perfect retrieval", () => {
    const corpus = {
      domain: "test",
      documents: [
        { doc_id: "d1", collection: "test", text: "alpha" },
        { doc_id: "d2", collection: "test", text: "beta" },
      ],
      queries: [
        { query_id: "q1", query: "alpha", relevant_doc_ids: ["d1"] },
      ],
    };
    const result = scoreBenchmark(corpus, () => [{ docId: "d1", score: 1.0 }]);
    expect(result.recall_at_5).toBe(1.0);
    expect(result.precision_at_5).toBe(1.0);
    expect(result.mrr).toBe(1.0);
    expect(result.hit_rate).toBe(1.0);
  });

  it("scoreBenchmark computes correct metrics for no retrieval", () => {
    const corpus = {
      domain: "test",
      documents: [{ doc_id: "d1", collection: "test", text: "alpha" }],
      queries: [{ query_id: "q1", query: "alpha", relevant_doc_ids: ["d1"] }],
    };
    const result = scoreBenchmark(corpus, () => []);
    expect(result.recall_at_5).toBe(0);
    expect(result.precision_at_5).toBe(0);
    expect(result.mrr).toBe(0);
    expect(result.hit_rate).toBe(0);
  });

  it("scoreBenchmark handles partial retrieval", () => {
    const corpus = {
      domain: "test",
      documents: [
        { doc_id: "d1", collection: "test", text: "alpha" },
        { doc_id: "d2", collection: "test", text: "beta" },
      ],
      queries: [
        { query_id: "q1", query: "both", relevant_doc_ids: ["d1", "d2"] },
      ],
    };
    const result = scoreBenchmark(corpus, () => [{ docId: "d1", score: 1.0 }]);
    expect(result.recall_at_5).toBe(0.5);
    expect(result.precision_at_5).toBe(1.0);
    expect(result.mrr).toBe(1.0);
    expect(result.hit_rate).toBe(1.0);
  });
});

// ─── Sparse (BM25) benchmarks per domain ────────────────────────────────────

describe("sparse retrieval benchmarks", () => {
  let sparseStore: SparseStore;
  const dbPath = join(os.tmpdir(), `jarvis-bench-sparse-${Date.now()}.db`);

  beforeAll(() => {
    sparseStore = new SparseStore(dbPath);
    // Index all corpora
    for (const corpus of ALL_CORPORA) {
      for (const doc of corpus.documents) {
        sparseStore.addChunks(doc.doc_id, [
          { id: `${doc.doc_id}-0`, text: doc.text },
        ], doc.collection);
      }
    }
  });

  afterAll(() => {
    sparseStore.close();
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath); } catch { /* best-effort */ }
    }
  });

  function sparseRetrieve(query: string, topK: number, collection?: string) {
    return sparseStore.search(query, topK, collection).map(r => ({
      docId: r.docId,
      score: r.score,
    }));
  }

  // Sparse-only thresholds are baselines.  The hybrid retriever (with dense
  // embeddings) should exceed these significantly.  Target for hybrid: hit_rate >= 0.8.
  it("contracts domain: sparse retrieval produces results", () => {
    const result = scoreBenchmark(CONTRACT_CORPUS, sparseRetrieve);
    expect(result.hit_rate).toBeGreaterThanOrEqual(0.15);
    expect(result.domain).toBe("contracts");
  });

  it("evidence domain: sparse retrieval produces results", () => {
    const result = scoreBenchmark(EVIDENCE_CORPUS, sparseRetrieve);
    expect(result.hit_rate).toBeGreaterThanOrEqual(0.15);
  });

  it("proposals domain: sparse retrieval produces results", () => {
    const result = scoreBenchmark(PROPOSAL_CORPUS, sparseRetrieve);
    expect(result.hit_rate).toBeGreaterThanOrEqual(0.3);
  });

  it("regulatory domain: sparse retrieval produces results", () => {
    const result = scoreBenchmark(REGULATORY_CORPUS, sparseRetrieve);
    expect(result.hit_rate).toBeGreaterThanOrEqual(0.15);
  });

  it("all domains: overall MRR > 0 (baseline established)", () => {
    const results: BenchmarkResult[] = [];
    for (const corpus of ALL_CORPORA) {
      results.push(scoreBenchmark(corpus, sparseRetrieve));
    }
    const totalQueries = results.reduce((s, r) => s + r.total_queries, 0);
    const weightedMrr = results.reduce((s, r) => s + r.mrr * r.total_queries, 0) / totalQueries;
    // Sparse-only baseline.  Hybrid target: MRR >= 0.7
    expect(weightedMrr).toBeGreaterThan(0);
  });
});

// ─── Corpus structural validation ──────────────────────────────────────────

describe("benchmark corpora structural validation", () => {
  for (const corpus of ALL_CORPORA) {
    describe(`${corpus.domain} corpus`, () => {
      it("has at least 4 documents", () => {
        expect(corpus.documents.length).toBeGreaterThanOrEqual(4);
      });

      it("has at least 5 queries", () => {
        expect(corpus.queries.length).toBeGreaterThanOrEqual(5);
      });

      it("all query relevant_doc_ids reference existing documents", () => {
        const docIds = new Set(corpus.documents.map(d => d.doc_id));
        for (const q of corpus.queries) {
          for (const id of q.relevant_doc_ids) {
            expect(docIds.has(id), `${q.query_id} references unknown doc ${id}`).toBe(true);
          }
        }
      });

      it("all documents have non-empty text", () => {
        for (const doc of corpus.documents) {
          expect(doc.text.trim().length).toBeGreaterThan(0);
        }
      });

      it("query_ids are unique", () => {
        const ids = corpus.queries.map(q => q.query_id);
        expect(new Set(ids).size).toBe(ids.length);
      });
    });
  }
});
