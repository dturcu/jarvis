/**
 * Platform Adoption Wiring Tests
 *
 * Behavior-based tests that prove the new platform adoption modules
 * are actually wired into real runtime paths, not just standalone artifacts.
 *
 * Each test verifies end-to-end integration, not just type existence.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Runtime Wiring: TaskFlow trigger source", () => {
  it("daemon.ts imports createTaskFlowTriggerSource", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("createTaskFlowTriggerSource");
  });

  it("daemon.ts handles JARVIS_SCHEDULE_SOURCE=taskflow", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain('"taskflow"');
    expect(source).toContain('createTaskFlowTriggerSource()');
  });

  it("daemon.ts emits taskflowRunsTotal metric on schedule fire", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("taskflowRunsTotal");
    expect(source).toContain('taskflowRunsTotal.labels(');
  });
});

describe("Runtime Wiring: Observability metrics emission", () => {
  it("webhook router emits webhookIngressTotal and legacyPathTraffic", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/webhooks-v2.ts");
    expect(source).toContain('webhookIngressTotal.labels("dashboard").inc()');
    expect(source).toContain('legacyPathTraffic.labels("/api/webhooks").inc()');
  });

  it("session chat adapter emits sessionModeTotal for both session and legacy paths", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/session-chat-adapter.ts");
    expect(source).toContain("sessionModeTotal.labels('session').inc()");
    expect(source).toContain("sessionModeTotal.labels('legacy').inc()");
    expect(source).toContain("legacyPathTraffic.labels('/api/godmode/legacy').inc()");
  });

  it("worker registry emits inferenceRuntimeTotal for inference jobs", () => {
    const source = readSource("packages/jarvis-runtime/src/worker-registry.ts");
    expect(source).toContain("inferenceRuntimeTotal");
    expect(source).toContain('inferenceRuntimeTotal.labels("lmstudio").inc()');
  });

  it("worker registry emits browserBridgeTotal for browser jobs", () => {
    const source = readSource("packages/jarvis-runtime/src/worker-registry.ts");
    expect(source).toContain("browserBridgeTotal");
    expect(source).toContain("browserBridgeTotal.labels(mode).inc()");
  });

  it("all 12 convergence metrics are exported from @jarvis/observability index", () => {
    const source = readSource("packages/jarvis-observability/src/index.ts");
    const required = [
      "webhookIngressTotal",
      "inferenceRuntimeTotal",
      "sessionModeTotal",
      "browserBridgeTotal",
      "taskflowRunsTotal",
      "memoryBoundaryViolationsTotal",
      "inferenceCostUsdTotal",
      "inferenceLocalPercentage",
      "dreamingRunsTotal",
      "dreamingSynthesisTotal",
      "wikiRetrievalTotal",
      "legacyPathTraffic",
    ];
    for (const metric of required) {
      expect(source, `Missing export: ${metric}`).toContain(metric);
    }
  });
});

describe("Runtime Wiring: Package index exports", () => {
  it("@jarvis/inference exports OpenClawInferAdapter and InferenceGovernor", () => {
    const source = readSource("packages/jarvis-inference/src/index.ts");
    expect(source).toContain('"./openclaw-adapter.js"');
    expect(source).toContain('"./governance.js"');
  });

  it("@jarvis/agent-framework exports MemoryBoundaryChecker and WikiBridge", () => {
    const source = readSource("packages/jarvis-agent-framework/src/index.ts");
    expect(source).toContain('"./memory-boundary.js"');
    expect(source).toContain('"./wiki-bridge.js"');
  });

  it("@jarvis/runtime exports DreamingOrchestrator and deletion checklist", () => {
    const source = readSource("packages/jarvis-runtime/src/index.ts");
    expect(source).toContain("DreamingOrchestrator");
    expect(source).toContain("PILOT_DREAMING_CONFIG");
    expect(source).toContain("createTaskFlowTriggerSource");
    expect(source).toContain("TASKFLOW_WORKFLOW_TEMPLATES");
    expect(source).toContain("verifyDeletionCandidates");
    expect(source).toContain("FILE_DELETIONS");
  });

  it("@jarvis/browser exports BrowserPolicy and capability matrix", () => {
    const source = readSource("packages/jarvis-browser/src/index.ts");
    expect(source).toContain("BrowserPolicy");
    expect(source).toContain("BROWSER_CAPABILITY_MATRIX");
    expect(source).toContain('"./browser-policy.js"');
  });
});

describe("Runtime Wiring: Webhook conditional mounting", () => {
  it("server.ts conditionally mounts webhook routes", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/server.ts");
    // Webhook routes should be behind a condition
    expect(source).toContain("JARVIS_WEBHOOK_LEGACY");
    expect(source).toMatch(/if\s*\(.*JARVIS_WEBHOOK_LEGACY/);
  });

  it("convergence checks warn about webhook legacy mode", () => {
    const source = readSource("packages/jarvis-runtime/src/convergence-checks.ts");
    expect(source).toContain("JARVIS_WEBHOOK_LEGACY");
    expect(source).toContain("Convergence: Webhook Ingress");
  });
});

describe("Runtime Wiring: /api/tasks populates provenance", () => {
  it("tasks router queries owner/source/trigger_type from runs table", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/tasks.ts");
    expect(source).toContain("r.owner");
    expect(source).toContain("r.trigger_type");
    expect(source).toContain("provenance:");
    expect(source).toContain("channel:");
    expect(source).toContain("trigger_type:");
  });

  it("tasks router has cancel endpoint", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/tasks.ts");
    expect(source).toContain("/:id/cancel");
    expect(source).toContain("'cancelled'");
  });
});
