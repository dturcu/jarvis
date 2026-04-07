import fs from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { JobEnvelope, JobResult } from "@jarvis/shared";
import { validatePath, type FilesystemPolicy } from "./filesystem-policy.js";

/**
 * Thin bridge that wraps Node.js fs operations into the worker execute pattern
 * for files.* job types. When a FilesystemPolicy is provided, all paths are
 * validated before any fs operation.
 */
export function createFilesWorkerBridge(policy?: FilesystemPolicy): { execute: (envelope: JobEnvelope) => Promise<JobResult> } {
  /** Validate a path against the filesystem policy. Returns a failed JobResult on violation. */
  function checkPath(absPath: string, base: Record<string, unknown>): JobResult | null {
    if (!policy) return null;

    // Check metadata.approved_roots for per-job scope extensions
    const approvedRoots = (base as any)._envelope?.metadata?.approved_roots as string[] | undefined;
    const effectivePolicy = approvedRoots
      ? { ...policy, allowed_roots: [...policy.allowed_roots, ...approvedRoots] }
      : policy;

    const result = validatePath(absPath, effectivePolicy);
    if (!result.allowed) {
      return {
        contract_version: "jarvis.v1",
        job_id: (base as any)._job_id ?? "",
        job_type: (base as any)._job_type ?? "",
        status: "failed",
        summary: result.reason ?? "Filesystem policy violation",
        attempt: (base as any)._attempt ?? 1,
        error: { code: "FILESYSTEM_POLICY_VIOLATION", message: result.reason ?? "Path denied by policy", retryable: false },
      };
    }
    return null;
  }

  return {
    async execute(envelope: JobEnvelope): Promise<JobResult> {
      const base: Omit<JobResult, "status" | "summary" | "structured_output" | "error"> = {
        contract_version: "jarvis.v1",
        job_id: envelope.job_id,
        job_type: envelope.type,
        attempt: envelope.attempt,
      };

      try {
        const input = envelope.input as Record<string, unknown>;

        // Validate paths against filesystem policy for all operations
        if (policy) {
          const paths: string[] = [];
          if (input.path) paths.push(resolve(input.path as string));
          if (input.source_path) paths.push(resolve(input.source_path as string));
          if (input.destination_path) paths.push(resolve(input.destination_path as string));

          for (const p of paths) {
            const violation = checkPath(p, { _job_id: envelope.job_id, _job_type: envelope.type, _attempt: envelope.attempt, _envelope: envelope });
            if (violation) return violation;
          }
        }

        switch (envelope.type) {
          case "files.inspect": {
            const target = resolve(input.path as string);
            const stat = fs.statSync(target);
            if (stat.isDirectory()) {
              const entries = fs.readdirSync(target).map(name => {
                const s = fs.statSync(join(target, name));
                return { name, type: s.isDirectory() ? "directory" : "file", size: s.size };
              });
              return { ...base, status: "completed", summary: `Directory: ${entries.length} entries`, structured_output: { path: target, type: "directory", entries } };
            }
            return { ...base, status: "completed", summary: `File: ${basename(target)} (${stat.size} bytes)`, structured_output: { path: target, type: "file", size: stat.size, modified: stat.mtime.toISOString() } };
          }

          case "files.read": {
            const path = resolve(input.path as string);
            const content = fs.readFileSync(path, "utf8");
            return { ...base, status: "completed", summary: `Read ${basename(path)} (${content.length} chars)`, structured_output: { path, content, size: content.length } };
          }

          case "files.search": {
            const dir = resolve(input.path as string ?? ".");
            const query = (input.query as string).toLowerCase();
            const results: Array<{ path: string; line: number; text: string }> = [];
            searchDir(dir, query, results, 100);
            return { ...base, status: "completed", summary: `Found ${results.length} matches`, structured_output: { query, results, total: results.length } };
          }

          case "files.write": {
            const path = resolve(input.path as string);
            const content = input.content as string;
            fs.mkdirSync(dirname(path), { recursive: true });
            fs.writeFileSync(path, content);
            return { ...base, status: "completed", summary: `Written ${basename(path)}`, structured_output: { path, size: content.length } };
          }

          case "files.copy": {
            const src = resolve(input.source_path as string);
            const dst = resolve(input.destination_path as string);
            fs.mkdirSync(dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            return { ...base, status: "completed", summary: `Copied to ${basename(dst)}`, structured_output: { source: src, destination: dst } };
          }

          case "files.move": {
            const src = resolve(input.source_path as string);
            const dst = resolve(input.destination_path as string);
            fs.mkdirSync(dirname(dst), { recursive: true });
            fs.renameSync(src, dst);
            return { ...base, status: "completed", summary: `Moved to ${basename(dst)}`, structured_output: { source: src, destination: dst } };
          }

          case "files.preview": {
            const path = resolve(input.path as string);
            const lines = (input.lines as number) ?? 20;
            const content = fs.readFileSync(path, "utf8");
            const preview = content.split("\n").slice(0, lines).join("\n");
            return { ...base, status: "completed", summary: `Preview of ${basename(path)} (${lines} lines)`, structured_output: { path, preview, total_lines: content.split("\n").length } };
          }

          default:
            return { ...base, status: "failed", summary: `Unknown files job type: ${envelope.type}`, error: { code: "UNKNOWN_TYPE", message: `Unsupported: ${envelope.type}`, retryable: false } };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ...base, status: "failed", summary: msg, error: { code: "FILES_ERROR", message: msg, retryable: false } };
      }
    },
  };
}

function searchDir(dir: string, query: string, results: Array<{ path: string; line: number; text: string }>, limit: number): void {
  if (results.length >= limit) return;
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (results.length >= limit) return;
    if (name.startsWith(".") || name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      searchDir(full, query, results, limit);
    } else if (stat.isFile() && stat.size < 1_000_000) {
      try {
        const content = fs.readFileSync(full, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && results.length < limit; i++) {
          if (lines[i]!.toLowerCase().includes(query)) {
            results.push({ path: full, line: i + 1, text: lines[i]!.trim().slice(0, 200) });
          }
        }
      } catch { /* skip binary files */ }
    }
  }
}
