/**
 * Service verifier with retry/backoff for the Jarvis runtime surface.
 *
 * Each probe reports { name, ok, detail, attempts, elapsedMs } so the caller
 * (preflight CLI, start-jarvis.ps1, bootstrap.ps1) can render a uniform
 * status block and decide whether to continue.
 *
 * Retry policy: exponential backoff capped at BACKOFF_MAX_MS, with a
 * per-probe attempt budget. Probes are idempotent — safe to poll repeatedly.
 *
 * Environment overrides:
 *   JARVIS_BIND_HOST        default 127.0.0.1
 *   JARVIS_DASHBOARD_PORT   default 4242
 *   JARVIS_OLLAMA_URL       default http://127.0.0.1:11434
 *   JARVIS_LMSTUDIO_URL     default http://127.0.0.1:1234
 */

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const JARVIS_DIR = path.join(os.homedir(), ".jarvis");
const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NODE_MINOR = 5;

const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 8_000;
const DEFAULT_ATTEMPTS = 8;
const DEFAULT_TIMEOUT_MS = 4_000;

// ─── Retry helper ────────────────────────────────────────────────────────────

function nextDelay(attempt) {
  const raw = BACKOFF_INITIAL_MS * Math.pow(2, attempt);
  return Math.min(raw, BACKOFF_MAX_MS);
}

async function withRetry(name, fn, { attempts = DEFAULT_ATTEMPTS, onAttempt } = {}) {
  const started = Date.now();
  let lastDetail = null;
  for (let i = 0; i < attempts; i++) {
    if (onAttempt) onAttempt(i + 1, attempts);
    try {
      const detail = await fn();
      return { name, ok: true, detail, attempts: i + 1, elapsedMs: Date.now() - started };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, nextDelay(i)));
      }
    }
  }
  return { name, ok: false, detail: lastDetail, attempts, elapsedMs: Date.now() - started };
}

async function fetchWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Individual probes ───────────────────────────────────────────────────────

export async function checkNode(options = {}) {
  return withRetry("node", () => {
    const v = process.versions.node;
    const [major, minor] = v.split(".").map(Number);
    if (major < REQUIRED_NODE_MAJOR || (major === REQUIRED_NODE_MAJOR && minor < REQUIRED_NODE_MINOR)) {
      throw new Error(`Node ${v} is below required ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}.0`);
    }
    return { version: v };
  }, { attempts: 1, ...options });
}

