import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

export const JARVIS_DIR = join(os.homedir(), ".jarvis");
export const CRM_DB_PATH = join(JARVIS_DIR, "crm.db");
export const KNOWLEDGE_DB_PATH = join(JARVIS_DIR, "knowledge.db");
export const RUNTIME_DB_PATH = join(JARVIS_DIR, "runtime.sqlite");
export const APPROVALS_FILE = join(JARVIS_DIR, "approvals.json");
export const TELEGRAM_QUEUE_FILE = join(JARVIS_DIR, "telegram-queue.json");

export type ModelTierConfig = {
  haiku: string;    // fast, cheap — classification, simple extraction
  sonnet: string;   // balanced — most agent planning, drafting
  opus: string;     // best — complex analysis, proposals
};

export type JarvisRuntimeConfig = {
  lmstudio_url: string;
  default_model: string;
  model_tiers?: ModelTierConfig;
  adapter_mode: "mock" | "real";
  poll_interval_ms: number;
  trigger_poll_ms: number;
  max_concurrent: number;
  log_level: "debug" | "info" | "warn" | "error";
  gmail?: {
    client_id: string;
    client_secret: string;
    refresh_token: string;
  };
  calendar?: {
    client_id: string;
    client_secret: string;
    refresh_token: string;
  };
  chrome?: {
    debugging_url: string;
  };
  telegram?: {
    bot_token: string;
    chat_id: string;
  };
  toggl?: {
    api_token: string;
    workspace_id: string;
  };
  drive?: {
    client_id: string;
    client_secret: string;
    refresh_token: string;
  };
  webhook_secret?: string;
};

export function loadConfig(): JarvisRuntimeConfig {
  const defaults: JarvisRuntimeConfig = {
    lmstudio_url: process.env.LMS_URL ?? "http://localhost:1234",
    default_model: process.env.LMS_MODEL ?? "auto",
    adapter_mode: "real",
    poll_interval_ms: 60_000,
    trigger_poll_ms: 10_000,
    max_concurrent: 2,
    log_level: "info",
  };

  const configPath = join(JARVIS_DIR, "config.json");
  if (!fs.existsSync(configPath)) return defaults;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    return {
      ...defaults,
      lmstudio_url: (raw.lmstudio_url as string) ?? defaults.lmstudio_url,
      default_model: (raw.default_model as string) ?? defaults.default_model,
      adapter_mode: (raw.adapter_mode as "mock" | "real") ?? defaults.adapter_mode,
      poll_interval_ms: (raw.poll_interval_ms as number) ?? defaults.poll_interval_ms,
      trigger_poll_ms: (raw.trigger_poll_ms as number) ?? defaults.trigger_poll_ms,
      max_concurrent: (raw.max_concurrent as number) ?? defaults.max_concurrent,
      log_level: (raw.log_level as JarvisRuntimeConfig["log_level"]) ?? defaults.log_level,
      gmail: raw.gmail as JarvisRuntimeConfig["gmail"],
      calendar: raw.calendar as JarvisRuntimeConfig["calendar"],
      model_tiers: raw.model_tiers as JarvisRuntimeConfig["model_tiers"],
      chrome: raw.chrome as JarvisRuntimeConfig["chrome"],
      telegram: raw.telegram as JarvisRuntimeConfig["telegram"],
      toggl: raw.toggl as JarvisRuntimeConfig["toggl"],
      drive: raw.drive as JarvisRuntimeConfig["drive"],
      webhook_secret: raw.webhook_secret as JarvisRuntimeConfig["webhook_secret"],
    };
  } catch {
    return defaults;
  }
}
