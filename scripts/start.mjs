#!/usr/bin/env node
/**
 * Jarvis Start — runs daemon + dashboard together.
 *
 * Usage:
 *   npm start
 *   node scripts/start.mjs
 *   node scripts/start.mjs --daemon-only
 *   node scripts/start.mjs --dashboard-only
 */

import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectAllBinaries,
  probeRuntime,
  waitForReady,
  readRuntimesConfig,
  RUNTIME_DEFAULTS,
} from "./runtime-detect.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JARVIS_DIR = path.join(os.homedir(), ".jarvis");
const DASHBOARD_PORT = Number(process.env.PORT ?? 4242);
const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;
const HEARTBEAT_STALE_MS = 30_000;

const args = process.argv.slice(2);
const daemonOnly = args.includes("--daemon-only");
const dashboardOnly = args.includes("--dashboard-only");

// ─── Pre-flight Checks ───────────────────────────────────────────────────────

function preflight() {
  const issues = [];

  // Check ~/.jarvis exists
  if (!fs.existsSync(JARVIS_DIR)) {
    issues.push({
      problem: "Jarvis has not been set up yet",
      fix: "npm run jarvis setup",
    });
  }

  // Check databases exist
  for (const db of ["crm.db", "knowledge.db", "runtime.db"]) {
    if (!fs.existsSync(path.join(JARVIS_DIR, db))) {
      issues.push({
        problem: `Database missing: ${db}`,
        fix: "npm run jarvis setup",
      });
    }
  }

  // Check config
  const configPath = path.join(JARVIS_DIR, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      issues.push({
        problem: "config.json is invalid JSON",
        fix: "Delete ~/.jarvis/config.json and run: npm run jarvis setup",
      });
    }
  }

  if (issues.length > 0) {
    console.log("");
    console.log("  \x1b[31m\x1b[1mJarvis cannot start — setup required\x1b[0m\n");
    for (const issue of issues) {
      console.log(`  \x1b[31m✗\x1b[0m ${issue.problem}`);
      console.log(`    \x1b[2m→ ${issue.fix}\x1b[0m`);
    }
    console.log(`\n  Run \x1b[36mnpm run jarvis setup\x1b[0m first.\n`);
    process.exit(1);
  }
}

// ─── Start Services ──────────────────────────────────────────────────────────

function startService(name, cmd, args, env = {}) {
  const windowsNpx = process.platform === "win32" && cmd === "npx";
  const resolvedCmd = windowsNpx ? (process.env.ComSpec ?? "cmd.exe") : cmd;
  const resolvedArgs = windowsNpx ? ["/d", "/c", cmd, ...args] : args;
  const child = spawn(resolvedCmd, resolvedArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });

  child.on("error", (err) => {
    console.error(`\n  \x1b[31m${name} failed to start:\x1b[0m ${err.message}`);
    console.error(`  Try running manually: ${cmd} ${args.join(" ")}\n`);
    if (!shuttingDown) {
      shutdown(`${name} failed to start`, 1);
    }
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    const reason = code !== null ? `code ${code}` : `signal ${signal ?? "unknown"}`;
    console.log(`\n  \x1b[33m${name} exited with ${reason}\x1b[0m`);

    // Avoid leaving a half-alive stack behind when one side crashes or fails to bind.
    shutdown(`${name} exited unexpectedly`, code ?? 1);
  });

  return child;
}

const children = [];
const runtimeProcesses = []; // { name, child, startedByUs }
let shuttingDown = false;

function terminateChild(child) {
  if (!child?.pid) return;

  if (process.platform === "win32") {
    spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // best-effort
  }
}

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readFreshDaemonHeartbeat() {
  const dbPath = path.join(JARVIS_DIR, "runtime.db");
  if (!fs.existsSync(dbPath)) return null;

  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");

    const row = db.prepare(
      "SELECT pid, last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1",
    ).get();

    if (!row) return null;

    const lastSeenMs = new Date(row.last_seen_at).getTime();
    if (!Number.isFinite(lastSeenMs)) return null;
    if (Date.now() - lastSeenMs > HEARTBEAT_STALE_MS) return null;
    if (!isProcessAlive(row.pid)) return null;

    return {
      pid: row.pid,
      last_seen_at: row.last_seen_at,
    };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* best-effort */ }
  }
}

