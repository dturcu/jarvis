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

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JARVIS_DIR = path.join(os.homedir(), ".jarvis");

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
  const child = spawn(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });

  child.on("error", (err) => {
    console.error(`\n  \x1b[31m${name} failed to start:\x1b[0m ${err.message}`);
    console.error(`  Try running manually: ${cmd} ${args.join(" ")}\n`);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\n  \x1b[33m${name} exited with code ${code}\x1b[0m`);
    }
  });

  return child;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

preflight();

console.log("");
console.log("  \x1b[1m\x1b[36mJarvis\x1b[0m — Starting...");
console.log("");

const children = [];

if (!dashboardOnly) {
  console.log("  Starting daemon...");
  children.push(startService("Daemon", "npx", ["tsx", "packages/jarvis-runtime/src/daemon.ts"]));
}

if (!daemonOnly) {
  console.log("  Starting dashboard on http://localhost:4242");
  children.push(startService("Dashboard", "npx", ["tsx", "packages/jarvis-dashboard/src/api/server.ts"], {
    NODE_ENV: "production",
  }));
}

console.log("");

// Graceful shutdown
function shutdown() {
  console.log("\n  Shutting down...");
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
