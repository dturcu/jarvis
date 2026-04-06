#!/usr/bin/env node
/**
 * Jarvis Setup Wizard — guided first-time setup.
 *
 * Does everything a new user needs in one command:
 *   1. Check Node.js version
 *   2. Create ~/.jarvis directory + databases
 *   3. Generate config with smart defaults
 *   4. Detect available model runtimes (Ollama / LM Studio)
 *   5. Build the dashboard
 *   6. Run doctor to verify everything
 *
 * Usage:
 *   node scripts/setup-wizard.mjs          # Full interactive wizard
 *   node scripts/setup-wizard.mjs --all    # Non-interactive, all defaults
 *   node scripts/setup-wizard.mjs config   # Show/edit configuration
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import readline from "node:readline";
import crypto from "node:crypto";

const JARVIS_DIR = path.join(os.homedir(), ".jarvis");
const CONFIG_PATH = path.join(JARVIS_DIR, "config.json");
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");

// ─── Pretty Printing ─────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BLUE = "\x1b[34m";

function banner() {
  console.log("");
  console.log(`${BOLD}${CYAN}  ╔═══════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}  ║       Jarvis Setup Wizard             ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   Autonomous Agent System for         ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   Thinking in Code                    ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ╚═══════════════════════════════════════╝${RESET}`);
  console.log("");
}

function step(n, total, msg) {
  console.log(`\n${BOLD}${BLUE}  [${n}/${total}]${RESET} ${msg}`);
}

function ok(msg) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function skip(msg) { console.log(`  ${DIM}· ${msg}${RESET}`); }
function warning(msg) { console.log(`  ${YELLOW}!${RESET} ${msg}`); }
function error(msg) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`  ${DIM}${msg}${RESET}`); }

// ─── Interactive Input ────────────────────────────────────────────────────────

function createPrompt() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(rl, question, defaultVal) {
  const suffix = defaultVal ? ` ${DIM}(${defaultVal})${RESET}` : "";
  return new Promise(resolve => {
    rl.question(`  ${question}${suffix}: `, answer => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

async function confirm(rl, question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise(resolve => {
    rl.question(`  ${question} ${DIM}(${hint})${RESET}: `, answer => {
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

// ─── Step 1: Check Node.js ────────────────────────────────────────────────────

function checkNode() {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  if (major >= 22) {
    ok(`Node.js ${version}`);
    return true;
  }
  error(`Node.js ${version} — version 22+ is required`);
  console.log(`\n  ${BOLD}How to fix:${RESET}`);
  console.log(`    Download Node.js 22+ from https://nodejs.org`);
  console.log(`    Or use nvm: nvm install 22 && nvm use 22\n`);
  return false;
}

// ─── Step 2: Init Databases ───────────────────────────────────────────────────

function initDatabases() {
  if (!fs.existsSync(JARVIS_DIR)) {
    fs.mkdirSync(JARVIS_DIR, { recursive: true });
    ok("Created ~/.jarvis directory");
  } else {
    skip("~/.jarvis directory already exists");
  }

  // Run init-jarvis.ts
  try {
    execSync("npx tsx scripts/init-jarvis.ts", {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    ok("Databases initialized (CRM, Knowledge, Runtime)");
    return true;
  } catch (e) {
    error("Database initialization failed");
    console.log(`  ${DIM}${e.stderr?.toString().trim() || e.message}${RESET}`);
    console.log(`\n  ${BOLD}How to fix:${RESET} Run manually: npx tsx scripts/init-jarvis.ts`);
    return false;
  }
}

// ─── Step 3: Generate Config ──────────────────────────────────────────────────

async function generateConfig(rl, nonInteractive) {
  const existing = fs.existsSync(CONFIG_PATH);
  if (existing && !nonInteractive) {
    const overwrite = await confirm(rl, "Config already exists. Regenerate?", false);
    if (!overwrite) {
      skip("Keeping existing config.json");
      return;
    }
  } else if (existing) {
    skip("Keeping existing config.json");
    return;
  }

  let lmsUrl = "http://localhost:1234";
  let defaultModel = "auto";
  let logLevel = "info";

  if (!nonInteractive) {
    console.log("");
    info("Let's configure your Jarvis instance.\n");

    lmsUrl = await ask(rl, "LM Studio URL", "http://localhost:1234");
    defaultModel = await ask(rl, "Default model (or 'auto' for best available)", "auto");
    logLevel = await ask(rl, "Log level (debug/info/warn/error)", "info");
  }

  const config = {
    lmstudio_url: lmsUrl,
    default_model: defaultModel,
    adapter_mode: "real",
    poll_interval_ms: 60000,
    trigger_poll_ms: 10000,
    max_concurrent: 2,
    log_level: logLevel,
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  ok("Generated ~/.jarvis/config.json");

  // Generate .env if not exists
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    const envExample = path.join(REPO_ROOT, ".env.example");
    if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envPath);
      ok("Created .env from .env.example");
    }
  } else {
    skip(".env already exists");
  }
}

// ─── Step 4: Detect Model Runtimes ────────────────────────────────────────────

async function detectModels() {
  let found = false;

  // Check LM Studio
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch("http://localhost:1234/v1/models", { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      const count = data.data?.length ?? 0;
      ok(`LM Studio: ${count} model(s) available`);
      found = true;
    }
  } catch {
    warning("LM Studio not detected at localhost:1234");
    info("Start LM Studio and load a model to use local inference");
  }

  // Check Ollama
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      const count = data.models?.length ?? 0;
      ok(`Ollama: ${count} model(s) available`);
      found = true;
    }
  } catch {
    warning("Ollama not detected at localhost:11434");
    info("Install from https://ollama.com and run: ollama pull llama3.2");
  }

  if (!found) {
    console.log("");
    warning("No model runtime found. Jarvis needs at least one:");
    console.log(`    ${BOLD}Option A:${RESET} Install Ollama  → https://ollama.com`);
    console.log(`    ${BOLD}Option B:${RESET} Install LM Studio → https://lmstudio.ai`);
    console.log(`    Then run: ${CYAN}npm run jarvis doctor${RESET} to verify\n`);
  }

  return found;
}

// ─── Step 5: Build Dashboard ──────────────────────────────────────────────────

function buildDashboard() {
  const distPath = path.join(REPO_ROOT, "packages", "jarvis-dashboard", "dist", "index.html");
  if (fs.existsSync(distPath)) {
    skip("Dashboard already built");
    return true;
  }

  console.log(`  ${DIM}Building dashboard (this takes a moment)...${RESET}`);
  try {
    execSync("npm run dashboard:build", {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000,
    });
    ok("Dashboard built successfully");
    return true;
  } catch (e) {
    warning("Dashboard build failed — API will work but UI won't be available");
    info("Run manually later: npm run dashboard:build");
    return false;
  }
}

// ─── Step 6: Run Doctor ───────────────────────────────────────────────────────

function runDoctor() {
  try {
    const result = execSync("npx tsx packages/jarvis-runtime/src/doctor.ts", {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    const output = result.toString();
    const failMatch = output.match(/(\d+) failures/);
    const warnMatch = output.match(/(\d+) warnings/);
    const failures = parseInt(failMatch?.[1] ?? "0", 10);
    const warnings = parseInt(warnMatch?.[1] ?? "0", 10);

    if (failures === 0 && warnings === 0) {
      ok("All doctor checks passed");
    } else if (failures === 0) {
      ok(`Doctor: ${warnings} warning(s), no failures`);
    } else {
      warning(`Doctor: ${failures} failure(s), ${warnings} warning(s)`);
      info("Run: npm run jarvis doctor   for details");
    }
    return failures === 0;
  } catch {
    warning("Doctor check had issues");
    info("Run: npm run jarvis doctor   for details");
    return false;
  }
}

// ─── Config Command ───────────────────────────────────────────────────────────

function showConfig() {
  console.log(`\n  ${BOLD}Jarvis Configuration${RESET}\n`);

  if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`  No config found at ${CONFIG_PATH}`);
    console.log(`  Run: ${CYAN}npm run jarvis setup${RESET} to create one\n`);
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const keys = Object.keys(raw);
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "object" && value !== null) {
        console.log(`  ${BOLD}${key}:${RESET}`);
        for (const [k, v] of Object.entries(value)) {
          const display = k.includes("secret") || k.includes("token") || k.includes("password")
            ? "***" : String(v);
          console.log(`    ${k}: ${display}`);
        }
      } else {
        console.log(`  ${BOLD}${key}:${RESET} ${value}`);
      }
    }
  } catch (e) {
    error(`Failed to read config: ${e.message}`);
  }
  console.log("");
}

function setConfig(key, value) {
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  }

  // Handle nested keys like "telegram.bot_token"
  const parts = key.split(".");
  if (parts.length === 2) {
    if (!config[parts[0]]) config[parts[0]] = {};
    config[parts[0]][parts[1]] = isNaN(value) ? value : Number(value);
  } else {
    config[key] = isNaN(value) ? value : Number(value);
  }

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  ok(`Set ${key} = ${value}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // jarvis config show
  if (command === "config") {
    if (args[1] === "set" && args[2] && args[3]) {
      setConfig(args[2], args[3]);
    } else {
      showConfig();
    }
    return;
  }

  const nonInteractive = args.includes("--all") || args.includes("--yes") || args.includes("-y");
  const TOTAL_STEPS = 6;
  let allGood = true;

  banner();

  const rl = nonInteractive ? null : createPrompt();

  // Step 1
  step(1, TOTAL_STEPS, "Checking prerequisites");
  if (!checkNode()) {
    rl?.close();
    process.exit(1);
  }

  // Step 2
  step(2, TOTAL_STEPS, "Initializing databases");
  if (!initDatabases()) {
    allGood = false;
  }

  // Step 3
  step(3, TOTAL_STEPS, "Configuring Jarvis");
  await generateConfig(rl, nonInteractive);

  // Step 4
  step(4, TOTAL_STEPS, "Detecting model runtimes");
  const hasModels = await detectModels();
  if (!hasModels) allGood = false;

  // Step 5
  step(5, TOTAL_STEPS, "Building dashboard");
  buildDashboard();

  // Step 6
  step(6, TOTAL_STEPS, "Running health check");
  const healthy = runDoctor();
  if (!healthy) allGood = false;

  rl?.close();

  // Summary
  console.log("");
  console.log(`${BOLD}  ────────────────────────────────────────${RESET}`);
  if (allGood) {
    console.log(`\n  ${GREEN}${BOLD}Setup complete!${RESET} Jarvis is ready.\n`);
  } else {
    console.log(`\n  ${YELLOW}${BOLD}Setup complete with warnings.${RESET}\n`);
  }

  console.log(`  ${BOLD}Next steps:${RESET}`);
  console.log(`    ${CYAN}npm start${RESET}                  Start Jarvis (daemon + dashboard)`);
  console.log(`    ${CYAN}npm run jarvis doctor${RESET}      Check system health`);
  console.log(`    ${CYAN}npm run jarvis config${RESET}      View/edit configuration`);
  console.log("");

  if (!hasModels) {
    console.log(`  ${YELLOW}${BOLD}Important:${RESET} Install a model runtime before using agents:`);
    console.log(`    Ollama:     https://ollama.com`);
    console.log(`    LM Studio:  https://lmstudio.ai`);
    console.log("");
  }

  console.log(`  ${BOLD}Dashboard:${RESET}   http://localhost:4242`);
  console.log(`  ${BOLD}API Health:${RESET}  http://localhost:4242/api/health`);
  console.log(`  ${BOLD}Logs:${RESET}        npm run jarvis logs`);
  console.log("");
}

main().catch(e => {
  console.error(`\n  ${RED}Setup failed:${RESET} ${e.message}\n`);
  process.exit(1);
});
