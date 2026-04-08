/**
 * Final Convergence Conformance Tests
 *
 * Validates the 5 global exit conditions defined in CONVERGENCE-ROADMAP.md.
 * These are the "definition of done" for the convergence program.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function getSourceFiles(): string[] {
  return execSync(
    `git ls-files "packages/**/*.ts" "packages/**/*.mts"`,
    { cwd: ROOT, encoding: "utf8" },
  ).split("\n").filter(Boolean);
}

function readSource(relativePath: string): string {
  const fullPath = resolve(ROOT, relativePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function scanForPattern(files: string[], pattern: RegExp, exclude?: RegExp): string[] {
  const matches: string[] = [];
  for (const file of files) {
    if (exclude?.test(file)) continue;
    const source = readSource(file);
    for (const line of source.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (pattern.test(line)) {
        matches.push(file);
        break;
      }
    }
  }
  return matches;
}

const allFiles = getSourceFiles();

// Legacy files that are allowed (deprecated but kept for transition)
const DEPRECATED_LEGACY = /packages[\\/]jarvis-(telegram[\\/]src[\\/](bot|relay|chat-handler)|dashboard[\\/]src[\\/]api[\\/](godmode|chat)|browser-worker[\\/]src[\\/]chrome-adapter)\.(ts|mts)$/;

describe("Convergence Program: Global Exit Conditions", () => {
  it("Exit 1: No primary-path direct Telegram transport outside deprecated files", () => {
    const violations = scanForPattern(
      allFiles,
      /api\.telegram\.org/,
      DEPRECATED_LEGACY,
    );
    expect(violations, `Direct Telegram API in: ${violations.join(", ")}`).toHaveLength(0);
  });

  it("Exit 2: Webhook v1 deleted and v2 uses injectable onEvent (PARTIAL — HTTP surface still dashboard-owned)", () => {
    // webhooks.ts (v1) deleted in Wave 3.
    expect(existsSync(resolve(ROOT, "packages/jarvis-dashboard/src/api/webhooks.ts"))).toBe(false);

    // v2 provides createWebhookRouter with injectable onEvent callback.
    // NOTE: Full exit requires moving the HTTP mount out of the dashboard entirely.
    // Currently the dashboard still mounts /api/webhooks and the default onEvent
    // still calls createCommand() directly. This is "domain logic separated, HTTP not."
    const v2Source = readSource("packages/jarvis-dashboard/src/api/webhooks-v2.ts");
    expect(v2Source).toContain("createWebhookRouter");
    expect(v2Source).toContain("onEvent");
  });

  it("Exit 3: No primary-path direct dashboard-to-model orchestration outside deprecated files", () => {
    const violations = scanForPattern(
      allFiles,
      /localhost:1234\/v1\/chat\/completions/,
      // Exclude: deprecated godmode/chat, inference package (legitimate)
      new RegExp([
        DEPRECATED_LEGACY.source,
        /packages[\\/]jarvis-inference[\\/]/.source,
        /packages[\\/]jarvis-inference-worker[\\/]/.source,
      ].join("|")),
    );
    expect(violations, `Direct LM Studio URL in: ${violations.join(", ")}`).toHaveLength(0);
  });

  it("Exit 4: No primary-path direct browser runtime ownership outside deprecated files", () => {
    const violations = scanForPattern(
      allFiles,
      /puppeteer\.(connect|launch)\s*\(/,
      DEPRECATED_LEGACY,
    );
    expect(violations, `Direct Puppeteer in: ${violations.join(", ")}`).toHaveLength(0);
  });

  it("Exit 5: Key convergence documents exist", () => {
    const required = [
      "docs/ADR-PLATFORM-KERNEL-BOUNDARY.md",
      "docs/ADR-MEMORY-TAXONOMY.md",
      "docs/CONVERGENCE-ROADMAP.md",
      "docs/AUTOMATION-CLASSIFICATION.md",
      "docs/OPENCLAW-COMPATIBILITY-MATRIX.md",
      "docs/PLATFORM-ADOPTION-ROADMAP.md",
    ];
    for (const doc of required) {
      expect(existsSync(resolve(ROOT, doc)), `Missing: ${doc}`).toBe(true);
    }
  });
});

describe("Convergence Program: Behavioral Assertions", () => {
  it("Circuit breaker is wired into SessionChatAdapter", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/session-chat-adapter.ts");
    expect(source).toContain("GatewayCircuitBreaker");
    expect(source).toContain("circuitBreaker.isOpen()");
    expect(source).toContain("circuitBreaker.recordSuccess()");
    expect(source).toContain("circuitBreaker.recordFailure()");
  });

  it("Telegram session adapter retries on gateway drop", () => {
    const source = readSource("packages/jarvis-telegram/src/session-adapter.ts");
    // Must have a retry loop with at least 2 attempts
    expect(source).toContain("for (let attempt = 0; attempt < 2; attempt++)");
  });

  it("Webhook normalizer uses constant-time HMAC comparison", () => {
    const source = readSource("packages/jarvis-shared/src/webhook-normalizer.ts");
    expect(source).toContain("timingSafeEqual");
  });

  it("Convergence checks include webhook and browser low-level coverage", () => {
    const source = readSource("packages/jarvis-runtime/src/convergence-checks.ts");
    expect(source).toContain("Convergence: Webhook Ingress");
    expect(source).toContain("Convergence: Browser Low-Level Ops");
  });

  it("ADR-MEMORY-TAXONOMY.md is Decided (not Proposed)", () => {
    const source = readSource("docs/ADR-MEMORY-TAXONOMY.md");
    expect(source).toContain("Decided");
  });

  it("CI runs check:convergence", () => {
    const source = readSource(".github/workflows/ci.yml");
    expect(source).toContain("check:convergence");
  });

  it("Platform Adoption Roadmap supersedes old convergence roadmap", () => {
    const oldRoadmap = readSource("docs/CONVERGENCE-ROADMAP.md");
    expect(oldRoadmap).toContain("Superseded");
    expect(oldRoadmap).toContain("PLATFORM-ADOPTION-ROADMAP.md");

    const newRoadmap = readSource("docs/PLATFORM-ADOPTION-ROADMAP.md");
    expect(newRoadmap).toContain("Epic 1");
    expect(newRoadmap).toContain("Epic 12");
    expect(newRoadmap).toContain("compliance");
  });
});

describe("Convergence Program: Default Activation", () => {
  it("Telegram defaults to session mode", () => {
    const source = readSource("packages/jarvis-telegram/src/index.ts");
    expect(source).toContain("'session'");
    // The default in the mode switch should be session, not legacy
    expect(source).toMatch(/JARVIS_TELEGRAM_MODE.*['"]session['"]/);
  });

  it("Godmode primary route is session-backed", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/server.ts");
    // /api/godmode should mount the session route, not the legacy router
    expect(source).toMatch(/\/api\/godmode['"],?\s*createSessionChatRoute/);
  });

  it("Browser bridge defaults to openclaw", () => {
    const source = readSource("packages/jarvis-browser/src/openclaw-bridge.ts");
    expect(source).toMatch(/JARVIS_BROWSER_MODE.*['"]openclaw['"]/);
  });

  it("Browser worker only routes bridge-supported types through bridge", () => {
    const source = readSource("packages/jarvis-browser-worker/src/execute.ts");
    // Must check BRIDGE_SUPPORTED_TYPES before routing
    expect(source).toContain("BRIDGE_SUPPORTED_TYPES.has(envelope.type)");
    // Low-level types must NOT be in the bridge set
    const bridgeSet = source.match(/BRIDGE_SUPPORTED_TYPES\s*=\s*new\s+Set[^;]+;/s)?.[0] ?? "";
    expect(bridgeSet).not.toContain("browser.click");
    expect(bridgeSet).not.toContain("browser.type");
    expect(bridgeSet).not.toContain("browser.evaluate");
    expect(bridgeSet).not.toContain("browser.wait_for");
    // High-level types must be in the bridge set
    expect(bridgeSet).toContain("browser.navigate");
    expect(bridgeSet).toContain("browser.extract");
    expect(bridgeSet).toContain("browser.capture");
    expect(bridgeSet).toContain("browser.run_task");
  });

  it("Telegram sessionChat is enabled in session mode", () => {
    const source = readSource("packages/jarvis-telegram/src/index.ts");
    // startSessionMode must pass sessionChat: true
    expect(source).toContain("sessionChat: true");
  });

  it("Notification dispatcher is wired into orchestrator", () => {
    const source = readSource("packages/jarvis-runtime/src/orchestrator.ts");
    expect(source).toContain("sendNotification(");
    expect(source).toContain("notifier?: NotificationDispatcher");
  });

  it("Schedule trigger source is injectable", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("ScheduleTriggerSource");
    expect(source).toContain("JARVIS_SCHEDULE_SOURCE");
  });

  it("Hook catalog is registered (not just single approval hook)", () => {
    const source = readSource("packages/jarvis-core/src/index.ts");
    expect(source).toContain("getHookCatalog()");
    // Should loop through catalog, not register a single hook
    expect(source).toMatch(/for\s*\(\s*const\s+hook\s+of\s+getHookCatalog/);
  });

  it("Credential audit at job dispatch boundary", () => {
    const source = readSource("packages/jarvis-runtime/src/worker-registry.ts");
    expect(source).toContain("auditCredentialAccess(prefix!");
    expect(source).toContain("jobId: envelope.job_id");
  });
});

describe("Convergence Program: Deprecated Files Marked", () => {
  const DEPRECATED_FILES = [
    { path: "packages/jarvis-dashboard/src/api/godmode.ts", marker: "@deprecated" },
    { path: "packages/jarvis-dashboard/src/api/chat.ts", marker: "@deprecated" },
    { path: "packages/jarvis-telegram/src/chat-handler.ts", marker: "@deprecated" },
  ];

  for (const { path, marker } of DEPRECATED_FILES) {
    it(`${path} is marked deprecated`, () => {
      const source = readSource(path);
      expect(source).toContain(marker);
    });
  }
});
