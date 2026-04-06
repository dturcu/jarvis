/**
 * Model registry and benchmark API endpoints.
 *
 * Exposes model discovery results, benchmark summaries,
 * per-model enable/disable controls, health checks,
 * workflow-mapping, and on-demand benchmark triggers.
 */

import { Router } from "express";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { join } from "node:path";
import { writeAuditLog, getActor } from "./middleware/audit.js";
import type { AuthenticatedRequest } from "./middleware/auth.js";

function getDb(): DatabaseSync {
  const db = new DatabaseSync(join(os.homedir(), ".jarvis", "runtime.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

/** Runtime endpoints to probe for connectivity. */
const RUNTIME_ENDPOINTS: Array<{ name: string; url: string; probe: string }> = [
  { name: "lmstudio", url: "http://localhost:1234", probe: "http://localhost:1234/v1/models" },
  { name: "ollama", url: "http://localhost:11434", probe: "http://localhost:11434/api/tags" },
];

/** Check if a runtime endpoint is reachable (3s timeout). */
async function probeRuntime(probeUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(probeUrl, { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Static workflow-to-tier mapping for V1 agents.
 * Since @jarvis/agents is not a dependency of the dashboard, this is hardcoded.
 * The inference tier is derived from each agent's task_profile.objective:
 *   - "plan" with accuracy preference or complex multi-step → opus
 *   - "plan" standard → sonnet
 */
const WORKFLOW_MAPPING: Array<{
  workflow_id: string;
  agent_id: string;
  inference_tier: string;
}> = [
  { workflow_id: "contract-review", agent_id: "contract-reviewer", inference_tier: "opus" },
  { workflow_id: "rfq-analysis", agent_id: "evidence-auditor", inference_tier: "sonnet" },
  { workflow_id: "bd-pipeline", agent_id: "bd-pipeline", inference_tier: "sonnet" },
  { workflow_id: "staffing-check", agent_id: "staffing-monitor", inference_tier: "sonnet" },
  { workflow_id: "proposal-generation", agent_id: "proposal-engine", inference_tier: "opus" },
  { workflow_id: "content-creation", agent_id: "content-engine", inference_tier: "sonnet" },
  { workflow_id: "portfolio-check", agent_id: "portfolio-monitor", inference_tier: "haiku" },
  { workflow_id: "garden-brief", agent_id: "garden-calendar", inference_tier: "haiku" },
  { workflow_id: "social-engagement", agent_id: "social-engagement", inference_tier: "sonnet" },
  { workflow_id: "security-scan", agent_id: "security-monitor", inference_tier: "sonnet" },
  { workflow_id: "invoice-generation", agent_id: "invoice-generator", inference_tier: "sonnet" },
  { workflow_id: "email-campaign", agent_id: "email-campaign", inference_tier: "sonnet" },
  { workflow_id: "meeting-transcription", agent_id: "meeting-transcriber", inference_tier: "sonnet" },
  { workflow_id: "drive-watch", agent_id: "drive-watcher", inference_tier: "haiku" },
];

/** Seven-day staleness threshold in milliseconds. */
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export const modelsRouter = Router();

// GET /health — model runtime health summary
modelsRouter.get("/health", async (_req, res) => {
  const db = getDb();
  try {
    // Probe each runtime endpoint concurrently
    const runtimeResults = await Promise.all(
      RUNTIME_ENDPOINTS.map(async (rt) => ({
        name: rt.name,
        url: rt.url,
        connected: await probeRuntime(rt.probe),
      }))
    );

    // Query all models from registry
    const models = db.prepare(`
      SELECT model_id, runtime, enabled, last_seen_at
      FROM model_registry
      ORDER BY enabled DESC, last_seen_at DESC
    `).all() as Array<{
      model_id: string; runtime: string; enabled: number; last_seen_at: string;
    }>;

    // Find the latest discovery timestamp
    const latestDiscovery = db.prepare(
      "SELECT MAX(discovered_at) as latest FROM model_registry"
    ).get() as { latest: string | null } | undefined;

    const enabledCount = models.filter(m => m.enabled === 1).length;
    const degraded = enabledCount === 0;

    // Map to a model tier based on tags or a simple heuristic
    const modelSummaries = models.map(m => {
      // Try to read tags to infer tier; fall back to "sonnet" default
      let tier = "sonnet";
      try {
        const full = db.prepare(
          "SELECT tags_json FROM model_registry WHERE model_id = ? AND runtime = ?"
        ).get(m.model_id, m.runtime) as { tags_json: string } | undefined;
        if (full?.tags_json) {
          const tags = JSON.parse(full.tags_json) as string[];
          if (tags.includes("opus")) tier = "opus";
          else if (tags.includes("haiku")) tier = "haiku";
        }
      } catch { /* best-effort tier detection */ }

      return {
        model_id: m.model_id,
        runtime: m.runtime,
        tier,
        enabled: m.enabled === 1,
        last_seen_at: m.last_seen_at,
      };
    });

    res.json({
      runtimes: runtimeResults,
      models: modelSummaries,
      degraded,
      last_discovery_at: latestDiscovery?.latest ?? null,
    });
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
});

// GET /workflow-mapping — static tier mapping for V1 workflows
modelsRouter.get("/workflow-mapping", (_req, res) => {
  res.json(WORKFLOW_MAPPING);
});

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

    // Attach latest benchmarks (match on both model_id and runtime for composite PK)
    const result = models.map(m => {
      const benchmarks = db.prepare(`
        SELECT benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, measured_at
        FROM model_benchmarks
        WHERE model_id = ? AND runtime = ?
        ORDER BY measured_at DESC
        LIMIT 5
      `).all(m.model_id, m.runtime) as Array<{
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

// PATCH /:modelId — enable or disable a model (runtime via query param or body)
modelsRouter.patch("/:modelId", (req, res) => {
  const { modelId } = req.params;
  const { enabled, runtime: bodyRuntime } = req.body as { enabled?: boolean; runtime?: string };
  const runtime = (req.query.runtime as string | undefined) ?? bodyRuntime;

  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "Expected { enabled: boolean }" });
    return;
  }
  if (!runtime) {
    res.status(400).json({ error: "Missing runtime — provide as query param ?runtime= or in body { runtime }" });
    return;
  }

  const db = getDb();
  try {
    const existing = db.prepare(
      "SELECT model_id, runtime FROM model_registry WHERE model_id = ? AND runtime = ?"
    ).get(modelId!, runtime) as { model_id: string; runtime: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: `Model not found: ${modelId} (runtime: ${runtime})` });
      return;
    }

    db.prepare(
      "UPDATE model_registry SET enabled = ? WHERE model_id = ? AND runtime = ?"
    ).run(enabled ? 1 : 0, modelId!, runtime);

    const actor = getActor(req as AuthenticatedRequest);
    writeAuditLog(actor.type, actor.id, "model.toggled", "model", modelId!, { enabled, runtime });

    res.json({ id: modelId, runtime, enabled });
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
});

// GET /:runtime/:modelId/benchmarks — benchmark history using composite key (runtime, model_id)
modelsRouter.get("/:runtime/:modelId/benchmarks", (req, res) => {
  const { runtime, modelId } = req.params;
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, notes_json, measured_at
      FROM model_benchmarks WHERE model_id = ? AND runtime = ?
      ORDER BY measured_at DESC LIMIT 50
    `).all(modelId!, runtime!) as Array<{
      benchmark_type: string; latency_ms: number;
      tokens_per_sec: number | null;
      json_success: number | null;
      tool_call_success: number | null;
      notes_json: string;
      measured_at: string;
    }>;

    // Determine staleness: if most recent benchmark is >7 days old
    const now = Date.now();
    const latestMeasured = rows.length > 0 ? new Date(rows[0].measured_at).getTime() : 0;
    const stale = rows.length === 0 || (now - latestMeasured) > STALE_THRESHOLD_MS;

    res.json({
      stale,
      benchmarks: rows.map(r => ({
        ...r,
        notes: r.notes_json ? JSON.parse(r.notes_json) : null,
        notes_json: undefined,
      })),
    });
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
});

// POST /:runtime/:modelId/benchmark — trigger an on-demand benchmark
modelsRouter.post("/:runtime/:modelId/benchmark", (req, res) => {
  const { runtime, modelId } = req.params;
  const db = getDb();
  try {
    const commandId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key)
      VALUES (?, 'benchmark_model', 'system', ?, 'queued', 0, ?, 'dashboard', ?)
    `).run(
      commandId,
      JSON.stringify({ runtime, model_id: modelId }),
      now,
      `benchmark-${runtime}-${modelId}-${Date.now()}`
    );

    const actor = getActor(req as AuthenticatedRequest);
    writeAuditLog(actor.type, actor.id, "model.benchmark_requested", "model", modelId!, { runtime });

    res.json({ ok: true, command_id: commandId, runtime, model_id: modelId });
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
});

// GET /:modelId/benchmarks — get detailed benchmark history (legacy route, runtime via query param)
modelsRouter.get("/:modelId/benchmarks", (req, res) => {
  const { modelId } = req.params;
  const runtime = req.query.runtime as string | undefined;
  const db = getDb();
  try {
    const sql = runtime
      ? `SELECT benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, notes_json, measured_at
         FROM model_benchmarks WHERE model_id = ? AND runtime = ? ORDER BY measured_at DESC LIMIT 50`
      : `SELECT benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, notes_json, measured_at
         FROM model_benchmarks WHERE model_id = ? ORDER BY measured_at DESC LIMIT 50`;
    const params = runtime ? [modelId!, runtime] : [modelId!];
    const rows = db.prepare(sql).all(...params) as Array<{
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
