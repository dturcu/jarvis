#!/usr/bin/env node
/**
 * Jarvis CLI — Autonomous Agent System
 *
 * Usage:
 *   jarvis <command> [options]
 *   npm run jarvis -- <command> [options]
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const COMMANDS = {
  // ── Getting Started ──
  setup: {
    description: "Interactive setup wizard (run this first!)",
    category: "setup",
    run: () => runScript("node", ["scripts/setup-wizard.mjs"]),
  },
  doctor: {
    description: "Check system health (use --fix to auto-fix)",
    category: "setup",
    run: () => tsx("packages/jarvis-runtime/src/doctor.ts"),
  },
  config: {
    description: "View or edit configuration",
    category: "setup",
    run: () => runScript("node", ["scripts/setup-wizard.mjs", "config"]),
  },
  init: {
    description: "Initialize databases only (use 'setup' instead)",
    category: "setup",
    run: () => tsx("scripts/init-jarvis.ts"),
  },

  // ── Running ──
  start: {
    description: "Start the Jarvis daemon",
    category: "run",
    run: () => tsx("packages/jarvis-runtime/src/daemon.ts"),
  },
  stop: {
    description: "Stop the running daemon",
    category: "run",
    run: () => tsx("packages/jarvis-runtime/src/stop-cli.ts"),
  },
  status: {
    description: "Show daemon status",
    category: "run",
    run: () => tsx("packages/jarvis-runtime/src/status-cli.ts"),
  },
  dashboard: {
    description: "Start the dashboard web UI",
    category: "run",
    run: () => tsx("packages/jarvis-dashboard/src/api/server.ts"),
  },
  logs: {
    description: "Tail daemon logs",
    category: "run",
    run: () => tailLogs(),
  },

  // ── Operations ──
  migrate: {
    description: "Run pending database migrations",
    category: "ops",
    run: () => tsx("packages/jarvis-runtime/src/migrate-cli.ts"),
  },
  health: {
    description: "Run ops health check",
    category: "ops",
    run: () => runScript("node", ["scripts/ops/healthcheck.mjs"]),
  },
  backup: {
    description: "Create a runtime backup",
    category: "ops",
    run: () => runScript("node", ["scripts/ops/backup-runtime.mjs"]),
  },
  restore: {
    description: "Restore from a backup",
    category: "ops",
    run: () => runScript("node", ["scripts/ops/recover-runtime.mjs"]),
  },
  "benchmark-models": {
    description: "Benchmark local models",
    category: "ops",
    run: () => tsx("packages/jarvis-inference/src/benchmark-cli.ts"),
  },
  demo: {
    description: "Run a demo agent cycle",
    category: "ops",
    run: () => tsx("scripts/demo.ts"),
  },
};

function tsx(script) {
  return runScript("npx", ["tsx", script]);
}

function runScript(cmd, args) {
  const passthrough = process.argv.slice(3);
  const child = spawn(cmd, [...args, ...passthrough], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

function tailLogs() {
  const logFile = path.join(os.homedir(), ".jarvis", "daemon.log");
  const passthrough = process.argv.slice(3);
  const lines = passthrough.find(a => a.startsWith("-n"))?.slice(2) || "50";

  // Check if log file exists
  if (!fs.existsSync(logFile)) {
    console.log(`\n  No log file found at ${logFile}`);
    console.log(`  Start the daemon first: npm run jarvis start\n`);
    process.exit(0);
  }

  if (process.platform === "win32") {
    runScript("powershell", ["-Command", `Get-Content -Path "${logFile}" -Tail ${lines} -Wait`]);
  } else {
    runScript("tail", ["-f", "-n", lines, logFile]);
  }
}

function showHelp() {
  console.log("");
  console.log("  \x1b[1m\x1b[36mJarvis\x1b[0m — Autonomous Agent System");
  console.log("  \x1b[2mFor Thinking in Code — automotive safety consulting\x1b[0m");
  console.log("");
  console.log("  \x1b[1mUsage:\x1b[0m jarvis <command> [options]");
  console.log("");

  const categories = {
    setup: "Getting Started",
    run:   "Running",
    ops:   "Operations",
  };

  const maxLen = Math.max(...Object.keys(COMMANDS).map(k => k.length));

  for (const [cat, label] of Object.entries(categories)) {
    console.log(`  \x1b[1m${label}:\x1b[0m`);
    for (const [name, cmd] of Object.entries(COMMANDS)) {
      if (cmd.category === cat) {
        const highlight = name === "setup" ? "\x1b[33m" : "";
        const reset = name === "setup" ? "\x1b[0m" : "";
        console.log(`    ${highlight}${name.padEnd(maxLen + 2)}${reset} ${cmd.description}`);
      }
    }
    console.log("");
  }

  console.log("  \x1b[1mQuick Start:\x1b[0m");
  console.log("    \x1b[36mnpm run jarvis setup\x1b[0m    Run the setup wizard");
  console.log("    \x1b[36mnpm start\x1b[0m               Start everything");
  console.log("");
}

// ─── Main ──────────────────────────────────────────────────────────────────

const command = process.argv[2];

if (!command || command === "--help" || command === "-h" || command === "help") {
  showHelp();
  process.exit(0);
}

const entry = COMMANDS[command];
if (!entry) {
  console.error(`\n  Unknown command: ${command}`);
  console.error(`  Run \x1b[36mjarvis --help\x1b[0m for available commands.\n`);
  process.exit(1);
}

entry.run();
