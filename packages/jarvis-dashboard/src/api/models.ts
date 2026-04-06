/**
 * Model registry and benchmark API endpoints.
 *
 * Exposes model discovery results, benchmark summaries, and
 * per-model enable/disable controls.
 * Also provides LM Studio live model discovery and health check.
 */

import { Router } from "express";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import { join } from "node:path";
import { writeAuditLog, getActor } from "./middleware/audit.js";
import type { AuthenticatedRequest } from "./middleware/auth.js";
// Inline model classification to avoid heavy @jarvis/inference dependency.
// Mirrors logic from packages/jarvis-inference/src/router.ts.

type ModelTier = "opus" | "sonnet" | "haiku";

function classifyTier(modelId: string): ModelTier {
  const lower = modelId.toLowerCase();

  // Large models (70B+): opus tier
  if (/(?:^|[^0-9])(?:34b|40b|70b|72b|110b)(?:[^0-9]|$)|(?:^|[:-])(?:large|xl)(?:[:-]|$)/.test(lower)) {
    return "opus";
  }

  // Small models (sub-7B): haiku tier
  if (/(?:^|[^0-9])(?:1b|2b|3b|1\.5b)(?:[^0-9]|$)|(?:^|[:-])(?:small|tiny|mini)(?:[:-]|$)/.test(lower)) {
    return "haiku";
  }

  // Default medium (7B-30B): sonnet tier
  return "sonnet";
}

function inferCapabilities(modelId: string): string[] {
  const lower = modelId.toLowerCase();
  const caps: string[] = ["chat"];

  if (/code|coder|starcoder|deepseek-coder|codellama/.test(lower)) {
    caps.push("code");
  }
  if (/vision|llava|bakllava|minicpm-v|moondream/.test(lower)) {
    caps.push("vision");
  }
  if (/embed|embedding|nomic-embed|bge/.test(lower)) {
    const chatIdx = caps.indexOf("chat");
    if (chatIdx !== -1) caps.splice(chatIdx, 1);
    caps.push("embedding");
  }

  return caps;
}

function getDb(): DatabaseSync {
  const db = new DatabaseSync(join(os.homedir(), ".jarvis", "runtime.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

export const modelsRouter = Router();

// GET / — list all registered models with latest benchmark summary
modelsRouter.get("/", (_req, res) => {
  const db = getDb();
  try {
    const models = db.prepare(`
      SELECT model_id, runtime, capabilities_json, limits_json, tags_json,
             discovered_at, last_seen_at, enabled
      FROM model_registry
      ORDER BY enabled DESC, last_seen_at DESC
    `).all() as Array<{
      model_id: string; runtime: string; capabilities_json: string;
      limits_json: string; tags_json: string;
      discovered_at: string; last_seen_at: string; enabled: number;
    }>;

    // Attach latest benchmarks
    const result = models.map(m => {
      const benchmarks = db.prepare(`
        SELECT benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, measured_at
        FROM model_benchmarks
        WHERE model_id = ?
        ORDER BY measured_at DESC
        LIMIT 5
      `).all(m.model_id) as Array<{
        benchmark_type: string; latency_ms: number;
        tokens_per_sec: number | null;
        json_success: number | null;
        tool_call_success: number | null;
        measured_at: string;
      }>;

      return {
        id: m.model_id,
        runtime: m.runtime,
        capabilities: JSON.parse(m.capabilities_json),
        limits: JSON.parse(m.limits_json),
        tags: JSON.parse(m.tags_json),
        discovered_at: m.discovered_at,
        last_seen_at: m.last_seen_at,
        enabled: m.enabled === 1,
        benchmarks,
      };
    });

    res.json(result);
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
});

// PATCH /:modelId — enable or disable a model
modelsRouter.patch("/:modelId", (req, res) => {
  const { modelId } = req.params;
  const { enabled } = req.body as { enabled?: boolean };

  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "Expected { enabled: boolean }" });
    return;
  }

  const db = getDb();
  try {
    const existing = db.prepare("SELECT model_id FROM model_registry WHERE model_id = ?").get(modelId!) as { model_id: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: `Model not found: ${modelId}` });
      return;
    }

    db.prepare("UPDATE model_registry SET enabled = ? WHERE model_id = ?").run(enabled ? 1 : 0, modelId!);

    const actor = getActor(req as AuthenticatedRequest);
    writeAuditLog(actor.type, actor.id, "model.toggled", "model", modelId!, { enabled });

    res.json({ id: modelId, enabled });
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
});

// ─── LM Studio Discovery ────────────────────────────────────────────────────

const LMSTUDIO_URL = process.env.LMS_URL ?? "http://localhost:1234";

type LmStudioModel = {
  id: string;
  object?: string;
  owned_by?: string;
};

type LmStudioModelsResponse = {
  data: LmStudioModel[];
  object?: string;
};

// GET /discovery — live model discovery from LM Studio
modelsRouter.get("/discovery", async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(`${LMSTUDIO_URL}/v1/models`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      res.json({ models: [], lmstudio_url: LMSTUDIO_URL, connected: false });
      return;
    }

    const body = (await response.json()) as LmStudioModelsResponse;
    const models = (body.data ?? []).map((m) => ({
      id: m.id,
      tier: classifyTier(m.id),
      capabilities: inferCapabilities(m.id),
      available: true,
    }));

    res.json({ models, lmstudio_url: LMSTUDIO_URL, connected: true });
  } catch {
    res.json({ models: [], lmstudio_url: LMSTUDIO_URL, connected: false });
  }
});

// GET /health — LM Studio connectivity check
modelsRouter.get("/health", async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    const response = await fetch(`${LMSTUDIO_URL}/v1/models`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const body = (await response.json()) as LmStudioModelsResponse;
      res.json({
        connected: true,
        lmstudio_url: LMSTUDIO_URL,
        model_count: body.data?.length ?? 0,
      });
    } else {
      res.json({
        connected: false,
        lmstudio_url: LMSTUDIO_URL,
        model_count: 0,
        status: response.status,
      });
    }
  } catch {
    res.json({
      connected: false,
      lmstudio_url: LMSTUDIO_URL,
      model_count: 0,
    });
  }
});

// GET /:modelId/benchmarks — get detailed benchmark history
modelsRouter.get("/:modelId/benchmarks", (req, res) => {
  const { modelId } = req.params;
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, notes_json, measured_at
      FROM model_benchmarks
      WHERE model_id = ?
      ORDER BY measured_at DESC
      LIMIT 50
    `).all(modelId!) as Array<{
      benchmark_type: string; latency_ms: number;
      tokens_per_sec: number | null;
      json_success: number | null;
      tool_call_success: number | null;
      notes_json: string;
      measured_at: string;
    }>;

    res.json(rows.map(r => ({
      ...r,
      notes: r.notes_json ? JSON.parse(r.notes_json) : null,
      notes_json: undefined,
    })));
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
});
