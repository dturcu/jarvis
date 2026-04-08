/**
 * Convergence Doctor Checks
 *
 * Reports on the state of the OpenClaw convergence program.
 * These checks are informational/advisory -- they do not block startup.
 *
 * Checks:
 * - JARVIS_TELEGRAM_MODE env var (warn if legacy)
 * - JARVIS_BROWSER_MODE env var (warn if legacy)
 * - JARVIS_SCHEDULE_SOURCE env var (info if external)
 * - Deprecated files still exist but are marked (informational)
 */

import fs from "node:fs";
import { resolve } from "node:path";

export type ConvergenceCheck = {
  name: string;
  status: "pass" | "warn" | "info";
  message: string;
};

/**
 * Deprecated files that should still exist (for backwards compatibility)
 * but must contain a `@deprecated` marker in their source.
 */
const DEPRECATED_FILES: Array<{ relativePath: string; label: string }> = [
  { relativePath: "packages/jarvis-dashboard/src/api/godmode.ts", label: "Godmode (legacy LM Studio loop)" },
  { relativePath: "packages/jarvis-dashboard/src/api/chat.ts", label: "Chat (legacy direct chat)" },
  { relativePath: "packages/jarvis-telegram/src/chat-handler.ts", label: "Telegram chat handler (legacy)" },
];

/**
 * Run all convergence-related doctor checks.
 *
 * @param projectRoot  Absolute path to the monorepo root.
 *   Defaults to `process.cwd()` when omitted.
 */
export function runConvergenceChecks(projectRoot?: string): ConvergenceCheck[] {
  const root = projectRoot ?? process.cwd();
  const results: ConvergenceCheck[] = [];

  // ── Telegram Mode ─────────────────────────────────────────────────────
  const telegramMode = (process.env.JARVIS_TELEGRAM_MODE ?? "").toLowerCase();
  if (telegramMode === "legacy") {
    results.push({
      name: "Convergence: Telegram Mode",
      status: "warn",
      message:
        'JARVIS_TELEGRAM_MODE=legacy -- using deprecated direct Telegram transport. ' +
        'Remove JARVIS_TELEGRAM_MODE or set to "session" to use OpenClaw sessions.',
    });
  } else if (telegramMode === "session" || telegramMode === "") {
    results.push({
      name: "Convergence: Telegram Mode",
      status: "pass",
      message: telegramMode
        ? "JARVIS_TELEGRAM_MODE=session -- using OpenClaw session adapter"
        : "JARVIS_TELEGRAM_MODE not set -- defaults to session (converged)",
    });
  } else {
    results.push({
      name: "Convergence: Telegram Mode",
      status: "warn",
      message: `JARVIS_TELEGRAM_MODE="${telegramMode}" -- unrecognized value. Expected "session" or "legacy".`,
    });
  }

  // ── Browser Mode ──────────────────────────────────────────────────────
  const browserMode = (process.env.JARVIS_BROWSER_MODE ?? "").toLowerCase();
  if (browserMode === "legacy") {
    results.push({
      name: "Convergence: Browser Mode",
      status: "warn",
      message:
        'JARVIS_BROWSER_MODE=legacy -- using deprecated direct Puppeteer bridge. ' +
        'Remove JARVIS_BROWSER_MODE or set to "openclaw" to use the OpenClaw browser bridge.',
    });
  } else if (browserMode === "openclaw" || browserMode === "") {
    results.push({
      name: "Convergence: Browser Mode",
      status: "pass",
      message: browserMode
        ? "JARVIS_BROWSER_MODE=openclaw -- using OpenClaw browser bridge"
        : "JARVIS_BROWSER_MODE not set -- defaults to openclaw (converged)",
    });
  } else {
    results.push({
      name: "Convergence: Browser Mode",
      status: "warn",
      message: `JARVIS_BROWSER_MODE="${browserMode}" -- unrecognized value. Expected "openclaw" or "legacy".`,
    });
  }

  // ── Schedule Source ───────────────────────────────────────────────────
  const scheduleSource = (process.env.JARVIS_SCHEDULE_SOURCE ?? "").toLowerCase();
  if (scheduleSource === "external") {
    results.push({
      name: "Convergence: Schedule Source",
      status: "info",
      message:
        "JARVIS_SCHEDULE_SOURCE=external -- schedules managed by OpenClaw TaskFlow (external)",
    });
  } else if (scheduleSource === "db" || scheduleSource === "") {
    results.push({
      name: "Convergence: Schedule Source",
      status: "pass",
      message: scheduleSource
        ? "JARVIS_SCHEDULE_SOURCE=db -- using internal DB scheduler"
        : "JARVIS_SCHEDULE_SOURCE not set -- defaults to db (internal)",
    });
  } else {
    results.push({
      name: "Convergence: Schedule Source",
      status: "info",
      message: `JARVIS_SCHEDULE_SOURCE="${scheduleSource}" -- non-standard schedule source`,
    });
  }

  // ── Deprecated Files ──────────────────────────────────────────────────
  for (const { relativePath, label } of DEPRECATED_FILES) {
    const fullPath = resolve(root, relativePath);
    if (!fs.existsSync(fullPath)) {
      results.push({
        name: `Convergence: ${label}`,
        status: "info",
        message: `${relativePath} -- already removed (convergence complete for this file)`,
      });
      continue;
    }

    try {
      const source = fs.readFileSync(fullPath, "utf8");
      if (source.includes("@deprecated")) {
        results.push({
          name: `Convergence: ${label}`,
          status: "pass",
          message: `${relativePath} -- exists and marked @deprecated`,
        });
      } else {
        results.push({
          name: `Convergence: ${label}`,
          status: "warn",
          message: `${relativePath} -- exists but NOT marked @deprecated. Add @deprecated JSDoc tag.`,
        });
      }
    } catch {
      results.push({
        name: `Convergence: ${label}`,
        status: "info",
        message: `${relativePath} -- could not read file`,
      });
    }
  }

  return results;
}
