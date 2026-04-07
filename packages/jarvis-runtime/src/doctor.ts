/**
 * Jarvis Doctor — system health diagnostic.
 *
 * Every problem shows a clear message + exact fix command.
 *
 * Usage:
 *   jarvis doctor          Check system health
 *   jarvis doctor --fix    Auto-fix what can be fixed
 */

import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
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
  fix?: string;      // Human-readable fix instruction
  fixCmd?: string;    // Auto-fixable command (used by --fix)
};

const results: CheckResult[] = [];
const autoFix = process.argv.includes("--fix");

function pass(name: string, detail: string) {
  results.push({ name, status: "pass", detail });
}

function warn(name: string, detail: string, fix?: string, fixCmd?: string) {
  results.push({ name, status: "warn", detail, fix, fixCmd });
}

function fail(name: string, detail: string, fix?: string, fixCmd?: string) {
  results.push({ name, status: "fail", detail, fix, fixCmd });
}

// ─── Node Version ──────────────────────────────────────────────────────────

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  if (major >= 22) {
    pass("Node.js", `${version} (>= 22 required)`);
  } else {
    fail("Node.js", `${version} — Node 22+ required for node:sqlite`,
      "Download Node.js 22+ from https://nodejs.org or run: nvm install 22");
  }
}

// ─── Jarvis Directory ──────────────────────────────────────────────────────

function checkJarvisDir() {
  if (fs.existsSync(JARVIS_DIR)) {
    pass("Jarvis directory", `~/.jarvis exists`);
  } else {
    fail("Jarvis directory", "~/.jarvis does not exist",
      "Run: npm run jarvis setup", "npx tsx scripts/init-jarvis.ts");
  }
}

// ─── Config ────────────────────────────────────────────────────────────────

function checkConfig() {
  const configPath = join(JARVIS_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    warn("Config", "No config.json found — using defaults",
      "Run: npm run jarvis setup   to create a config file",
      "node scripts/setup-wizard.mjs --all");
    return;
  }

  try {
    const config = loadConfig();
    const result = validateConfig(config);
    if (result.valid && result.warnings.length === 0) {
      pass("Config", "Valid configuration");
    } else if (result.valid) {
      warn("Config", `Valid with warnings: ${result.warnings.join("; ")}`,
        "Edit ~/.jarvis/config.json to fix warnings");
    } else {
      fail("Config", `Invalid: ${result.errors.join("; ")}`,
        "Edit ~/.jarvis/config.json or run: npm run jarvis setup");
    }
  } catch (e) {
    fail("Config", `Load error: ${e instanceof Error ? e.message : String(e)}`,
      "Delete ~/.jarvis/config.json and run: npm run jarvis setup");
  }
}

// ─── Daemon Heartbeat ─────────────────────────────────────────────────────

function checkDaemon() {
  if (!fs.existsSync(RUNTIME_DB_PATH)) return;
  try {
    const db = new DatabaseSync(RUNTIME_DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    const row = db.prepare(
      "SELECT pid, last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1",
    ).get() as { pid: number; last_seen_at: string } | undefined;
    db.close();

    if (!row) {
      warn("Daemon", "No heartbeat found — daemon has never run",
        "Start daemon with: npm start");
      return;
    }

    const staleMs = Date.now() - new Date(row.last_seen_at).getTime();
    if (staleMs < 30_000) {
      pass("Daemon", `Running (PID ${row.pid}, last seen ${Math.round(staleMs / 1000)}s ago)`);
    } else {
      warn("Daemon", `Not running (PID ${row.pid}, last seen ${Math.round(staleMs / 60_000)}m ago)`,
        "Start daemon with: npm start");
    }
  } catch {
    warn("Daemon", "Could not check daemon heartbeat");
  }
}

// ─── Migration Status ─────────────────────────────────────────────────────

function checkMigrations() {
  for (const [name, dbPath, expected] of [
    ["Runtime", RUNTIME_DB_PATH, "0004"],
    ["CRM", CRM_DB_PATH, "crm_0001"],
    ["Knowledge", KNOWLEDGE_DB_PATH, "knowledge_0001"],
  ] as const) {
    if (!fs.existsSync(dbPath)) continue;
    try {
      const db = new DatabaseSync(dbPath);
      const row = db.prepare(
        "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1",
      ).get() as { id: string } | undefined;
      db.close();

      if (!row) {
        warn(`${name} Migrations`, "No migrations applied",
          `Run: npx tsx scripts/init-jarvis.ts`);
      } else if (row.id >= expected) {
        pass(`${name} Migrations`, `Latest: ${row.id}`);
      } else {
        warn(`${name} Migrations`, `Latest: ${row.id} (expected >= ${expected})`,
          "Restart daemon to auto-apply migrations, or run: npx tsx scripts/init-jarvis.ts");
      }
    } catch { /* skip */ }
  }
}

// ─── Databases ─────────────────────────────────────────────────────────────

function checkDatabase(name: string, dbPath: string, tables: string[]) {
  if (!fs.existsSync(dbPath)) {
    fail(`${name} DB`, `Not found at ${dbPath}`,
      "Run: npm run jarvis setup   to initialize databases",
      "npx tsx scripts/init-jarvis.ts");
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
      pass(`${name} DB`, `OK (${existing.length} tables)`);
    } else {
      warn(`${name} DB`, `Missing ${missing.length} table(s): ${missing.join(", ")}`,
        "Run: npm run jarvis setup   to recreate missing tables",
        "npx tsx scripts/init-jarvis.ts");
    }
  } catch (e) {
    fail(`${name} DB`, `Cannot open: ${e instanceof Error ? e.message : String(e)}`,
      `Try deleting ${dbPath} and running: npm run jarvis setup`);
  }
}

