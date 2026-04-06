/**
 * Model Benchmarking — measures model performance for evidence-based routing.
 *
 * Runs lightweight benchmarks against local models:
 *   - latency: time to first token and total response time
 *   - json_success: ability to produce valid JSON output
 *   - tool_call_success: ability to format tool calls correctly
 *
 * Results are cached in the model_benchmarks table with TTL.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ModelInfo } from "./router.js";

export type BenchmarkType = "latency" | "json_reliability" | "tool_call" | "code_quality";

export type BenchmarkResult = {
  model_id: string;
  runtime: string;
  benchmark_type: BenchmarkType;
  latency_ms: number;
  tokens_per_sec: number | null;
  json_success: number | null;
  tool_call_success: number | null;
  notes: Record<string, unknown>;
};

const JSON_TEST_PROMPT = `Respond ONLY with valid JSON (no markdown, no explanation). The JSON should be an object with keys: "name" (string), "score" (number 1-100), "tags" (array of strings). Example topic: a random fruit.`;

const TOOL_CALL_TEST_PROMPT = `You have access to a function called "get_weather" that takes a "city" parameter (string). Call this function for "Paris". Respond ONLY with a JSON object: {"function": "get_weather", "arguments": {"city": "Paris"}}`;

/**
 * Run a simple latency benchmark against a model.
 */
async function benchmarkLatency(
  baseUrl: string,
  modelId: string,
): Promise<BenchmarkResult> {
  const start = Date.now();

  try {
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Say hello in exactly 3 words." }],
        max_tokens: 20,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const elapsed = Date.now() - start;

    if (!resp.ok) {
      return {
        model_id: modelId, runtime: baseUrl, benchmark_type: "latency",
        latency_ms: elapsed, tokens_per_sec: null, json_success: null, tool_call_success: null,
        notes: { error: `HTTP ${resp.status}` },
      };
    }

    const data = await resp.json() as {
      usage?: { completion_tokens?: number };
      choices?: Array<{ message?: { content?: string } }>;
    };

    const tokens = data.usage?.completion_tokens ?? 0;
    const tps = tokens > 0 && elapsed > 0 ? (tokens / (elapsed / 1000)) : null;

    return {
      model_id: modelId, runtime: baseUrl, benchmark_type: "latency",
      latency_ms: elapsed, tokens_per_sec: tps, json_success: null, tool_call_success: null,
      notes: { tokens, response_length: data.choices?.[0]?.message?.content?.length ?? 0 },
    };
  } catch (e) {
    return {
      model_id: modelId, runtime: baseUrl, benchmark_type: "latency",
      latency_ms: Date.now() - start, tokens_per_sec: null, json_success: null, tool_call_success: null,
      notes: { error: e instanceof Error ? e.message : String(e) },
    };
  }
}

/**
 * Run a JSON reliability benchmark — can the model produce valid JSON?
 */
async function benchmarkJsonReliability(
  baseUrl: string,
  modelId: string,
  trials = 3,
): Promise<BenchmarkResult> {
  let successes = 0;
  const latencies: number[] = [];

  for (let i = 0; i < trials; i++) {
    const start = Date.now();
    try {
      const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: JSON_TEST_PROMPT }],
          max_tokens: 200,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      latencies.push(Date.now() - start);

      if (resp.ok) {
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content?.trim() ?? "";
        try {
          const parsed = JSON.parse(content);
          if (typeof parsed === "object" && parsed !== null && "name" in parsed) {
            successes++;
          }
        } catch { /* invalid JSON */ }
      }
    } catch {
      latencies.push(Date.now() - start);
    }
  }

  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  return {
    model_id: modelId, runtime: baseUrl, benchmark_type: "json_reliability",
    latency_ms: avgLatency, tokens_per_sec: null,
    json_success: successes / trials,
    tool_call_success: null,
    notes: { trials, successes },
  };
}

/**
 * Run a tool call formatting benchmark.
 */
async function benchmarkToolCall(
  baseUrl: string,
  modelId: string,
  trials = 3,
): Promise<BenchmarkResult> {
  let successes = 0;
  const latencies: number[] = [];

  for (let i = 0; i < trials; i++) {
    const start = Date.now();
    try {
      const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: TOOL_CALL_TEST_PROMPT }],
          max_tokens: 100,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      latencies.push(Date.now() - start);

      if (resp.ok) {
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content?.trim() ?? "";
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          if (parsed.function === "get_weather" &&
              typeof parsed.arguments === "object" &&
              (parsed.arguments as Record<string, unknown>).city === "Paris") {
            successes++;
          }
        } catch { /* invalid format */ }
      }
    } catch {
      latencies.push(Date.now() - start);
    }
  }

  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  return {
    model_id: modelId, runtime: baseUrl, benchmark_type: "tool_call",
    latency_ms: avgLatency, tokens_per_sec: null,
    json_success: null,
    tool_call_success: successes / trials,
    notes: { trials, successes },
  };
}

/**
 * Run all benchmarks for a model.
 */
export async function benchmarkModel(
  model: ModelInfo,
  options?: { lmStudioUrl?: string; trials?: number },
): Promise<BenchmarkResult[]> {
  const baseUrl = model.runtime === "ollama"
    ? "http://localhost:11434"
    : (options?.lmStudioUrl ?? "http://localhost:1234");

  const trials = options?.trials ?? 3;

  // Only benchmark chat-capable models
  if (!model.capabilities.includes("chat")) {
    return [];
  }

  const results = await Promise.all([
    benchmarkLatency(baseUrl, model.id),
    benchmarkJsonReliability(baseUrl, model.id, trials),
    benchmarkToolCall(baseUrl, model.id, trials),
  ]);

  return results;
}

/**
 * Persist benchmark results to the model_benchmarks table.
 */
export function saveBenchmarkResults(db: DatabaseSync, results: BenchmarkResult[]): void {
  const stmt = db.prepare(`
    INSERT INTO model_benchmarks
      (benchmark_id, model_id, runtime, benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, notes_json, measured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const r of results) {
    stmt.run(
      randomUUID(), r.model_id, r.runtime, r.benchmark_type,
      r.latency_ms, r.tokens_per_sec, r.json_success, r.tool_call_success,
      JSON.stringify(r.notes), now,
    );
  }
}

/**
 * Load cached benchmark results for a model.
 * Only returns results newer than maxAge.
 */
export function loadBenchmarks(
  db: DatabaseSync,
  modelId: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): BenchmarkResult[] {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const rows = db.prepare(
    "SELECT * FROM model_benchmarks WHERE model_id = ? AND measured_at > ? ORDER BY measured_at DESC",
  ).all(modelId, cutoff) as Array<{
    model_id: string; runtime: string; benchmark_type: string;
    latency_ms: number; tokens_per_sec: number | null;
    json_success: number | null; tool_call_success: number | null;
    notes_json: string;
  }>;

  return rows.map(r => ({
    model_id: r.model_id,
    runtime: r.runtime,
    benchmark_type: r.benchmark_type as BenchmarkType,
    latency_ms: r.latency_ms,
    tokens_per_sec: r.tokens_per_sec,
    json_success: r.json_success,
    tool_call_success: r.tool_call_success,
    notes: r.notes_json ? JSON.parse(r.notes_json) : {},
  }));
}

/**
 * Check if a model has fresh benchmarks.
 */
export function hasFreshBenchmarks(db: DatabaseSync, modelId: string, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const row = db.prepare(
    "SELECT COUNT(*) as n FROM model_benchmarks WHERE model_id = ? AND measured_at > ?",
  ).get(modelId, cutoff) as { n: number };
  return row.n > 0;
}
