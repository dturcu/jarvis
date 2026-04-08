import { DatabaseSync } from "node:sqlite";

/**
 * SQLite FTS5-backed sparse (keyword) store for hybrid RAG.
 *
 * Provides BM25-ranked full-text search to complement the dense vector search
 * in {@link VectorStore}. The two result sets are combined via reciprocal rank
 * fusion (RRF) in the RAG pipeline.
 */
export class SparseStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks
      USING fts5(chunk_id, doc_id UNINDEXED, chunk_text, collection UNINDEXED)
    `);
  }

  /**
   * Index chunks for a document into the FTS5 table.
   */
  addChunks(
    docId: string,
    chunks: Array<{ id: string; text: string }>,
    collection?: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO fts_chunks (chunk_id, doc_id, chunk_text, collection)
      VALUES (?, ?, ?, ?)
    `);
    for (const chunk of chunks) {
      stmt.run(chunk.id, docId, chunk.text, collection ?? "");
    }
  }

  /**
   * BM25-ranked full-text search.
   *
   * @param query - Natural language search query (FTS5 will tokenize)
   * @param topK - Maximum results to return
   * @param collection - Optional collection filter
   * @returns Results scored by BM25 relevance (lower = more relevant in FTS5)
   */
  search(
    query: string,
    topK = 5,
    collection?: string,
  ): Array<{ text: string; score: number; docId: string }> {
    if (!query.trim()) return [];

    // Escape FTS5 special characters and convert to OR query for flexibility
    const safeQuery = query
      .replace(/['"*(){}[\]:^~!]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .join(" OR ");

    if (!safeQuery) return [];

    try {
      const sql = collection
        ? `SELECT chunk_text, doc_id, bm25(fts_chunks) AS score
           FROM fts_chunks
           WHERE fts_chunks MATCH ? AND collection = ?
           ORDER BY score
           LIMIT ?`
        : `SELECT chunk_text, doc_id, bm25(fts_chunks) AS score
           FROM fts_chunks
           WHERE fts_chunks MATCH ?
           ORDER BY score
           LIMIT ?`;

      const rows = collection
        ? (this.db.prepare(sql).all(safeQuery, collection, topK) as Array<Record<string, unknown>>)
        : (this.db.prepare(sql).all(safeQuery, topK) as Array<Record<string, unknown>>);

      // FTS5 bm25() returns negative scores (more negative = better match).
      // Normalize to positive so higher = better, matching VectorStore convention.
      return rows.map((row) => ({
        text: row.chunk_text as string,
        score: -(row.score as number),
        docId: row.doc_id as string,
      }));
    } catch {
      // FTS5 MATCH can throw on malformed queries — return empty
      return [];
    }
  }

  /**
   * Remove all chunks for a document.
   */
  deleteChunks(docId: string): void {
    this.db.prepare("DELETE FROM fts_chunks WHERE doc_id = ?").run(docId);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // best-effort
    }
  }
}

// ─── Reciprocal Rank Fusion ─────────────────────────────────────────────────

/**
 * Combine dense (vector) and sparse (BM25) ranked result lists using
 * reciprocal rank fusion (RRF). Each result's fused score is the sum of
 * `1 / (k + rank)` across the lists in which it appears.
 *
 * @param dense  - Results from vector similarity search (sorted by score desc)
 * @param sparse - Results from BM25 search (sorted by score desc)
 * @param k      - Smoothing constant (default 60, standard value)
 * @param topK   - Number of fused results to return
 */
export function reciprocalRankFusion(
  dense: Array<{ text: string; score: number; docId: string }>,
  sparse: Array<{ text: string; score: number; docId: string }>,
  k = 60,
  topK = 5,
): Array<{ text: string; score: number; docId: string }> {
  const fused = new Map<string, { text: string; score: number; docId: string }>();

  for (let rank = 0; rank < dense.length; rank++) {
    const item = dense[rank]!;
    const key = `${item.docId}::${item.text.slice(0, 80)}`;
    const existing = fused.get(key);
    const rrfScore = 1 / (k + rank + 1);
    fused.set(key, {
      text: item.text,
      score: (existing?.score ?? 0) + rrfScore,
      docId: item.docId,
    });
  }

  for (let rank = 0; rank < sparse.length; rank++) {
    const item = sparse[rank]!;
    const key = `${item.docId}::${item.text.slice(0, 80)}`;
    const existing = fused.get(key);
    const rrfScore = 1 / (k + rank + 1);
    fused.set(key, {
      text: item.text,
      score: (existing?.score ?? 0) + rrfScore,
      docId: item.docId,
    });
  }

  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
