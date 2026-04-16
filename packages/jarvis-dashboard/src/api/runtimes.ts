/**
 * Runtime management API — model load/unload, available model listing,
 * and detailed runtime status.
 */

import { Router } from "express";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeAuditLog, getActor } from "./middleware/audit.js";
import type { AuthenticatedRequest } from "./middleware/auth.js";

const execFileAsync = promisify(execFile);

// ── Runtime configuration ───────────────────────────────────────────────────

const OLLAMA_URL = process.env.LMS_URL ? undefined : "http://localhost:11434";
const LMSTUDIO_URL = process.env.LMS_URL ?? "http://localhost:1234";
const LLAMACPP_URL = process.env.LLAMACPP_URL ?? "http://localhost:8080";

function getRuntimeUrl(runtime: string): string {
  switch (runtime) {
    case "ollama": return OLLAMA_URL ?? "http://localhost:11434";
    case "lmstudio": return LMSTUDIO_URL;
    case "llamacpp": return LLAMACPP_URL;
    default: throw new Error(`Unknown runtime: ${runtime}`);
  }
}

async function probeUrl(url: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── Binary detection (lightweight, dashboard-side) ──────────────────────────

function findBinary(name: string, envVar: string, candidates: string[]): string | null {
  if (process.env[envVar]) {
    const p = process.env[envVar]!;
    if (fs.existsSync(p)) return p;
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const IS_WIN = process.platform === "win32";
const home = os.homedir();
const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");

function findOllamaBinary(): string | null {
  return findBinary(
    "ollama",
    "OLLAMA_PATH",
    IS_WIN ? [path.join(localAppData, "Programs", "Ollama", "ollama.exe")] : ["/usr/local/bin/ollama", "/usr/bin/ollama"],
  );
}

function findLmStudioBinary(): string | null {
  return findBinary(
    "lms",
    "LMS_PATH",
    IS_WIN ? [path.join(home, ".lmstudio", "bin", "lms.exe")] : [path.join(home, ".lmstudio", "bin", "lms")],
  );
}

function findLlamaCppBinary(): string | null {
  return findBinary(
    "llama-server",
    "LLAMACPP_PATH",
    IS_WIN ? [path.join(home, ".docker", "bin", "inference", "llama-server.exe")] : ["/usr/local/bin/llama-server", "/usr/bin/llama-server"],
  );
}

// ── Ollama helpers ──────────────────────────────────────────────────────────

async function ollamaListInstalled(): Promise<Array<{ id: string; size: string }>> {
  const binary = findOllamaBinary();
  if (!binary) return [];
  try {
    const { stdout } = await execFileAsync(binary, ["list"], { timeout: 10_000 });
    const lines = stdout.trim().split(/\r?\n/).slice(1); // skip header
    return lines.map(line => {
      const parts = line.trim().split(/\s{2,}/);
      return { id: parts[0] ?? "", size: parts[2] ?? "" };
    }).filter(m => m.id);
  } catch {
    return [];
  }
}

async function ollamaLoadModel(model: string): Promise<void> {
  const url = getRuntimeUrl("ollama");
  const resp = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "", keep_alive: "5m" }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Ollama load failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  // Consume the response stream (ollama streams JSON objects)
  for await (const _ of resp.body as any) { /* drain */ }
}

async function ollamaUnloadModel(model: string): Promise<void> {
  const url = getRuntimeUrl("ollama");
  const resp = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "", keep_alive: "0" }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Ollama unload failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  for await (const _ of resp.body as any) { /* drain */ }
}

async function ollamaRunningModels(): Promise<string[]> {
  const url = getRuntimeUrl("ollama");
  try {
    const resp = await fetch(`${url}/api/ps`);
    if (!resp.ok) return [];
    const data = await resp.json() as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map(m => m.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

// ── LM Studio helpers ───────────────────────────────────────────────────────

async function lmstudioAvailableModels(): Promise<Array<{ id: string; path: string; size_bytes: number }>> {
  const modelsDir = path.join(home, ".lmstudio", "models");
  if (!fs.existsSync(modelsDir)) return [];

  const results: Array<{ id: string; path: string; size_bytes: number }> = [];
  async function scan(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.name.endsWith(".gguf") && !entry.name.startsWith("mmproj-")) {
        const stat = await fsp.stat(fullPath);
        results.push({
          id: path.relative(modelsDir, fullPath).replace(/\\/g, "/"),
          path: fullPath,
          size_bytes: stat.size,
        });
      }
    }
  }

  await scan(modelsDir);
  return results;
}

async function lmstudioLoadModel(model: string): Promise<void> {
  const binary = findLmStudioBinary();
  if (!binary) throw new Error("LM Studio CLI not found");
  await execFileAsync(binary, ["load", model, "-y"], { timeout: 120_000 });
}

async function lmstudioUnloadModel(model: string): Promise<void> {
  const binary = findLmStudioBinary();
  if (!binary) throw new Error("LM Studio CLI not found");
  await execFileAsync(binary, ["unload", model], { timeout: 30_000 });
}

// ── llama.cpp helpers ───────────────────────────────────────────────────────

function getGgufDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.LLAMACPP_GGUF_DIRS) {
    dirs.push(...process.env.LLAMACPP_GGUF_DIRS.split(path.delimiter).filter(Boolean));
  }
  // Also scan lmstudio models dir as default source
  const lmsModels = path.join(home, ".lmstudio", "models");
  if (fs.existsSync(lmsModels) && !dirs.includes(lmsModels)) {
    dirs.push(lmsModels);
  }
  return dirs;
}

