import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export type RagCollection = {
  name: string;
  documentCount: number;
  lastIndexedAt: string;
};

export type RagChunk = {
  text: string;
  source: string;
  chunkIndex: number;
};

export type RagResult = {
  text: string;
  score: number;
  source: string;
};

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 64;

function chunkText(text: string, source: string): RagChunk[] {
  const chunks: RagChunk[] = [];
  const words = text.split(/\s+/);
  let chunkIndex = 0;
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    const chunkWords = words.slice(start, end);
    chunks.push({
      text: chunkWords.join(" "),
      source,
      chunkIndex
    });
    chunkIndex++;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    if (start >= words.length) break;
  }

  return chunks;
}

// In-memory store keyed by collection name.
// In production this would be backed by SQLite FTS5 + embeddings.
const ragStore = new Map<
  string,
  { chunks: RagChunk[]; indexedAt: string }
>();

export async function indexDocuments(
  paths: string[],
  collection: string,
): Promise<RagCollection> {
  const allChunks: RagChunk[] = [];

  for (const filePath of paths) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found for RAG indexing: ${filePath}`);
    }

    const content = await readFile(filePath, "utf-8");
    const chunks = chunkText(content, filePath);
    allChunks.push(...chunks);
  }

  const indexedAt = new Date().toISOString();
  ragStore.set(collection, { chunks: allChunks, indexedAt });

  return {
    name: collection,
    documentCount: paths.length,
    lastIndexedAt: indexedAt
  };
}

function simpleScore(query: string, chunk: RagChunk): number {
  const queryTokens = new Set(query.toLowerCase().split(/\s+/));
  const chunkTokens = chunk.text.toLowerCase().split(/\s+/);
  let matches = 0;
  for (const token of chunkTokens) {
    if (queryTokens.has(token)) matches++;
  }
  const tf = matches / Math.max(chunkTokens.length, 1);
  // Normalize to 0-1
  return Math.min(tf * 10, 1);
}

export async function queryRag(
  query: string,
  collection: string,
  topK: number,
): Promise<RagResult[]> {
  const stored = ragStore.get(collection);
  if (!stored || stored.chunks.length === 0) {
    return [];
  }

  const scored = stored.chunks
    .map((chunk) => ({
      text: chunk.text,
      score: simpleScore(query, chunk),
      source: chunk.source
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

export function clearRagCollection(collection: string): void {
  ragStore.delete(collection);
}

export function getRagCollections(): string[] {
  return [...ragStore.keys()];
}