function checkDatabases() {
  checkDatabase("CRM", CRM_DB_PATH, [
    "schema_migrations", "contacts", "notes", "stage_history",
    "campaigns", "campaign_recipients",
  ]);
  checkDatabase("Knowledge", KNOWLEDGE_DB_PATH, [
    "schema_migrations", "documents", "playbooks", "entities", "relations",
    "decisions", "entity_provenance", "memory", "agent_runs", "embedding_chunks",
  ]);
  checkDatabase("Runtime", RUNTIME_DB_PATH, [
    "schema_migrations", "approvals", "agent_commands", "runs", "run_events",
    "daemon_heartbeats", "notifications", "plugin_installs", "audit_log",
    "settings", "model_registry", "model_benchmarks", "schedules", "agent_memory",
    "channel_threads", "channel_messages", "artifact_deliveries",
  ]);
}

// ─── WAL Mode ──────────────────────────────────────────────────────────────

function checkWalMode() {
  for (const [name, dbPath] of [["CRM", CRM_DB_PATH], ["Knowledge", KNOWLEDGE_DB_PATH], ["Runtime", RUNTIME_DB_PATH]] as const) {
    if (!fs.existsSync(dbPath)) continue;
    try {
      const db = new DatabaseSync(dbPath);
      const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string } | undefined;

      if (row?.journal_mode !== "wal") {
        // Auto-fix: enable WAL mode
        db.exec("PRAGMA journal_mode = WAL;");
        pass(`${name} WAL`, "WAL mode enabled (auto-fixed)");
      } else {
        pass(`${name} WAL`, "WAL mode enabled");
      }

      db.close();
    } catch { /* skip if can't open */ }
  }
}

// ─── Model Runtime ─────────────────────────────────────────────────────────

async function checkModelRuntime() {
  let config;
  try {
    config = loadConfig();
  } catch {
    config = { lmstudio_url: "http://localhost:1234" };
  }

  const lmsUrl = (config as { lmstudio_url: string }).lmstudio_url;
  let anyModel = false;

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
      if (models.length > 0) anyModel = true;
    } else {
      warn("LM Studio", `Reachable but returned ${resp.status}`,
        "Open LM Studio and load a model");
    }
  } catch {
    warn("LM Studio", `Not reachable at ${lmsUrl}`,
      "Start LM Studio, or install it from https://lmstudio.ai");
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
      if (models.length > 0) anyModel = true;
    } else {
      warn("Ollama", `Reachable but returned ${resp.status}`,
        "Pull a model: ollama pull llama3.2");
    }
  } catch {
    warn("Ollama", "Not reachable at localhost:11434",
      "Install from https://ollama.com then run: ollama serve");
  }

  if (!anyModel) {
    warn("Model Runtime", "No model runtime detected",
      "Install Ollama (https://ollama.com) or LM Studio (https://lmstudio.ai) and load a model");
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
      warn("Chrome", `Reachable but returned ${resp.status}`,
        "Restart Chrome with: chrome --remote-debugging-port=9222");
    }
  } catch {
    warn("Chrome", `Not reachable at ${debugUrl} — browser automation unavailable`,
      "Start Chrome with: chrome --remote-debugging-port=9222\n         (Optional: only needed for browser-based agents)");
  }
}

