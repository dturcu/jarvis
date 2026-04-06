import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export type FileHash = {
  path: string;
  hash: string;
  size: number;
  lastModified: string;
};

/**
 * Computes SHA-256 hashes for each file path provided.
 * Paths that cannot be read are silently omitted.
 */
export async function computeFileHashes(paths: string[]): Promise<FileHash[]> {
  const results: FileHash[] = [];

  for (const filePath of paths) {
    try {
      const [contents, stats] = await Promise.all([
        readFile(filePath),
        stat(filePath)
      ]);
      const hash = createHash("sha256").update(contents).digest("hex");
      results.push({
        path: filePath,
        hash,
        size: stats.size,
        lastModified: stats.mtime.toISOString()
      });
    } catch {
      // Skip files that cannot be read
    }
  }

  return results;
}

/**
 * Compares a current set of file hashes against a baseline.
 * Returns categorized lists of added, removed, modified paths plus an unchanged count.
 */
export function compareWithBaseline(
  current: FileHash[],
  baseline: FileHash[],
): { added: string[]; removed: string[]; modified: string[]; unchanged: number } {
  const currentMap = new Map<string, FileHash>(current.map((f) => [f.path, f]));
  const baselineMap = new Map<string, FileHash>(baseline.map((f) => [f.path, f]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  let unchanged = 0;

  for (const [path, currentEntry] of currentMap) {
    const baselineEntry = baselineMap.get(path);
    if (!baselineEntry) {
      added.push(path);
    } else if (currentEntry.hash !== baselineEntry.hash) {
      modified.push(path);
    } else {
      unchanged++;
    }
  }

  for (const [path] of baselineMap) {
    if (!currentMap.has(path)) {
      removed.push(path);
    }
  }

  return { added, removed, modified, unchanged };
}
