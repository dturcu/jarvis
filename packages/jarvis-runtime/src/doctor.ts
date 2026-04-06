/**
 * Jarvis Doctor — system health diagnostic.
 *
 * Checks prerequisites, configuration, databases, model runtime,
 * and reports pass/fail for each category.
 *
 * Usage: npx tsx packages/jarvis-runtime/src/doctor.ts
 *        jarvis doctor
 */

import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  JARVIS_DIR,
  CRM_DB_PATH,
  KNOWLEDGE_DB_PATH,
  RUNTIME_DB_PATH,
  loadConfig,
  validateConfig,
} from "./config.js";

type CheckResult = {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

const results: CheckResult[] = [];

function pass(name: string, detail: string) {
  results.push({ name, status: "pass", detail });
}

function warn(name: string, detail: string) {
  results.push({ name, status: "warn", detail });
}

function fail(name: string, detail: string) {
  results.push({ name, status: "fail", detail });
}

// ─── Node Version ──────────────────────────────────────────────────────────

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  if (major >= 22) {
    pass("Node.js", `${version} (>= 22 required)`);
  } else {
    fail("Node.js", `${version} — Node 22+ required for node:sqlite`);
  }
}

// ─── Jarvis Directory ──────────────────────────────────────────────────────

function checkJarvisDir() {
  if (fs.existsSync(JARVIS_DIR)) {
    pass("~/.jarvis", "Directory exists");
  } else {
    fail("~/.jarvis", `Missing — run: jarvis init`);
  }
}

// ─── Config ────────────────────────────────────────────────────────────────

function checkConfig() {
  const configPath = join(JARVIS_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    warn("Config", `${configPath} not found — using defaults`);
    return;
  }

  try {
    const config = loadConfig();
    const result = validateConfig(config);
    if (result.valid && result.warnings.length === 0) {
      pass("Config", "Valid configuration");
    } else if (result.valid) {
      warn("Config", `Valid with warnings: ${result.warnings.join("; ")}`);
    } else {
      fail("Config", `Invalid: ${result.errors.join("; ")}`);
    }
  } catch (e) {
    fail("Config", `Load error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Databases ─────────────────────────────────────────────────────────────

function checkDatabase(name: string, dbPath: string, tables: string[]) {
  if (!fs.existsSync(dbPath)) {
    fail(name, `Not found at ${dbPath}`);
    return;
  }

  try {
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    ).all() as Array<{ name: string }>;
    const existing = rows.map(r => r.name);
    db.close();

    const missing = tables.filter(t => !existing.includes(t));
    if (missing.length === 0) {
      pass(name, `OK (${existing.length} tables)`);
    } else {
      warn(name, `Missing tables: ${missing.join(", ")}`);
    }
  } catch (e) {
    fail(name, `Cannot open: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function checkDatabases() {
  checkDatabase("CRM DB", CRM_DB_PATH, ["contacts", "notes", "stage_history"]);
  checkDatabase("Knowledge DB", KNOWLEDGE_DB_PATH, ["documents", "playbooks", "entities", "relations", "decisions"]);
  checkDatabase("Runtime DB", RUNTIME_DB_PATH, [
    "schema_migrations", "approvals", "agent_commands", "run_events",
    "daemon_heartbeats", "notifications", "plugin_installs", "audit_log",
    "settings", "model_registry", "model_benchmarks", "schedules", "agent_memory",
  ]);
}

// ─── WAL Mode ──────────────────────────────────────────────────────────────

function checkWalMode() {
  for (const [name, dbPath] of [["CRM", CRM_DB_PATH], ["Knowledge", KNOWLEDGE_DB_PATH], ["Runtime", RUNTIME_DB_PATH]] as const) {
    if (!fs.existsSync(dbPath)) continue;
    try {
      const db = new DatabaseSync(dbPath);
      const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string } | undefined;
      db.close();
      if (row?.journal_mode === "wal") {
        pass(`${name} WAL`, "WAL mode enabled");
      } else {
        warn(`${name} WAL`, `journal_mode=${row?.journal_mode ?? "unknown"} — WAL recommended`);
      }
    } catch { /* skip if can't open */ }
  }
}

// ─── LM Studio / Ollama ───────────────────────────────────────────────────

async function checkModelRuntime() {
  let config;
  try {
    config = loadConfig();
  } catch {
    config = { lmstudio_url: "http://localhost:1234" };
  }

  const lmsUrl = (config as { lmstudio_url: string }).lmstudio_url;

  // Check LM Studio
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${lmsUrl}/v1/models`, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json() as { data?: Array<{ id: string }> };
      const models = data.data ?? [];
      pass("LM Studio", `Reachable at ${lmsUrl} — ${models.length} model(s) loaded`);
      if (models.length > 0) {
        for (const m of models.slice(0, 5)) {
          pass("  Model", m.id);
        }
        if (models.length > 5) {
          pass("  ...", `and ${models.length - 5} more`);
        }
      }
    } else {
      warn("LM Studio", `Reachable but returned ${resp.status}`);
    }
  } catch {
    warn("LM Studio", `Not reachable at ${lmsUrl}`);
  }

  // Check Ollama
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json() as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      pass("Ollama", `Reachable — ${models.length} model(s) available`);
    } else {
      warn("Ollama", `Reachable but returned ${resp.status}`);
    }
  } catch {
    warn("Ollama", "Not reachable at localhost:11434");
  }
}

// ─── Chrome Debugging ──────────────────────────────────────────────────────

async function checkChrome() {
  let debugUrl = "http://localhost:9222";
  try {
    const config = loadConfig();
    if (config.chrome?.debugging_url) {
      debugUrl = config.chrome.debugging_url;
    }
  } catch { /* use default */ }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${debugUrl}/json/version`, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      pass("Chrome", `Debugging protocol available at ${debugUrl}`);
    } else {
      warn("Chrome", `Reachable but returned ${resp.status}`);
    }
  } catch {
    warn("Chrome", `Not reachable at ${debugUrl} — browser automation unavailable`);
  }
}

