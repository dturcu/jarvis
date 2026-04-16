import fs from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const JARVIS_DIR = join(os.homedir(), ".jarvis");
export const CRM_DB_PATH = join(JARVIS_DIR, "crm.db");
export const KNOWLEDGE_DB_PATH = join(JARVIS_DIR, "knowledge.db");
export const RUNTIME_DB_PATH = join(JARVIS_DIR, "runtime.db");

/** @deprecated Use runtime.db approvals table instead. Will be removed. */
export const APPROVALS_FILE = join(JARVIS_DIR, "approvals.json");
/** @deprecated Use runtime.db notifications table instead. Will be removed. */
export const TELEGRAM_QUEUE_FILE = join(JARVIS_DIR, "telegram-queue.json");

// ─── Config Schema ──────────────────────────────────────────────────────────

const OAuthCredentials = Type.Object({
  client_id: Type.String(),
  client_secret: Type.String(),
  refresh_token: Type.String(),
});

const ConfigSchema = Type.Object({
  lmstudio_url: Type.String(),
  llamacpp_url: Type.String(),
  default_model: Type.String(),
  adapter_mode: Type.Union([Type.Literal("mock"), Type.Literal("real")]),
  poll_interval_ms: Type.Number({ minimum: 1000 }),
  trigger_poll_ms: Type.Number({ minimum: 1000 }),
  max_concurrent: Type.Number({ minimum: 1, maximum: 16 }),
  log_level: Type.Union([
    Type.Literal("debug"),
    Type.Literal("info"),
    Type.Literal("warn"),
    Type.Literal("error"),
  ]),
  project_root: Type.Optional(Type.String()),
  gmail: Type.Optional(OAuthCredentials),
  calendar: Type.Optional(OAuthCredentials),
  chrome: Type.Optional(Type.Object({ debugging_url: Type.String() })),
  telegram: Type.Optional(Type.Object({ bot_token: Type.String(), chat_id: Type.String() })),
  toggl: Type.Optional(Type.Object({ api_token: Type.String(), workspace_id: Type.String() })),
  drive: Type.Optional(OAuthCredentials),
  webhook_secret: Type.Optional(Type.String()),
  anthropic_api_key: Type.Optional(Type.String()),
  appliance_mode: Type.Boolean(),
  api_token: Type.Optional(Type.String()),
  api_tokens: Type.Optional(Type.Record(Type.String(), Type.String())),
  mode: Type.Optional(Type.Union([Type.Literal("dev"), Type.Literal("production")])),
  bind_host: Type.Optional(Type.String()),
  trust_proxy: Type.Optional(Type.Boolean()),
});

export type JarvisRuntimeConfig = Static<typeof ConfigSchema>;

// ─── Validation ─────────────────────────────────────────────────────────────

export type ConfigCheckResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Validate a config object without throwing.
 * Used by `jarvis doctor` to report issues.
 */
