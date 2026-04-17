/**
 * Runtime Detection — shared module for locating LLM runtime binaries
 * and reading runtime configuration.
 *
 * Used by start.mjs (auto-boot) and the dashboard API (model management).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const JARVIS_DIR = path.join(os.homedir(), ".jarvis");
const IS_WIN = process.platform === "win32";

// ── Binary detection ────────────────────────────────────────────────────────

/**
 * Find a binary by checking: env var → config → auto-detect candidates.
 * Returns the absolute path or null.
 */
export function detectBinary(name, { envVar, configKey, candidates = [] } = {}) {
  // 1. Environment variable override
  if (envVar && process.env[envVar]) {
    const p = process.env[envVar];
    if (fs.existsSync(p)) return p;
  }

  // 2. Config file value
  const config = readRuntimesConfig();
  const runtimeConfig = config[configKey];
  if (runtimeConfig?.binary_path && fs.existsSync(runtimeConfig.binary_path)) {
    return runtimeConfig.binary_path;
  }

  // 3. Auto-detect from candidate paths
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  // 4. Try PATH via `where` (Windows) or `which` (Unix)
  try {
    const cmd = IS_WIN ? "where" : "which";
    const result = execFileSync(cmd, [name], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    const firstLine = result.trim().split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {
    // not in PATH
  }

  return null;
}

/** Auto-detection candidates per runtime. */
export function getDetectionCandidates() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");

  return {
    ollama: {
      name: IS_WIN ? "ollama.exe" : "ollama",
      envVar: "OLLAMA_PATH",
      configKey: "ollama",
      candidates: IS_WIN
        ? [
            path.join(localAppData, "Programs", "Ollama", "ollama.exe"),
          ]
        : [
            "/usr/local/bin/ollama",
            "/usr/bin/ollama",
          ],
    },
    lmstudio: {
      name: IS_WIN ? "lms.exe" : "lms",
      envVar: "LMS_PATH",
      configKey: "lmstudio",
      candidates: IS_WIN
        ? [
            path.join(home, ".lmstudio", "bin", "lms.exe"),
          ]
        : [
            path.join(home, ".lmstudio", "bin", "lms"),
          ],
    },
    llamacpp: {
      name: IS_WIN ? "llama-server.exe" : "llama-server",
      envVar: "LLAMACPP_PATH",
      configKey: "llamacpp",
      candidates: IS_WIN
        ? [
            path.join(home, ".docker", "bin", "inference", "llama-server.exe"),
          ]
        : [
            "/usr/local/bin/llama-server",
            "/usr/bin/llama-server",
          ],
    },
  };
}

/**
 * Detect all runtime binaries. Returns { ollama, lmstudio, llamacpp } with path or null.
 */
export function detectAllBinaries() {
  const defs = getDetectionCandidates();
  return {
    ollama: detectBinary(defs.ollama.name, defs.ollama),
    lmstudio: detectBinary(defs.lmstudio.name, defs.lmstudio),
    llamacpp: detectBinary(defs.llamacpp.name, defs.llamacpp),
  };
}

// ── Runtime probing ─────────────────────────────────────────────────────────

/**
 * Probe a URL to check if a runtime is already running.
 * Returns true if the endpoint responds with 2xx/3xx.
 */
export async function probeRuntime(url, timeoutMs = 3000) {
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

/**
 * Poll a URL until it responds successfully or times out.
 */
export async function waitForReady(url, { maxAttempts = 15, delayMs = 1000, label = url } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await probeRuntime(url, 2000)) return true;
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

// ── Runtime config ──────────────────────────────────────────────────────────

/** Default runtime URLs and probe endpoints. */
export const RUNTIME_DEFAULTS = {
  ollama: { url: "http://localhost:11434", probe: "http://localhost:11434/api/tags" },
  lmstudio: { url: "http://localhost:1234", probe: "http://localhost:1234/v1/models" },
  llamacpp: { url: "http://localhost:8080", probe: "http://localhost:8080/health" },
};

let _configCache = null;

/**
 * Read runtimes block from ~/.jarvis/config.json with defaults.
 */
export function readRuntimesConfig() {
  if (_configCache) return _configCache;

  const defaults = {
    ollama: { enabled: true, binary_path: null },
    lmstudio: { enabled: true, binary_path: null },
    llamacpp: { enabled: true, binary_path: null, gguf_dirs: [] },
  };

  const configPath = path.join(JARVIS_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    _configCache = defaults;
    return defaults;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const runtimes = raw.runtimes ?? {};

    _configCache = {
      ollama: { ...defaults.ollama, ...runtimes.ollama },
      lmstudio: { ...defaults.lmstudio, ...runtimes.lmstudio },
      llamacpp: { ...defaults.llamacpp, ...runtimes.llamacpp },
    };

    // Env overrides for gguf_dirs
    if (process.env.LLAMACPP_GGUF_DIRS) {
      _configCache.llamacpp.gguf_dirs = process.env.LLAMACPP_GGUF_DIRS.split(path.delimiter).filter(Boolean);
    }

    return _configCache;
  } catch {
    _configCache = defaults;
    return defaults;
  }
}

/** Clear config cache (for testing or after config change). */
export function clearConfigCache() {
  _configCache = null;
}
