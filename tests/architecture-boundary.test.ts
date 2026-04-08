/**
 * Architecture Boundary Tests
 *
 * Enforces the platform/kernel boundary defined in ADR-PLATFORM-KERNEL-BOUNDARY.md.
 * These tests fail the build if code introduces forbidden integration patterns that
 * duplicate OpenClaw platform ownership.
 *
 * Four boundary rules:
 * 1. Only OpenClaw talks to Telegram
 * 2. Only OpenClaw owns external webhook ingress
 * 3. Only OpenClaw owns the operator chat loop (LLM orchestration)
 * 4. Only OpenClaw owns browser runtime
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

// ─── Helpers ─────────────────────────────────────────────────────────

interface Violation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function getSourceFiles(): string[] {
  const result = execSync(
    `git ls-files "packages/**/*.ts" "packages/**/*.mts" "scripts/**/*.ts" "scripts/**/*.mjs"`,
    { cwd: ROOT, encoding: "utf8" }
  );
  return result.split("\n").filter(Boolean);
}

function readSource(relativePath: string): string {
  const fullPath = resolve(ROOT, relativePath);
  if (!existsSync(fullPath)) return "";
  return readFileSync(fullPath, "utf8");
}

function scanForPattern(
  files: string[],
  pattern: RegExp,
  reason: string,
  exclude?: RegExp
): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (exclude?.test(file)) continue;
    const source = readSource(file);
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        const trimmed = lines[i].trim();
        // Skip comments
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
        violations.push({ file, line: i + 1, text: trimmed, reason });
      }
    }
  }
  return violations;
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => `  ${v.file}:${v.line} — ${v.reason}\n    ${v.text}`)
    .join("\n");
}

// ─── Known Legacy Exclusions ─────────────────────────────────────────
// These files ARE the duplication targets. They're excluded from boundary
// checks because they are the files scheduled for replacement/removal.
// Each exclusion references the convergence epic that will address it.

const LEGACY_TELEGRAM = /packages[\\/]jarvis-telegram[\\/]/;               // Epic 3
const LEGACY_GODMODE = /packages[\\/]jarvis-dashboard[\\/]src[\\/]api[\\/](godmode|chat)\.(ts|mts)$/; // Epic 5
const LEGACY_WEBHOOKS = /packages[\\/]jarvis-dashboard[\\/]src[\\/]api[\\/]webhooks(-v2)?\.(ts|mts)$/; // Epic 4
const LEGACY_BROWSER_WORKER = /packages[\\/]jarvis-browser-worker[\\/]/;   // Epic 6

const ALL_LEGACY = new RegExp(
  [
    LEGACY_TELEGRAM.source,
    LEGACY_GODMODE.source,
    LEGACY_WEBHOOKS.source,
    LEGACY_BROWSER_WORKER.source,
  ].join("|")
);

// ─── Tests ───────────────────────────────────────────────────────────

const allFiles = getSourceFiles();