export function validateConfig(config: JarvisRuntimeConfig): ConfigCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Value.Check(ConfigSchema, config)) {
    for (const err of Value.Errors(ConfigSchema, config)) {
      errors.push(`${err.path}: ${err.message}`);
    }
  }

  // Path validations
  if (config.project_root) {
    const resolved = resolve(config.project_root);
    if (!fs.existsSync(resolved)) {
      warnings.push(`project_root does not exist: ${resolved}`);
    }
  }

  // Integration-specific checks
  if (config.adapter_mode === "real") {
    if (config.gmail && (!config.gmail.client_id || !config.gmail.refresh_token)) {
      errors.push("gmail: client_id and refresh_token are required when configured");
    }
    if (config.calendar && (!config.calendar.client_id || !config.calendar.refresh_token)) {
      errors.push("calendar: client_id and refresh_token are required when configured");
    }
    if (config.telegram && (!config.telegram.bot_token || !config.telegram.chat_id)) {
      errors.push("telegram: bot_token and chat_id are required when configured");
    }
    if (config.chrome && !config.chrome.debugging_url) {
      errors.push("chrome: debugging_url is required when configured");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Loading ────────────────────────────────────────────────────────────────

/**
 * Load and validate runtime configuration.
 *
 * Reads from `~/.jarvis/config.json` with environment variable overrides.
 * Throws with clear diagnostics on invalid config.
 */
export function loadConfig(): JarvisRuntimeConfig {
  const defaults: JarvisRuntimeConfig = {
    lmstudio_url: process.env.LMS_URL ?? "http://localhost:1234",
    llamacpp_url: process.env.LLAMACPP_URL ?? "http://localhost:8080",
    default_model: process.env.LMS_MODEL ?? "auto",
    adapter_mode: "real",
    poll_interval_ms: 60_000,
    trigger_poll_ms: 10_000,
    max_concurrent: 2,
    log_level: "info",
    appliance_mode: false,
    mode: undefined,
    bind_host: undefined,
    trust_proxy: undefined,
  };

  const configPath = join(JARVIS_DIR, "config.json");
  if (!fs.existsSync(configPath)) return defaults;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const config: JarvisRuntimeConfig = {
    ...defaults,
    lmstudio_url: typeof raw.lmstudio_url === "string" ? raw.lmstudio_url : defaults.lmstudio_url,
    llamacpp_url: typeof raw.llamacpp_url === "string" ? raw.llamacpp_url : defaults.llamacpp_url,
    default_model: typeof raw.default_model === "string" ? raw.default_model : defaults.default_model,
    adapter_mode: raw.adapter_mode === "mock" || raw.adapter_mode === "real" ? raw.adapter_mode : defaults.adapter_mode,
    poll_interval_ms: typeof raw.poll_interval_ms === "number" ? raw.poll_interval_ms : defaults.poll_interval_ms,
    trigger_poll_ms: typeof raw.trigger_poll_ms === "number" ? raw.trigger_poll_ms : defaults.trigger_poll_ms,
    max_concurrent: typeof raw.max_concurrent === "number" ? raw.max_concurrent : defaults.max_concurrent,
    log_level: isLogLevel(raw.log_level) ? raw.log_level : defaults.log_level,
    project_root: typeof raw.project_root === "string" ? raw.project_root : (process.env.JARVIS_PROJECT_ROOT ?? undefined),
    gmail: raw.gmail as JarvisRuntimeConfig["gmail"],
    calendar: raw.calendar as JarvisRuntimeConfig["calendar"],
    chrome: raw.chrome as JarvisRuntimeConfig["chrome"],
    telegram: raw.telegram as JarvisRuntimeConfig["telegram"],
    toggl: raw.toggl as JarvisRuntimeConfig["toggl"],
    drive: raw.drive as JarvisRuntimeConfig["drive"],
    webhook_secret: typeof raw.webhook_secret === "string" ? raw.webhook_secret : undefined,
    anthropic_api_key: typeof raw.anthropic_api_key === "string" ? raw.anthropic_api_key : undefined,
    appliance_mode: typeof raw.appliance_mode === "boolean" ? raw.appliance_mode : defaults.appliance_mode,
    api_token: typeof raw.api_token === "string" ? raw.api_token : undefined,
    api_tokens: isStringRecord(raw.api_tokens) ? raw.api_tokens : undefined,
    mode: raw.mode === "dev" || raw.mode === "production" ? raw.mode : defaults.mode,
    bind_host: typeof raw.bind_host === "string" ? raw.bind_host : defaults.bind_host,
    trust_proxy: typeof raw.trust_proxy === "boolean" ? raw.trust_proxy : defaults.trust_proxy,
  };

  // Environment overrides
  if (process.env.JARVIS_PROJECT_ROOT) {
    config.project_root = process.env.JARVIS_PROJECT_ROOT;
  }
  if (process.env.JARVIS_WEBHOOK_SECRET) {
    config.webhook_secret = process.env.JARVIS_WEBHOOK_SECRET;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic_api_key = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.JARVIS_TELEGRAM_BOT_TOKEN && process.env.JARVIS_TELEGRAM_CHAT_ID) {
    config.telegram = {
      bot_token: process.env.JARVIS_TELEGRAM_BOT_TOKEN,
      chat_id: process.env.JARVIS_TELEGRAM_CHAT_ID,
    };
  }
  if (process.env.JARVIS_APPLIANCE_MODE === "true") {
    config.appliance_mode = true;
  }
  if (process.env.JARVIS_MODE === "dev" || process.env.JARVIS_MODE === "production") {
    config.mode = process.env.JARVIS_MODE;
  }
  if (process.env.JARVIS_BIND_HOST) {
    config.bind_host = process.env.JARVIS_BIND_HOST;
  }
  if (process.env.LLAMACPP_URL) {
    config.llamacpp_url = process.env.LLAMACPP_URL;
  }

  // Validate
  const result = validateConfig(config);
  if (!result.valid) {
    throw new Error(
      `Invalid config in ${configPath}:\n${result.errors.map(e => `  - ${e}`).join("\n")}`,
    );
  }

  return config;
}

// ─── Credential Scoping ────────────────────────────────────────────────────

/**
 * Scoped credential subset returned by getCredentialsForWorker().
 * Each field is optional — workers only receive credentials they need.
 */
export type WorkerCredentials = {
  gmail?: JarvisRuntimeConfig["gmail"];
  calendar?: JarvisRuntimeConfig["calendar"];
  chrome?: JarvisRuntimeConfig["chrome"];
  toggl?: JarvisRuntimeConfig["toggl"];
  drive?: JarvisRuntimeConfig["drive"];
};

/**
 * Worker-to-credential mapping. Each entry lists the config keys
 * that worker is permitted to access. Workers not listed here
 * receive an empty object (no external credentials).
 */
const WORKER_CREDENTIAL_SCOPE: Record<string, ReadonlyArray<keyof WorkerCredentials>> = {
  email:    ["gmail"],
  calendar: ["calendar"],
  browser:  ["chrome"],
  social:   ["chrome"],   // social worker uses browser adapter under the hood
  time:     ["toggl"],
  drive:    ["drive"],
};

/**
 * Return only the credentials a specific worker needs.
 *
 * Workers not in WORKER_CREDENTIAL_SCOPE (inference, document, crm, web,
 * office, interpreter, voice, security, system, device, files) receive
 * an empty object — they either use no external credentials or manage
 * their own connections (e.g. inference uses lmstudio_url directly).
 */
export function getCredentialsForWorker(
  workerId: string,
  config: JarvisRuntimeConfig,
): WorkerCredentials {
  const allowedKeys = WORKER_CREDENTIAL_SCOPE[workerId];
  if (!allowedKeys || allowedKeys.length === 0) return {};

  const scoped: WorkerCredentials = {};
  for (const key of allowedKeys) {
    if (config[key] !== undefined) {
      (scoped as Record<string, unknown>)[key] = config[key];
    }
  }
  return scoped;
}

function isLogLevel(v: unknown): v is JarvisRuntimeConfig["log_level"] {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v).every(val => typeof val === "string");
}
