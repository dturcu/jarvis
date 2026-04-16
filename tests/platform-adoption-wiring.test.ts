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
    expect(source).toContain("inferenceRuntimeTotal.labels(runtime).inc()");
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

describe("Runtime Wiring: Webhook routes REMOVED (Wave 1 retirement)", () => {
  it("server.ts does NOT mount webhook routes at all", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/server.ts");
    // webhookV2Router import must be commented out
    expect(source).toContain("// import { webhookV2Router }");
    // Must not have active app.use('/api/webhooks'
    expect(source).not.toMatch(/^\s*app\.use\(['"]\/api\/webhooks/m);
    // Must contain retirement comment
    expect(source).toContain("Wave 1 retirement");
  });
});

describe("Runtime Wiring: DreamingOrchestrator in daemon", () => {
  it("daemon.ts imports and constructs DreamingOrchestrator", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("DreamingOrchestrator");
    expect(source).toContain("PILOT_DREAMING_CONFIG");
    expect(source).toContain("new DreamingOrchestrator(dreamingConfig)");
  });

  it("daemon.ts emits dreaming metrics", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("dreamingRunsTotal.labels(");
    expect(source).toContain("dreamingSynthesisTotal.labels(");
  });

  it("daemon.ts gates dreaming on JARVIS_DREAMING_ENABLED env var", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("JARVIS_DREAMING_ENABLED");
  });
});

describe("Runtime Wiring: InferenceGovernor in worker-registry", () => {
  it("worker-registry.ts creates InferenceGovernor", () => {
    const source = readSource("packages/jarvis-runtime/src/worker-registry.ts");
    expect(source).toContain("new InferenceGovernor()");
  });

  it("worker-registry.ts records inference usage after execution", () => {
    const source = readSource("packages/jarvis-runtime/src/worker-registry.ts");
    expect(source).toContain("inferenceGovernor.recordUsage(");
    expect(source).toContain("inferenceGovernor.estimateCost(");
  });

  it("worker-registry.ts emits cost and local percentage metrics", () => {
    const source = readSource("packages/jarvis-runtime/src/worker-registry.ts");
    expect(source).toContain("inferenceCostUsdTotal.labels(");
    expect(source).toContain("inferenceLocalPercentage.set(");
  });
});

describe("Runtime Wiring: MemoryBoundaryChecker + WikiBridge in orchestrator", () => {
  it("orchestrator.ts imports MemoryBoundaryChecker and WikiBridge", () => {
    const source = readSource("packages/jarvis-runtime/src/orchestrator.ts");
    expect(source).toContain("MemoryBoundaryChecker");
    expect(source).toContain("WikiBridge");
  });

  it("OrchestratorDeps includes boundaryChecker and wikiBridge", () => {
    const source = readSource("packages/jarvis-runtime/src/orchestrator.ts");
    expect(source).toContain("boundaryChecker?: MemoryBoundaryChecker");
    expect(source).toContain("wikiBridge?: WikiBridge");
  });

  it("orchestrator validates memory boundaries at lesson capture", () => {
    const source = readSource("packages/jarvis-runtime/src/orchestrator.ts");
    expect(source).toContain("deps.boundaryChecker");
    expect(source).toContain("validateComplianceBoundary");
    expect(source).toContain("memoryBoundaryViolationsTotal");
  });

  it("orchestrator publishes lessons to wiki bridge", () => {
    const source = readSource("packages/jarvis-runtime/src/orchestrator.ts");
    expect(source).toContain("deps.wikiBridge");
    expect(source).toContain("wikiBridge.publish(");
    expect(source).toContain("wikiRetrievalTotal");
  });
});

describe("Runtime Wiring: BrowserPolicy in browser worker", () => {
  it("browser execute.ts accepts BrowserPolicyConfig", () => {
    const source = readSource("packages/jarvis-browser-worker/src/execute.ts");
    expect(source).toContain("BrowserPolicyConfig");
    expect(source).toContain("browserPolicy");
  });

  it("browser execute.ts enforces domain allowlist/blocklist", () => {
    const source = readSource("packages/jarvis-browser-worker/src/execute.ts");
    expect(source).toContain("allowed_domains");
    expect(source).toContain("blocked_domains");
    expect(source).toContain("BROWSER_POLICY_VIOLATION");
  });
});

describe("Runtime Wiring: OpenClaw model discovery in daemon", () => {
  it("daemon.ts imports OpenClawInferAdapter", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("OpenClawInferAdapter");
  });

  it("daemon.ts calls listModels() in model rediscovery loop", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("openClawAdapter.listModels()");
    expect(source).toContain('runtime: "openclaw"');
  });
});

