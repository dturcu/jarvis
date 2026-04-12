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

// Graceful shutdown
function shutdown(reason = "Shutting down", exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n  ${reason}...`);
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
