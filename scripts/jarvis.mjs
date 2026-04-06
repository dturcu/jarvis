#!/usr/bin/env node
/**
 * Jarvis CLI entrypoint.
 *
 * Dispatches to subcommands without adding a CLI framework dependency.
 *
 * Usage:
 *   node scripts/jarvis.mjs <command> [options]
 *   npm run jarvis -- <command> [options]
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const COMMANDS = {
  doctor: {
    description: "Check system health and prerequisites",
    run: () => tsx("packages/jarvis-runtime/src/doctor.ts"),
  },
  init: {
    description: "Initialize ~/.jarvis databases and config",
    run: () => tsx("scripts/init-jarvis.ts"),
  },
  migrate: {
    description: "Run pending database migrations",
    run: () => tsx("packages/jarvis-runtime/src/migrate-cli.ts"),
  },
  start: {
    description: "Start the Jarvis daemon",
    run: () => tsx("packages/jarvis-runtime/src/daemon.ts"),
  },
  stop: {
    description: "Stop the running Jarvis daemon",
    run: () => stopDaemon(),
  },
  status: {
    description: "Show daemon status",
    run: () => tsx("packages/jarvis-runtime/src/status-cli.ts"),
  },
  logs: {
    description: "Tail daemon logs",
    run: () => tailLogs(),
  },
  health: {
    description: "Run ops health check",
    run: () => runScript("node", ["scripts/ops/healthcheck.mjs"]),
  },
  backup: {
    description: "Create a runtime backup bundle",
    run: () => runScript("node", ["scripts/ops/backup-runtime.mjs"]),
  },
  restore: {
    description: "Restore from a backup bundle",
    run: () => runScript("node", ["scripts/ops/recover-runtime.mjs"]),
  },
  dashboard: {
    description: "Start the dashboard server",
    run: () => tsx("packages/jarvis-dashboard/src/api/server.ts"),
  },
  "benchmark-models": {
    description: "Benchmark locally available models",
    run: () => tsx("packages/jarvis-inference/src/benchmark-cli.ts"),
  },
  demo: {
    description: "Run a demo agent cycle",
    run: () => tsx("scripts/demo.ts"),
  },
};

function tsx(script) {
  return runScript("npx", ["tsx", script]);
}

function runScript(cmd, args) {
  const passthrough = process.argv.slice(3); // skip node, jarvis.mjs, command
  const child = spawn(cmd, [...args, ...passthrough], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

function stopDaemon() {
  tsx("packages/jarvis-runtime/src/stop-cli.ts");
}

function tailLogs() {
  const logFile = path.join(os.homedir(), ".jarvis", "daemon.log");
  const passthrough = process.argv.slice(3);
  const lines = passthrough.find(a => a.startsWith("-n"))?.slice(2) || "50";

  if (process.platform === "win32") {
    runScript("powershell", ["-Command", `Get-Content -Path "${logFile}" -Tail ${lines} -Wait`]);
  } else {
    runScript("tail", ["-f", "-n", lines, logFile]);
  }
}

function showHelp() {
  console.log("");
  console.log("  Jarvis CLI — Autonomous Agent System");
  console.log("");
  console.log("  Usage: jarvis <command> [options]");
  console.log("");
  console.log("  Commands:");
  const maxLen = Math.max(...Object.keys(COMMANDS).map(k => k.length));
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`    ${name.padEnd(maxLen + 2)} ${cmd.description}`);
  }
  console.log("");
  console.log("  Options:");
  console.log("    --help    Show this help message");
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
  console.error(`Unknown command: ${command}`);
  console.error(`Run "jarvis --help" for available commands.`);
  process.exit(1);
}

entry.run();