// ─── Disk Space ────────────────────────────────────────────────────────────

function checkDiskSpace() {
  try {
    const stats = fs.statfsSync(JARVIS_DIR);
    const freeGB = (stats.bfree * stats.bsize) / (1024 ** 3);
    if (freeGB > 5) {
      pass("Disk", `${freeGB.toFixed(1)} GB free`);
    } else if (freeGB > 1) {
      warn("Disk", `${freeGB.toFixed(1)} GB free — low disk space`);
    } else {
      fail("Disk", `${freeGB.toFixed(1)} GB free — critically low`);
    }
  } catch {
    warn("Disk", "Could not check disk space");
  }
}

// ─── Run ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n  Jarvis Doctor\n");

  checkNodeVersion();
  checkJarvisDir();
  checkConfig();
  checkDatabases();
  checkWalMode();
  await checkModelRuntime();
  await checkChrome();
  checkDiskSpace();

  // Print results
  console.log("");
  const icons = { pass: "[PASS]", warn: "[WARN]", fail: "[FAIL]" } as const;
  let failCount = 0;
  let warnCount = 0;

  for (const r of results) {
    const icon = icons[r.status];
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
    if (r.status === "fail") failCount++;
    if (r.status === "warn") warnCount++;
  }

  console.log("");
  const total = results.length;
  const passCount = total - failCount - warnCount;
  console.log(`  ${passCount}/${total} passed, ${warnCount} warnings, ${failCount} failures`);

  if (failCount > 0) {
    console.log("\n  Fix failures above before running Jarvis.\n");
    process.exitCode = 1;
  } else if (warnCount > 0) {
    console.log("\n  Jarvis can run but some features may be unavailable.\n");
  } else {
    console.log("\n  All checks passed. Jarvis is ready.\n");
  }
}

main().catch(e => {
  console.error("Doctor error:", e);
  process.exitCode = 1;
});