async function llamacppAvailableModels(): Promise<Array<{ id: string; path: string; size_bytes: number }>> {
  const dirs = getGgufDirs();
  const results: Array<{ id: string; path: string; size_bytes: number }> = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    async function scan(d: string): Promise<void> {
      const entries = await fsp.readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.name.endsWith(".gguf") && !entry.name.startsWith("mmproj-")) {
          if (seen.has(fullPath)) continue;
          seen.add(fullPath);
          const stat = await fsp.stat(fullPath);
          results.push({
            id: entry.name,
            path: fullPath,
            size_bytes: stat.size,
          });
        }
      }
    }
    await scan(dir);
  }

  return results;
}

// Track llama-server child process for restart-based model loading
let llamacppChild: ReturnType<typeof spawn> | null = null;

async function waitForLlamaCpp(timeoutMs = 15_000): Promise<boolean> {
  const url = `${getRuntimeUrl("llamacpp")}/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probeUrl(url, 2000)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function llamacppLoadModel(modelPath: string): Promise<void> {
  if (!fs.existsSync(modelPath)) {
    throw new Error(`GGUF file not found: ${modelPath}`);
  }

  const binary = findLlamaCppBinary();
  if (!binary) throw new Error("llama-server binary not found");

  // Kill existing server if we're managing it
  if (llamacppChild) {
    try { llamacppChild.kill(); } catch { /* ignore */ }
    llamacppChild = null;
    await new Promise(r => setTimeout(r, 1000));
  }

  // Check if an external llama-server is running — kill it too
  const isRunning = await probeUrl(`${getRuntimeUrl("llamacpp")}/health`);
  if (isRunning) {
    // Can't restart an externally managed server; just tell it to load via slot API if available
    // For now, we spawn our own
  }

  llamacppChild = spawn(binary, [
    "--host", "127.0.0.1",
    "--port", new URL(getRuntimeUrl("llamacpp")).port || "8080",
    "-m", modelPath,
    "--ctx-size", "4096",
    "-ngl", "99",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  llamacppChild.on("exit", () => { llamacppChild = null; });

  const ready = await waitForLlamaCpp();
  if (!ready) {
    if (llamacppChild) { try { llamacppChild.kill(); } catch { /* */ } }
    llamacppChild = null;
    throw new Error("llama-server did not become ready within 15 seconds");
  }
}

async function llamacppUnloadModel(): Promise<void> {
  const binary = findLlamaCppBinary();
  if (!binary) throw new Error("llama-server binary not found");

  if (llamacppChild) {
    try { llamacppChild.kill(); } catch { /* ignore */ }
    llamacppChild = null;
    await new Promise(r => setTimeout(r, 1000));
  }

  // Restart empty
  llamacppChild = spawn(binary, [
    "--host", "127.0.0.1",
    "--port", new URL(getRuntimeUrl("llamacpp")).port || "8080",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  llamacppChild.on("exit", () => { llamacppChild = null; });

  const ready = await waitForLlamaCpp();
  if (!ready) {
    if (llamacppChild) { try { llamacppChild.kill(); } catch { /* */ } }
    llamacppChild = null;
    throw new Error("llama-server restart failed");
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ── Router ──────────────────────────────────────────────────────────────────

export const runtimesRouter = Router();

// GET /:runtime/available-models — models that can be loaded
runtimesRouter.get("/:runtime/available-models", async (req, res) => {
  const { runtime } = req.params;
  try {
    switch (runtime) {
      case "ollama": {
        const models = await ollamaListInstalled();
        res.json({ ok: true, models: models.map(m => ({ id: m.id, size: m.size })) });
        return;
      }
      case "lmstudio": {
        const models = await lmstudioAvailableModels();
        res.json({ ok: true, models: models.map(m => ({ id: m.id, path: m.path, size: formatBytes(m.size_bytes), size_bytes: m.size_bytes })) });
        return;
      }
      case "llamacpp": {
        const models = await llamacppAvailableModels();
        res.json({ ok: true, models: models.map(m => ({ id: m.id, path: m.path, size: formatBytes(m.size_bytes), size_bytes: m.size_bytes })) });
        return;
      }
      default:
        res.status(400).json({ ok: false, error: `Unknown runtime: ${runtime}` });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /:runtime/load — load a model into a runtime
runtimesRouter.post("/:runtime/load", async (req, res) => {
  const { runtime } = req.params;
  const { model } = req.body as { model?: string };

  if (!model) {
    res.status(400).json({ ok: false, error: "Missing model in request body" });
    return;
  }

  try {
    switch (runtime) {
      case "ollama":
        await ollamaLoadModel(model);
        break;
      case "lmstudio":
        await lmstudioLoadModel(model);
        break;
      case "llamacpp":
        await llamacppLoadModel(model);
        break;
      default:
        res.status(400).json({ ok: false, error: `Unknown runtime: ${runtime}` });
        return;
    }

    const actor = getActor(req as AuthenticatedRequest);
    writeAuditLog(actor.type, actor.id, "runtime.model_loaded", "runtime", runtime!, { model });

    res.json({ ok: true, runtime, model });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /:runtime/unload — unload a model from a runtime
runtimesRouter.post("/:runtime/unload", async (req, res) => {
  const { runtime } = req.params;
  const { model } = req.body as { model?: string };

  try {
    switch (runtime) {
      case "ollama":
        if (!model) { res.status(400).json({ ok: false, error: "Missing model" }); return; }
        await ollamaUnloadModel(model);
        break;
      case "lmstudio":
        if (!model) { res.status(400).json({ ok: false, error: "Missing model" }); return; }
        await lmstudioUnloadModel(model);
        break;
      case "llamacpp":
        await llamacppUnloadModel();
        break;
      default:
        res.status(400).json({ ok: false, error: `Unknown runtime: ${runtime}` });
        return;
    }

    const actor = getActor(req as AuthenticatedRequest);
    writeAuditLog(actor.type, actor.id, "runtime.model_unloaded", "runtime", runtime!, { model: model ?? "(all)" });

    res.json({ ok: true, runtime, model: model ?? null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /:runtime/status — detailed runtime status
runtimesRouter.get("/:runtime/status", async (req, res) => {
  const { runtime } = req.params;
  try {
    const url = getRuntimeUrl(runtime!);
    let connected = false;
    let loadedModels: string[] = [];

    switch (runtime) {
      case "ollama": {
        connected = await probeUrl(`${url}/api/tags`);
        if (connected) {
          loadedModels = await ollamaRunningModels();
        }
        break;
      }
      case "lmstudio": {
        connected = await probeUrl(`${url}/v1/models`);
        if (connected) {
          try {
            const resp = await fetch(`${url}/v1/models`);
            const data = await resp.json() as { data?: Array<{ id: string }> };
            loadedModels = (data.data ?? []).map(m => m.id);
          } catch { /* */ }
        }
        break;
      }
      case "llamacpp": {
        connected = await probeUrl(`${url}/health`);
        if (connected) {
          try {
            const resp = await fetch(`${url}/v1/models`);
            const data = await resp.json() as { data?: Array<{ id: string }> };
            loadedModels = (data.data ?? []).map(m => m.id);
          } catch { /* */ }
        }
        break;
      }
      default:
        res.status(400).json({ ok: false, error: `Unknown runtime: ${runtime}` });
        return;
    }

    res.json({
      ok: true,
      name: runtime,
      url,
      connected,
      loaded_models: loadedModels,
      managed_pid: runtime === "llamacpp" && llamacppChild?.pid ? llamacppChild.pid : null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