// ─── Dashboard Build ───────────────────────────────────────────────────────

function checkDashboard() {
  const distIndex = join(process.cwd(), "packages", "jarvis-dashboard", "dist", "index.html");
  if (fs.existsSync(distIndex)) {
    pass("Dashboard", "Built and ready");
  } else {
    warn("Dashboard", "Not built — UI won't be available",
      "Run: npm run dashboard:build",
      "npm run dashboard:build");
  }
}

// ─── Disk Space ────────────────────────────────────────────────────────────

function checkDiskSpace() {
  try {
    const target = fs.existsSync(JARVIS_DIR) ? JARVIS_DIR : os.homedir();
    const stats = fs.statfsSync(target);
    const freeGB = (stats.bfree * stats.bsize) / (1024 ** 3);
    if (freeGB > 5) {
      pass("Disk", `${freeGB.toFixed(1)} GB free`);
    } else if (freeGB > 1) {
      warn("Disk", `${freeGB.toFixed(1)} GB free — low disk space`,
        "Free up disk space — Jarvis needs room for databases and model cache");
    } else {
      fail("Disk", `${freeGB.toFixed(1)} GB free — critically low`,
        "Free up disk space immediately — at least 2 GB recommended");
    }
  } catch {
    warn("Disk", "Could not check disk space");
  }
}

// ─── Run ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n  Jarvis Doctor\n");

  if (autoFix) {
    console.log("  Running with --fix: will attempt to auto-fix issues\n");
  }

  checkNodeVersion();
  checkJarvisDir();
  checkConfig();
  checkDatabases();
  checkMigrations();
  checkWalMode();
  checkDaemon();
  await checkModelRuntime();
  await checkChrome();
  checkDashboard();
  checkDiskSpace();

  // Auto-fix phase
  if (autoFix) {
    const fixable = results.filter(r => r.status !== "pass" && r.fixCmd);
    if (fixable.length > 0) {
      console.log("\n  Attempting auto-fixes...\n");
      for (const r of fixable) {
        try {
          execSync(r.fixCmd!, { cwd: process.cwd(), stdio: "pipe", timeout: 120000 });
          r.status = "pass";
          r.detail = `${r.detail} (auto-fixed)`;
          console.log(`  \x1b[32m✓\x1b[0m Fixed: ${r.name}`);
        } catch (e) {
          console.log(`  \x1b[31m✗\x1b[0m Could not fix: ${r.name}`);
        }
      }
    }
  }

  // Print results
  console.log("");
  const icons = { pass: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m" } as const;
  let failCount = 0;
  let warnCount = 0;

  for (const r of results) {
    const icon = icons[r.status];
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
    if (r.status !== "pass" && r.fix) {
      console.log(`    \x1b[2m→ ${r.fix}\x1b[0m`);
    }
    if (r.status === "fail") failCount++;
    if (r.status === "warn") warnCount++;
  }

  console.log("");
  const total = results.length;
  const passCount = total - failCount - warnCount;
  console.log(`  ${passCount}/${total} passed, ${warnCount} warnings, ${failCount} failures`);

  if (failCount > 0) {
    console.log("\n  Fix the failures above, then run: \x1b[36mnpm run jarvis doctor\x1b[0m");
    if (!autoFix) {
      console.log("  Or try: \x1b[36mnpm run jarvis doctor -- --fix\x1b[0m to auto-fix what's possible");
    }
    console.log("");
    process.exitCode = 1;
  } else if (warnCount > 0) {
    console.log("\n  Jarvis can run but some features may be unavailable.");
    console.log("  Start with: \x1b[36mnpm start\x1b[0m\n");
  } else {
    console.log("\n  \x1b[32m\x1b[1mAll checks passed. Jarvis is ready.\x1b[0m");
    console.log("  Start with: \x1b[36mnpm start\x1b[0m\n");
  }
}

main().catch(e => {
  console.error("Doctor error:", e);
  process.exitCode = 1;
});
