/**
 * Model Registry — discovers and tracks locally available models.
 *
 * Probes Ollama (localhost:11434), LM Studio (configurable), and llama.cpp
 * (configurable) to discover models, classifies their capabilities and size,
 * and persists to the model_registry table in runtime.db.
 */

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { buildModelInfo, type ModelInfo } from "./router.js";

export type DiscoveryResult = {
  discovered: ModelInfo[];
  errors: string[];
};

/**
 * Discover models from Ollama API.
 */
async function discoverOllama(timeoutMs = 5000): Promise<{ models: ModelInfo[]; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { models: [], error: `Ollama returned ${resp.status}` };
    }

    const data = await resp.json() as { models?: Array<{ name: string; size?: number; parameter_size?: string }> };
    const models = (data.models ?? []).map(m => {
      const info = buildModelInfo(m.name, "ollama");
      if (m.parameter_size) {
        info.parameterCount = m.parameter_size;
      }
      return info;
    });

    return { models };
  } catch (e) {
    return { models: [], error: `Ollama unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Discover models from LM Studio API (OpenAI-compatible).
 */
async function discoverLmStudio(baseUrl = "http://localhost:1234", timeoutMs = 5000): Promise<{ models: ModelInfo[]; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`${baseUrl}/v1/models`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { models: [], error: `LM Studio returned ${resp.status}` };
    }

    const data = await resp.json() as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map(m => buildModelInfo(m.id, "lmstudio"));

    return { models };
  } catch (e) {
    return { models: [], error: `LM Studio unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Discover models from llama.cpp server (OpenAI-compatible).
 */
async function discoverLlamaCpp(baseUrl = "http://localhost:8080", timeoutMs = 5000): Promise<{ models: ModelInfo[]; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`${baseUrl}/v1/models`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { models: [], error: `llama.cpp returned ${resp.status}` };
    }

    const data = await resp.json() as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map(m => buildModelInfo(m.id, "llamacpp"));

    return { models };
  } catch (e) {
    return { models: [], error: `llama.cpp unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Discover all locally available models from Ollama, LM Studio, and llama.cpp.
 */
export async function discoverModels(lmStudioUrl?: string, llamaCppUrl?: string): Promise<DiscoveryResult> {
  const [ollama, lmstudio, llamacpp] = await Promise.all([
    discoverOllama(),
    discoverLmStudio(lmStudioUrl),
    discoverLlamaCpp(llamaCppUrl),
  ]);

  const errors: string[] = [];
  if (ollama.error) errors.push(ollama.error);
  if (lmstudio.error) errors.push(lmstudio.error);
  if (llamacpp.error) errors.push(llamacpp.error);

  return {
    discovered: [...ollama.models, ...lmstudio.models, ...llamacpp.models],
    errors,
  };
}

/**
 * Persist discovered models to the model_registry table.
 * Uses UPSERT: updates last_seen_at for known models, inserts new ones.
 */
export function syncModelRegistry(db: DatabaseSync, models: ModelInfo[]): { added: number; updated: number } {
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  // Composite PK is (runtime, model_id) — same model name from different runtimes won't collide
  const upsert = db.prepare(`
    INSERT INTO model_registry (model_id, runtime, capabilities_json, limits_json, tags_json, discovered_at, last_seen_at, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(runtime, model_id) DO UPDATE SET
      capabilities_json = excluded.capabilities_json,
      last_seen_at = excluded.last_seen_at
  `);

  for (const model of models) {
    const existing = db.prepare(
      "SELECT model_id FROM model_registry WHERE runtime = ? AND model_id = ?",
    ).get(model.runtime, model.id) as { model_id: string } | undefined;

    upsert.run(
      model.id,
      model.runtime,
      JSON.stringify(model.capabilities),
      JSON.stringify({ size_class: model.size_class, parameter_count: model.parameterCount }),
      JSON.stringify([model.size_class]),
      now,
      now,
    );

    if (existing) {
      updated++;
    } else {
      added++;
    }
  }

  return { added, updated };
}

/**
 * Load all enabled models from the registry.
 */
export function loadRegisteredModels(db: DatabaseSync): ModelInfo[] {
  const rows = db.prepare(
    "SELECT model_id, runtime, capabilities_json, limits_json FROM model_registry WHERE enabled = 1 ORDER BY last_seen_at DESC",
  ).all() as Array<{
    model_id: string;
    runtime: string;
    capabilities_json: string;
    limits_json: string;
  }>;

  return rows.map(row => {
    const caps = JSON.parse(row.capabilities_json) as string[];
    const limits = JSON.parse(row.limits_json) as { size_class?: string; parameter_count?: string };
    return {
      id: row.model_id,
      runtime: row.runtime as "ollama" | "lmstudio" | "llamacpp",
      size_class: (limits.size_class ?? "medium") as ModelInfo["size_class"],
      capabilities: caps as ModelInfo["capabilities"],
      parameterCount: limits.parameter_count,
    };
  });
}

/**
 * Disable models not seen since the given threshold.
 * Returns the number of models disabled.
 */
export function pruneStaleModels(db: DatabaseSync, staleThreshold: Date): number {
  const result = db.prepare(
    "UPDATE model_registry SET enabled = 0 WHERE enabled = 1 AND last_seen_at < ?",
  ).run(staleThreshold.toISOString());
  return (result as { changes: number }).changes;
}