async function probeDashboard() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (
      response.ok &&
      data &&
      typeof data === "object" &&
      "dashboardUrl" in data &&
      "status" in data
    ) {
      return { state: "jarvis", data };
    }

    return { state: "occupied" };
  } catch (error) {
    const code = error?.cause?.code ?? error?.code;
    if (code === "ECONNREFUSED" || code === "ECONNRESET") {
      return { state: "absent" };
    }
    return { state: "absent" };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Runtime Auto-boot ──────────────────────────────────────────────────────

async function bootSingleRuntime(name, binaryPath, spawnArgs, probeUrl) {
  // Already running?
  if (await probeRuntime(probeUrl)) {
    return { name, status: "already_running" };
  }

  // Binary not found?
  if (!binaryPath) {
    return { name, status: "not_found" };
  }

  // Spawn the runtime
  try {
    const child = spawn(binaryPath, spawnArgs, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    // Collect stderr for error reporting
    let stderrBuf = "";
    child.stderr?.on("data", (chunk) => { stderrBuf += chunk.toString().slice(-500); });

    // Wait for readiness
    const ready = await waitForReady(probeUrl, { maxAttempts: 15, delayMs: 1000 });
    if (!ready) {
      terminateChild(child);
      return { name, status: "timeout", error: stderrBuf.trim().slice(-200) || "readiness probe timed out" };
    }

    runtimeProcesses.push({ name, child, startedByUs: true });
    return { name, status: "started", pid: child.pid };
  } catch (err) {
    return { name, status: "spawn_error", error: err.message };
  }
}

async function bootRuntimes() {
  const config = readRuntimesConfig();
  const binaries = detectAllBinaries();

  const runtimeDefs = [
    {
      name: "ollama",
      enabled: config.ollama?.enabled !== false,
      binary: binaries.ollama,
      args: ["serve"],
      probe: RUNTIME_DEFAULTS.ollama.probe,
    },
    {
      name: "lmstudio",
      enabled: config.lmstudio?.enabled !== false,
      binary: binaries.lmstudio,
      args: ["server", "start", "--port", "1234"],
      probe: RUNTIME_DEFAULTS.lmstudio.probe,
    },
    {
      name: "llamacpp",
      enabled: config.llamacpp?.enabled !== false,
      binary: binaries.llamacpp,
      args: ["--host", "127.0.0.1", "--port", "8080"],
      probe: RUNTIME_DEFAULTS.llamacpp.probe,
    },
  ];

  const enabled = runtimeDefs.filter(r => r.enabled);
  if (enabled.length === 0) {
    console.log("  No runtimes enabled — skipping boot");
    return;
  }

  console.log("  Booting runtimes...");

  const results = await Promise.allSettled(
    enabled.map(r => bootSingleRuntime(r.name, r.binary, r.args, r.probe))
  );

  // Status table
  const icons = { started: "\x1b[32m+\x1b[0m", already_running: "\x1b[32m~\x1b[0m", not_found: "\x1b[33m-\x1b[0m", timeout: "\x1b[31m!\x1b[0m", spawn_error: "\x1b[31m!\x1b[0m" };
  const labels = { started: "started", already_running: "already running", not_found: "binary not found", timeout: "timed out", spawn_error: "failed" };

  for (const result of results) {
    const r = result.status === "fulfilled" ? result.value : { name: "unknown", status: "spawn_error", error: result.reason?.message };
    const icon = icons[r.status] ?? "\x1b[31m?\x1b[0m";
    const label = labels[r.status] ?? r.status;
    const extra = r.pid ? ` (PID ${r.pid})` : r.error ? ` — ${r.error.slice(0, 80)}` : "";
    console.log(`    ${icon} ${r.name.padEnd(14)} ${label}${extra}`);
  }
  console.log("");
}

// Graceful shutdown
function shutdown(reason = "Shutting down", exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n  ${reason}...`);

  // Kill only runtimes we started
  for (const rt of runtimeProcesses) {
    if (rt.startedByUs) {
      terminateChild(rt.child);
    }
  }

  for (const child of children) {
    terminateChild(child);
  }
  setTimeout(() => process.exit(exitCode), 3000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  preflight();

  const existingDaemon = dashboardOnly ? null : readFreshDaemonHeartbeat();
  const existingDashboard = daemonOnly ? { state: "absent" } : await probeDashboard();

  if (!daemonOnly && existingDashboard.state === "occupied") {
    console.log("");
    console.log(`  \x1b[31mPort ${DASHBOARD_PORT} is already in use by another process.\x1b[0m`);
    console.log(`  Stop the existing service or change PORT before starting Jarvis.\n`);
    process.exit(1);
  }

  console.log("");
  console.log("  \x1b[1m\x1b[36mJarvis\x1b[0m — Starting...");
  console.log("");

  // Boot LLM runtimes (non-fatal — Jarvis works with partial runtimes)
  await bootRuntimes();

  if (!dashboardOnly) {
    if (existingDaemon) {
      console.log(`  Daemon already running (PID ${existingDaemon.pid}) — reusing existing process`);
    } else {
      console.log("  Starting daemon...");
      children.push(startService("Daemon", "npx", ["tsx", "packages/jarvis-runtime/src/daemon.ts"]));
    }
  }

  if (!daemonOnly) {
    if (existingDashboard.state === "jarvis") {
      console.log(`  Dashboard already running on ${DASHBOARD_URL} — reusing existing server`);
    } else {
      console.log(`  Starting dashboard on http://localhost:${DASHBOARD_PORT}`);
      children.push(startService("Dashboard", "npx", ["tsx", "packages/jarvis-dashboard/src/api/server.ts"], {
        NODE_ENV: "production",
      }));
    }
  }

  console.log("");

  if (children.length === 0) {
    console.log("  Jarvis is already running.");
    console.log("");
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("Shutting down", 0));
  process.on("SIGTERM", () => shutdown("Shutting down", 0));
}

main().catch((error) => {
  console.error(`\n  \x1b[31mJarvis start failed:\x1b[0m ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