describe("Runtime Wiring: ModelInfo.runtime includes openclaw", () => {
  it("router.ts ModelInfo type includes openclaw runtime", () => {
    const source = readSource("packages/jarvis-inference/src/router.ts");
    expect(source).toMatch(/runtime:\s*"ollama"\s*\|\s*"lmstudio"\s*\|\s*"llamacpp"\s*\|\s*"openclaw"/);
  });
});

describe("Runtime Wiring: OpenClaw infer in real inference execution path", () => {
  it("DefaultInferenceAdapter imports OpenClawInferAdapter", () => {
    const source = readSource("packages/jarvis-inference-worker/src/default-adapter.ts");
    expect(source).toContain("OpenClawInferAdapter");
  });

  it("chat() routes to OpenClaw when runtime is openclaw", () => {
    const source = readSource("packages/jarvis-inference-worker/src/default-adapter.ts");
    expect(source).toContain('selectedRuntime === "openclaw"');
    expect(source).toContain("chatViaOpenClaw");
  });

  it("visionChat() routes to OpenClaw when runtime is openclaw", () => {
    const source = readSource("packages/jarvis-inference-worker/src/default-adapter.ts");
    expect(source).toContain('fromRegistry.model.runtime === "openclaw"');
    expect(source).toContain("visionChatViaOpenClaw");
  });

  it("embed() routes to OpenClaw when model runtime is openclaw", () => {
    const source = readSource("packages/jarvis-inference-worker/src/default-adapter.ts");
    expect(source).toContain('registeredMatch.runtime === "openclaw"');
    expect(source).toContain("embedViaOpenClaw");
  });

  it("listModels() includes OpenClaw models in discovery", () => {
    const source = readSource("packages/jarvis-inference-worker/src/default-adapter.ts");
    expect(source).toContain("openClawAdapter.listModels()");
    expect(source).toContain('runtime: "openclaw"');
  });

  it("chatViaOpenClaw, visionChatViaOpenClaw, embedViaOpenClaw all exist as methods", () => {
    const source = readSource("packages/jarvis-inference-worker/src/default-adapter.ts");
    expect(source).toContain("private async chatViaOpenClaw(");
    expect(source).toContain("private async visionChatViaOpenClaw(");
    expect(source).toContain("private async embedViaOpenClaw(");
  });
});

describe("Runtime Wiring: Memory boundary enforce mode", () => {
  it("daemon reads JARVIS_MEMORY_BOUNDARY_MODE env var", () => {
    const source = readSource("packages/jarvis-runtime/src/daemon.ts");
    expect(source).toContain("JARVIS_MEMORY_BOUNDARY_MODE");
  });

  it("memory-boundary.ts throws MemoryBoundaryError in enforce mode", () => {
    const source = readSource("packages/jarvis-agent-framework/src/memory-boundary.ts");
    expect(source).toContain("throw new MemoryBoundaryError(");
    expect(source).toContain("class MemoryBoundaryError extends Error");
  });
});

describe("Runtime Wiring: Wiki search session tool", () => {
  it("wiki_search is in READONLY_TOOL_NAMES", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/tool-infra.ts");
    expect(source).toContain('"wiki_search"');
  });

  it("session-chat-adapter defines wiki_search tool with parameters", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/session-chat-adapter.ts");
    expect(source).toContain("wiki_search:");
    expect(source).toContain("curated knowledge wiki");
  });
});

describe("Runtime Wiring: Adoption dashboard with Prometheus data", () => {
  it("/api/tasks/adoption includes prometheus metric values", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/tasks.ts");
    expect(source).toContain("metrics.prometheus");
    expect(source).toContain("webhookIngressTotal");
    expect(source).toContain("inferenceRuntimeTotal");
    expect(source).toContain("dreamingRunsTotal");
  });

  it("/api/tasks/adoption evaluates release gates", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/tasks.ts");
    expect(source).toContain("release_gates");
    expect(source).toContain("all_gates_passed");
    expect(source).toContain("webhook_retired");
    expect(source).toContain("session_mode_active");
  });
});

describe("Runtime Wiring: TaskFlow cancel propagation", () => {
  it("/api/tasks/:id/cancel propagates to TaskFlow via gateway", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/tasks.ts");
    expect(source).toContain("taskflow.cancel");
    expect(source).toContain("flow_cancel_requested");
  });
});

describe("Runtime Wiring: /api/tasks populates provenance", () => {
  it("tasks router queries owner/source/trigger_kind from runs table", () => {
    const source = readSource("packages/jarvis-dashboard/src/api/tasks.ts");
    expect(source).toContain("r.owner");
    expect(source).toContain("r.trigger_kind");
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
