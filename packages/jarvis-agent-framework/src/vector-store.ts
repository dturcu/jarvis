import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite-backed vector store for RAG embeddings.
 *
 * Stores document chunks with their embedding vectors. Search is brute-force
 * cosine similarity computed in JS — suitable for up to ~50k chunks. For
 * larger corpora, swap in a dedicated vector DB (pgvector, Qdrant, etc.).
 *
 * Embeddings are serialized as Float32Array buffers for compact storage.
 */
export class VectorStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_chunks (
        chunk_id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        chunk_index INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_chunks_doc ON embedding_chunks(doc_id)",
    );
  }

  /**
   * Store pre-embedded chunks for a document.
   */
  addChunks(
    docId: string,
    chunks: Array<{ text: string; embedding: number[] }>,
  ): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO embedding_chunks (chunk_id, doc_id, chunk_text, embedding, chunk_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      stmt.run(
        randomUUID(),
        docId,
        chunk.text,
        serializeEmbedding(chunk.embedding),
        i,
        now,
      );
    }
  }

  /**
   * Search for the most similar chunks to a query embedding.
   *
   * Loads all chunks (optionally filtered by collection via the documents table),
   * computes cosine similarity in JS, and returns the top-k results.
   *
   * @param queryEmbedding - The embedding vector of the search query
   * @param topK - Number of results to return (default: 5)
   * @param collection - If provided, only search chunks whose doc_id exists in
   *                     the documents table with this collection value
   */
  search(
    queryEmbedding: number[],
    topK = 5,
    collection?: string,
  ): Array<{ text: string; score: number; docId: string }> {
    let rows: Array<Record<string, unknown>>;

    if (collection) {
      // Join with documents table to filter by collection
      try {
        rows = this.db
          .prepare(
            `
          SELECT ec.chunk_text, ec.embedding, ec.doc_id
          FROM embedding_chunks ec
          JOIN documents d ON d.doc_id = ec.doc_id
          WHERE d.collection = ?
        `,
          )
          .all(collection) as Array<Record<string, unknown>>;
      } catch {
        // documents table may not exist in this database — fall back to unfiltered
        rows = this.db
          .prepare("SELECT chunk_text, embedding, doc_id FROM embedding_chunks")
          .all() as Array<Record<string, unknown>>;
      }
    } else {
      rows = this.db
        .prepare("SELECT chunk_text, embedding, doc_id FROM embedding_chunks")
        .all() as Array<Record<string, unknown>>;
    }

    // Score all chunks
    const scored: Array<{ text: string; score: number; docId: string }> = [];

    for (const row of rows) {
      const storedEmbedding = deserializeEmbedding(
        row.embedding as Buffer,
      );
      const score = cosineSimilarity(queryEmbedding, storedEmbedding);
      scored.push({
        text: row.chunk_text as string,
        score,
        docId: row.doc_id as string,
      });
    }

    // Sort by score descending and return top-k
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Delete all chunks for a document.
   */
  deleteChunks(docId: string): void {
    this.db
      .prepare("DELETE FROM embedding_chunks WHERE doc_id = ?")
      .run(docId);
  }

  /**
   * Total number of stored chunks across all documents.
   */
  getChunkCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM embedding_chunks")
      .get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    try {
      this.db.close();
    } catch {
      // best-effort
    }
  }
}

// ─── Text chunking ───────────────────────────────────────────────────────────

/**
 * Split text into chunks of approximately `maxTokens` tokens with overlap.
 *
 * Uses a simple word-count heuristic (~0.75 words per token) and splits on
 * paragraph / sentence boundaries when possible.
 *
 * @param text - The full text to chunk
 * @param maxTokens - Target chunk size in tokens (default: 500)
 * @param overlap - Number of overlapping tokens between chunks (default: 50)
 */
export function chunkText(
  text: string,
  maxTokens = 500,
  overlap = 50,
): string[] {
  if (!text || text.trim().length === 0) return [];

  // Approximate tokens → words (rough: 1 token ~ 0.75 words)
  const maxWords = Math.max(10, Math.floor(maxTokens * 0.75));
  const overlapWords = Math.max(0, Math.floor(overlap * 0.75));

  // Split into paragraphs first, then sentences within paragraphs
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const sentences: string[] = [];

  for (const para of paragraphs) {
    // Split on sentence boundaries (period/question/exclamation followed by space or EOL)
    const parts = para.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    sentences.push(...parts);
  }

  // Group sentences into chunks of ~maxWords
  const chunks: string[] = [];
  let currentWords: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter((w) => w.length > 0);

    if (currentWordCount + words.length > maxWords && currentWordCount > 0) {
      // Flush current chunk
      chunks.push(currentWords.join(" "));

      // Keep overlap from the end of the current chunk
      if (overlapWords > 0 && currentWords.length > overlapWords) {
        const overlapSlice = currentWords.slice(-overlapWords);
        currentWords = [...overlapSlice];
        currentWordCount = overlapSlice.length;
      } else {
        currentWords = [];
        currentWordCount = 0;
      }
    }

    currentWords.push(...words);
    currentWordCount += words.length;
  }

  // Flush remaining
  if (currentWords.length > 0) {
    chunks.push(currentWords.join(" "));
  }

  return chunks;
}

// ─── Vector math ─────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 * Returns a value in [-1, 1] where 1 means identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }
  if (a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// ─── Serialization ───────────────────────────────────────────────────────────

/**
 * Serialize a number[] embedding to a compact Buffer using Float32Array.
 * Each float occupies 4 bytes, so a 384-dim embedding = 1536 bytes.
 */
function serializeEmbedding(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

/**
 * Deserialize a Buffer back to a number[] embedding.
 */
function deserializeEmbedding(buffer: Buffer): number[] {
  // Ensure proper alignment: copy to a new ArrayBuffer
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buffer.length; i++) {
    view[i] = buffer[i]!;
  }
  const float32 = new Float32Array(arrayBuffer);
  return Array.from(float32);
}
