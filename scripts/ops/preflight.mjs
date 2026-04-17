#!/usr/bin/env node
/**
 * Jarvis Preflight — run the service verifier and print a human report.
 *
 * Usage:
 *   node scripts/ops/preflight.mjs                    # profile=runtime
 *   node scripts/ops/preflight.mjs --profile=bootstrap
 *   node scripts/ops/preflight.mjs --profile=full --json
 *
 * Profiles:
 *   bootstrap  Node + jarvis-dir; used by setup/bootstrap.ps1 post-install
 *   runtime    Node + dirs + config + (ollama OR lmstudio); pre-start sanity
 *   full       Runtime + dashboard :4242 reachable; post-start verify
 *
 * Exit codes: 0 = ok, 1 = failed, 2 = usage error.
 */

import { parseArgs, PROBE_PROFILES } from "./service-check-helpers.mjs";
import { runProfile } from "./service-check.mjs";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function mark(ok, optional) {
  if (ok) return `${GREEN}✓${RESET}`;
  return optional ? `${YELLOW}!${RESET}` : `${RED}✗${RESET}`;
}

function render(report) {
  const profile = PROBE_PROFILES[report.profile];
  const lines = [];
  lines.push(`${BOLD}Jarvis preflight · profile=${report.profile}${RESET}`);
  lines.push("");

  const shown = new Set();
  const printGroup = (label, names) => {
    if (!names.length) return;
    lines.push(`${DIM}${label}${RESET}`);
    for (const name of names) {
      const r = report.results[name];
      const optional = !profile.required.includes(name);
      const detail = r.ok
        ? summarizeDetail(name, r.detail)
        : `${r.detail} ${DIM}(${r.attempts} attempt${r.attempts === 1 ? "" : "s"}, ${r.elapsedMs}ms)${RESET}`;
      lines.push(`  ${mark(r.ok, optional)} ${name.padEnd(14)} ${detail}`);
      shown.add(name);
    }
    lines.push("");
  };

  printGroup("Required", profile.required);
  printGroup("At least one", profile.atLeastOne.flat());
  printGroup("Optional", profile.optional.filter((n) => !shown.has(n)));

  lines.push(`${BOLD}Status: ${report.status === "ok" ? GREEN + "ok" : RED + "failed"}${RESET}`);
  if (report.requiredFailed.length) {
    lines.push(`${RED}Required failed: ${report.requiredFailed.join(", ")}${RESET}`);
  }
  if (report.groupFailures.length) {
    lines.push(`${RED}At-least-one groups failed: ${report.groupFailures.join("; ")}${RESET}`);
  }
  return lines.join("\n");
}

function summarizeDetail(name, detail) {
  if (!detail) return "";
  switch (name) {
    case "node": return detail.version;
    case "git": return detail.version;
    case "npm-registry": return "reachable";
    case "jarvis-dir": return `${detail.dir} · ${detail.present.length} db`;
    case "config": return `adapter=${detail.adapter_mode} gmail=${detail.gmail} telegram=${detail.telegram}`;
    case "ollama": return `${detail.url} · ${detail.models.length} model${detail.models.length === 1 ? "" : "s"}`;
    case "lmstudio": return `${detail.url} · ${detail.models.length} model${detail.models.length === 1 ? "" : "s"}`;
    case "dashboard": return `${detail.url} · ${detail.httpStatus} · health=${detail.health}`;
    default: return JSON.stringify(detail);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profileName = args.profile ?? "runtime";
  const asJson = Boolean(args.json);
  const fast = Boolean(args.fast);

  if (!PROBE_PROFILES[profileName]) {
    process.stderr.write(`Unknown profile: ${profileName}\nAvailable: ${Object.keys(PROBE_PROFILES).join(", ")}\n`);
    process.exit(2);
  }

  const onProgress = asJson ? undefined : ({ phase, name }) => {
    if (phase === "start") process.stderr.write(`${DIM}· probing ${name}…${RESET}\r`);
  };
  const attemptsOverride = fast ? 2 : undefined;

  const report = await runProfile(profileName, { onProgress, attemptsOverride });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(report)}\n`);
  }

  process.exit(report.status === "ok" ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`preflight crashed: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
