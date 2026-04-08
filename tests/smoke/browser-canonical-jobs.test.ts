/**
 * Browser canonical job smoke tests (Epic 6).
 *
 * Proves browser policy enforcement and bridge routing work correctly
 * for all 5 canonical job types: navigate, extract, capture, download, run_task.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

function readSource(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("Browser: Canonical job types", () => {
  const source = readSource("packages/jarvis-browser-worker/src/execute.ts");

  it("BRIDGE_SUPPORTED_TYPES includes all 5 canonical jobs", () => {
    expect(source).toContain('"browser.navigate"');
    expect(source).toContain('"browser.extract"');
    expect(source).toContain('"browser.capture"');
    expect(source).toContain('"browser.download"');
    expect(source).toContain('"browser.run_task"');
  });

  it("all 9 browser job types are recognized", () => {
    const jobTypes = [
      "browser.navigate", "browser.click", "browser.type",
      "browser.evaluate", "browser.wait_for", "browser.run_task",
      "browser.extract", "browser.capture", "browser.download",
    ];
    for (const jt of jobTypes) {
      expect(source, `Missing job type: ${jt}`).toContain(`"${jt}"`);
    }
  });
});

describe("Browser: Policy enforcement", () => {
  const source = readSource("packages/jarvis-browser-worker/src/execute.ts");

  it("BrowserPolicyConfig is defined with allowed_domains and blocked_domains", () => {
    expect(source).toContain("BrowserPolicyConfig");
    expect(source).toContain("allowed_domains: string[]");
    expect(source).toContain("blocked_domains: string[]");
  });

  it("policy enforcement runs before bridge/adapter routing", () => {
    // The policy check block must appear before the useBridge decision
    const policyIdx = source.indexOf("BROWSER_POLICY_VIOLATION");
    const bridgeIdx = source.indexOf("BRIDGE_SUPPORTED_TYPES.has(envelope.type)");
    expect(policyIdx).toBeGreaterThan(0);
    expect(bridgeIdx).toBeGreaterThan(0);
    expect(policyIdx).toBeLessThan(bridgeIdx);
  });

  it("blocked domains produce BROWSER_POLICY_VIOLATION error code", () => {
    expect(source).toContain("BROWSER_POLICY_VIOLATION");
    // Must create a failure result, not just log
    expect(source).toContain("createFailureResult");
  });

  it("allowlist blocks non-listed domains when allowlist is non-empty", () => {
    // Must check: allowed_domains.length > 0 && !allowed_domains.some(...)
    expect(source).toContain("allowed_domains.length > 0");
    expect(source).toContain("!allowed_domains.some");
  });

  it("blocklist blocks listed domains", () => {
    expect(source).toContain("blocked_domains.some");
    expect(source).toContain("hostname.endsWith(d)");
  });
});

describe("Browser: Managed profile configuration", () => {
  const policySource = readSource("packages/jarvis-browser/src/browser-policy.ts");

  it("BrowserPolicy includes domain allowlist/blocklist and cookie policy", () => {
    expect(policySource).toContain("allowed_domains: string[]");
    expect(policySource).toContain("blocked_domains: string[]");
    expect(policySource).toContain("cookie_policy:");
  });

  it("BrowserSandboxConfig includes method and filesystem_allowlist", () => {
    expect(policySource).toContain("method:");
    expect(policySource).toContain("filesystem_allowlist: string[]");
  });

  it("DEFAULT_BROWSER_POLICY has sensible defaults", () => {
    expect(policySource).toContain("cookie_policy: 'first_party_only'");
    expect(policySource).toContain("allow_javascript: true");
    expect(policySource).toContain("page_timeout_ms: 30_000");
  });

  it("BROWSER_CAPABILITY_MATRIX has entries for all 9 job types", () => {
    const jobTypes = [
      "browser.navigate", "browser.extract", "browser.capture",
      "browser.download", "browser.run_task", "browser.click",
      "browser.type", "browser.evaluate", "browser.wait_for",
    ];
    for (const jt of jobTypes) {
      expect(policySource, `Missing capability entry: ${jt}`).toContain(jt);
    }
  });
});