describe("Architecture Boundary: Platform/Kernel Split", () => {
  describe("Rule 1: Only OpenClaw talks to Telegram", () => {
    it("no api.telegram.org URL in non-legacy source", () => {
      const violations = scanForPattern(
        allFiles,
        /api\.telegram\.org/,
        "Direct Telegram API URL (ADR rule 1: only OpenClaw talks to Telegram)",
        ALL_LEGACY
      );
      expect(violations, formatViolations(violations)).toHaveLength(0);
    });

    it("no node-telegram-bot-api import in non-legacy source", () => {
      const violations = scanForPattern(
        allFiles,
        /from\s+["']node-telegram-bot-api["']|require\(["']node-telegram-bot-api["']\)/,
        "Telegram SDK import (ADR rule 1: only OpenClaw talks to Telegram)",
        ALL_LEGACY
      );
      expect(violations, formatViolations(violations)).toHaveLength(0);
    });

    it("no TelegramBot constructor in non-legacy source", () => {
      const violations = scanForPattern(
        allFiles,
        /new\s+TelegramBot\s*\(/,
        "TelegramBot instantiation (ADR rule 1: only OpenClaw talks to Telegram)",
        ALL_LEGACY
      );
      expect(violations, formatViolations(violations)).toHaveLength(0);
    });
  });

  describe("Rule 2: Only OpenClaw owns external webhook ingress", () => {
    it("no new webhook Express routes with direct DB insertion outside legacy", () => {
      // Match any identifier.post/put with "webhook" in the path string,
      // not just "router." — catches webhookV2Router.post, app.post, etc.
      const violations = scanForPattern(
        allFiles,
        /\w+\.(post|put)\s*\(\s*["'][^"']*webhook/i,
        "Webhook route definition (ADR rule 2: external ingress via OpenClaw)",
        ALL_LEGACY
      );
      expect(violations, formatViolations(violations)).toHaveLength(0);
    });
  });

  describe("Rule 3: Only OpenClaw owns the operator chat loop", () => {
    it("no direct LM Studio chat/completions URL outside inference packages", () => {
      const exclude = new RegExp(
        [
          ALL_LEGACY.source,
          /packages[\\/]jarvis-inference[\\/]/.source,
          /packages[\\/]jarvis-inference-worker[\\/]/.source,
        ].join("|")
      );
      const violations = scanForPattern(
        allFiles,
        /localhost:1234\/v1\/chat\/completions/,
        "Direct model API URL outside inference layer (ADR rule 3: operator chat via OpenClaw sessions)",
        exclude
      );
      expect(violations, formatViolations(violations)).toHaveLength(0);
    });
  });

  describe("Rule 4: Only OpenClaw owns browser runtime", () => {
    it("no puppeteer connect/launch in non-legacy source", () => {
      const violations = scanForPattern(
        allFiles,
        /puppeteer\.(connect|launch)\s*\(/,
        "Direct Puppeteer connect/launch (ADR rule 4: browser runtime via OpenClaw)",
        ALL_LEGACY
      );
      expect(violations, formatViolations(violations)).toHaveLength(0);
    });

    it("no direct CDP WebSocket URL in non-legacy source", () => {
      const violations = scanForPattern(
        allFiles,
        /ws:\/\/(127\.0\.0\.1|localhost):9222/,
        "Direct CDP WebSocket URL (ADR rule 4: browser runtime via OpenClaw)",
        ALL_LEGACY
      );
      expect(violations, formatViolations(violations)).toHaveLength(0);
    });
  });

  describe("ADR documentation completeness", () => {
    it("ADR-PLATFORM-KERNEL-BOUNDARY.md exists", () => {
      const adrPath = resolve(ROOT, "docs/ADR-PLATFORM-KERNEL-BOUNDARY.md");
      expect(existsSync(adrPath)).toBe(true);
    });

    it("ADR documents the migration map with all four statuses", () => {
      const content = readFileSync(resolve(ROOT, "docs/ADR-PLATFORM-KERNEL-BOUNDARY.md"), "utf8");
      expect(content).toContain("Package Migration Map");
      expect(content).toContain("Core (keep and harden)");
      expect(content).toContain("Adapter (wrap then replace)");
      expect(content).toContain("Deprecated (replace then delete)");
    });
  });

  describe("Legacy inventory (convergence tracker)", () => {
    const LEGACY_TARGETS = [
      { path: "packages/jarvis-telegram/src/index.ts", epic: "Epic 3: Channel Convergence", rule: 1 },
      { path: "packages/jarvis-dashboard/src/api/webhooks.ts", epic: "Epic 4: Webhook Convergence", rule: 2 },
      { path: "packages/jarvis-dashboard/src/api/godmode.ts", epic: "Epic 5: Godmode Unification", rule: 3 },
      { path: "packages/jarvis-dashboard/src/api/chat.ts", epic: "Epic 5: Chat Convergence", rule: 3 },
    ];

    it("tracks remaining legacy duplication files", () => {
      const remaining = LEGACY_TARGETS.filter((t) => existsSync(resolve(ROOT, t.path)));

      // Informational — logs which legacy files still exist.
      // Once convergence epics land, tighten this to expect(remaining).toHaveLength(0).
      if (remaining.length > 0) {
        console.log(`\n  Legacy duplication: ${remaining.length}/${LEGACY_TARGETS.length} files remain`);
        for (const r of remaining) {
          console.log(`    [Rule ${r.rule}] ${r.path} — ${r.epic}`);
        }
      }

      // Current expected count: all 4 legacy files still present.
      // Decrease this as each convergence epic removes its target.
      expect(remaining.length).toBe(LEGACY_TARGETS.length);
    });
  });
});