export async function checkGit(options = {}) {
  return withRetry("git", () => {
    try {
      const v = execSync("git --version", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return { version: v };
    } catch {
      throw new Error("git not found on PATH");
    }
  }, { attempts: 1, ...options });
}

export async function checkNpmRegistry(options = {}) {
  return withRetry("npm-registry", async () => {
    const res = await fetchWithTimeout("https://registry.npmjs.org/-/ping", 3_000);
    if (!res.ok) throw new Error(`registry ping returned ${res.status}`);
    return { reachable: true };
  }, options);
}

export async function checkJarvisDir(options = {}) {
  return withRetry("jarvis-dir", () => {
    if (!existsSync(JARVIS_DIR)) throw new Error(`${JARVIS_DIR} does not exist`);
    const expected = ["runtime.db", "crm.db", "knowledge.db"];
    const missing = expected.filter((f) => !existsSync(path.join(JARVIS_DIR, f)));
    if (missing.length === expected.length) {
      throw new Error(`${JARVIS_DIR} has none of ${expected.join(", ")} — run: npm run setup`);
    }
    return { dir: JARVIS_DIR, missing, present: expected.filter((f) => !missing.includes(f)) };
  }, { attempts: 1, ...options });
}

export async function checkConfigFile(options = {}) {
  return withRetry("config", () => {
    const configPath = path.join(JARVIS_DIR, "config.json");
    if (!existsSync(configPath)) {
      throw new Error(`${configPath} missing — run: npm run setup or npm run ops:recover`);
    }
    let raw;
    try {
      raw = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (e) {
      throw new Error(`config.json is not valid JSON: ${e.message}`);
    }
    const mode = raw?.adapter_mode ?? "unknown";
    const hasGmail = Boolean(raw?.gmail?.refresh_token);
    const hasTelegram = Boolean(raw?.telegram?.bot_token);
    return { adapter_mode: mode, gmail: hasGmail, telegram: hasTelegram };
  }, { attempts: 1, ...options });
}

export async function checkOllama(options = {}) {
  const url = process.env.JARVIS_OLLAMA_URL ?? "http://127.0.0.1:11434";
  return withRetry("ollama", async () => {
    const res = await fetchWithTimeout(`${url}/api/tags`, 3_000);
    if (!res.ok) throw new Error(`${url}/api/tags returned ${res.status}`);
    const models = Array.isArray(res.data?.models) ? res.data.models.map((m) => m.name) : [];
    return { url, models };
  }, options);
}

export async function checkLmStudio(options = {}) {
  const url = process.env.JARVIS_LMSTUDIO_URL ?? "http://127.0.0.1:1234";
  return withRetry("lmstudio", async () => {
    const res = await fetchWithTimeout(`${url}/v1/models`, 3_000);
    if (!res.ok) throw new Error(`${url}/v1/models returned ${res.status}`);
    const models = Array.isArray(res.data?.data) ? res.data.data.map((m) => m.id) : [];
    return { url, models };
  }, options);
}

export async function checkDashboard(options = {}) {
  const host = process.env.JARVIS_BIND_HOST ?? "127.0.0.1";
  const port = process.env.JARVIS_DASHBOARD_PORT ?? "4242";
  const url = `http://${host}:${port}/api/health`;
  return withRetry("dashboard", async () => {
    const res = await fetchWithTimeout(url, DEFAULT_TIMEOUT_MS);
    // /api/health returns 503 on degraded; treat any response as dashboard-up, surface status separately.
    if (res.status !== 200 && res.status !== 503) {
      throw new Error(`${url} returned ${res.status}`);
    }
    const health = res.data?.status ?? (res.ok ? "ok" : "degraded");
    return { url, httpStatus: res.status, health };
  }, options);
}

// ─── Orchestration ───────────────────────────────────────────────────────────

/**
 * Probe matrix. `required` probes fail the overall run if they don't pass;
 * `optional` probes report status but don't flip the exit code.
 * `atLeastOne` groups flag the group failed only if every probe in the group
 * failed (e.g. at least one of ollama/lmstudio must be reachable for real mode).
 */
export const PROBE_PROFILES = {
  bootstrap: {
    required: ["node", "jarvis-dir"],
    optional: ["git", "config"],
    atLeastOne: [],
  },
  runtime: {
    required: ["node", "jarvis-dir", "config"],
    optional: ["git", "dashboard"],
    atLeastOne: [["ollama", "lmstudio"]],
  },
  "full": {
    required: ["node", "jarvis-dir", "config", "dashboard"],
    optional: ["git"],
    atLeastOne: [["ollama", "lmstudio"]],
  },
};

const PROBE_FNS = {
  node: checkNode,
  git: checkGit,
  "npm-registry": checkNpmRegistry,
  "jarvis-dir": checkJarvisDir,
  config: checkConfigFile,
  ollama: checkOllama,
  lmstudio: checkLmStudio,
  dashboard: checkDashboard,
};

export async function runProfile(profileName, { onProgress, attemptsOverride } = {}) {
  const profile = PROBE_PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile: ${profileName}`);

  const all = new Set([
    ...profile.required,
    ...profile.optional,
    ...profile.atLeastOne.flat(),
  ]);

  const results = {};
  for (const name of all) {
    const fn = PROBE_FNS[name];
    if (!fn) { results[name] = { name, ok: false, detail: "unknown probe", attempts: 0, elapsedMs: 0 }; continue; }
    if (onProgress) onProgress({ phase: "start", name });
    const opts = attemptsOverride !== undefined ? { attempts: attemptsOverride } : {};
    results[name] = await fn(opts);
    if (onProgress) onProgress({ phase: "done", name, result: results[name] });
  }

  const requiredFailed = profile.required.filter((n) => !results[n]?.ok);
  const groupFailures = profile.atLeastOne.filter((grp) => grp.every((n) => !results[n]?.ok));

  return {
    profile: profileName,
    results,
    status: requiredFailed.length === 0 && groupFailures.length === 0 ? "ok" : "failed",
    requiredFailed,
    groupFailures: groupFailures.map((g) => g.join(" or ")),
  };
}
