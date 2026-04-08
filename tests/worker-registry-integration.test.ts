import { beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, JOB_TIMEOUT_SECONDS } from "@jarvis/shared";
import type { JobEnvelope, JarvisJobType } from "@jarvis/shared";
import {
  createWorkerRegistry,
  buildEnvelope,
  type WorkerRegistry,
} from "@jarvis/runtime";
import { Logger } from "@jarvis/runtime";
import type { JarvisRuntimeConfig } from "@jarvis/runtime";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMockConfig(): JarvisRuntimeConfig {
  return {
    lmstudio_url: "http://localhost:1234",
    default_model: "test-model",
    adapter_mode: "mock",
    poll_interval_ms: 60_000,
    trigger_poll_ms: 10_000,
    log_level: "error", // suppress log noise
  };
}

function makeSilentLogger(): Logger {
  return new Logger("error", { logToFile: false, alertOnError: false });
}

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:test:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 60,
    attempt: 1,
    input,
    artifacts_in: [],
    metadata: {
      agent_id: "test",
      thread_key: null,
    },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// REGISTRY CREATION
// ═════════════════════════════════════════════════════════════════════════════

describe("Registry Creation", () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = createWorkerRegistry(makeMockConfig(), makeSilentLogger());
  });

  it("createWorkerRegistry with mock mode creates all workers", () => {
    // Registry should be created without errors
    expect(registry).toBeDefined();
    expect(typeof registry.executeJob).toBe("function");
    expect(typeof registry.chat).toBe("function");
  });

  it("registry has correct number of workers (13)", async () => {
    // Verify by testing 13 distinct prefixes all route successfully
    const prefixes = [
      "inference.chat",
      "email.search",
      "document.ingest",
      "crm.list_pipeline",
      "web.search_news",
      "calendar.list_events",
      "device.snapshot",
      "browser.navigate",
      "social.like",
      "system.monitor_cpu",
      "office.inspect",
      "interpreter.run_code",
      "files.inspect",
    ];

    for (const jobType of prefixes) {
      const env = buildEnvelope(jobType, {});
      const result = await registry.executeJob(env);
      // Even if a particular job fails due to missing input, it should NOT fail
      // with "No worker registered for prefix" - that means the worker is missing.
      expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    }
  });

  it("executeJob routes inference.chat to inference worker", async () => {
    const env = buildEnvelope("inference.chat", {
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.5,
      max_tokens: 100,
    });
    const result = await registry.executeJob(env);
    expect(result.job_type).toBe("inference.chat");
    // Mock adapter returns completed
    expect(result.status).toBe("completed");
  });

  it("executeJob routes email.search to email worker", async () => {
    const env = buildEnvelope("email.search", {
      query: "from:test@example.com",
      max_results: 10,
    });
    const result = await registry.executeJob(env);
    expect(result.job_type).toBe("email.search");
    expect(result.status).toBe("completed");
  });

  it("unknown prefix returns error result", async () => {
    const env = makeEnvelope("zebra.unknown", {});
    const result = await registry.executeJob(env);
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNKNOWN_JOB_TYPE");
    expect(result.error!.message).toContain("zebra");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// JOB ROUTING
// ═════════════════════════════════════════════════════════════════════════════

describe("Job Routing", () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = createWorkerRegistry(makeMockConfig(), makeSilentLogger());
  });

  it("inference.* routes to inference worker", async () => {
    const env = buildEnvelope("inference.chat", {
      messages: [{ role: "user", content: "test" }],
    });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("inference.chat");
  });

  it("email.* routes to email worker", async () => {
    const env = buildEnvelope("email.search", { query: "test", max_results: 5 });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("email.search");
  });

  it("document.* routes to document worker", async () => {
    const env = buildEnvelope("document.ingest", {
      source_artifact: { artifact_id: "doc-1" },
    });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("document.ingest");
  });

  it("crm.* routes to crm worker", async () => {
    const env = buildEnvelope("crm.list_pipeline", {});
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("crm.list_pipeline");
  });

  it("web.* routes to web worker", async () => {
    const env = buildEnvelope("web.search_news", { query: "automotive safety" });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("web.search_news");
  });

  it("calendar.* routes to calendar worker", async () => {
    const env = buildEnvelope("calendar.list_events", {
      start: "2026-04-01",
      end: "2026-04-07",
    });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("calendar.list_events");
  });

  it("device.* routes to device worker", async () => {
    const env = buildEnvelope("device.snapshot", {});
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("device.snapshot");
  });

  it("browser.* routes to browser worker", async () => {
    const env = buildEnvelope("browser.navigate", { url: "https://example.com" });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("browser.navigate");
    expect(result.status).toBe("completed");
  });

  it("social.* routes to social worker", async () => {
    const env = buildEnvelope("social.like", {
      platform: "linkedin",
      post_url: "https://linkedin.com/feed/update/urn:li:activity:999",
    });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("social.like");
    expect(result.status).toBe("completed");
  });

  it("system.* routes to system worker", async () => {
    const env = buildEnvelope("system.monitor_cpu", {});
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("system.monitor_cpu");
  });

  it("office.* routes to office worker", async () => {
    const env = buildEnvelope("office.inspect", {
      target_artifacts: [{ artifact_id: "art-1" }],
      inspect_mode: "auto",
      output_mode: "summary",
    });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("office.inspect");
    expect(result.status).toBe("completed");
  });

  it("interpreter.* routes to interpreter worker", async () => {
    const env = buildEnvelope("interpreter.run_code", {
      language: "javascript",
      code: "1+1",
      timeout_seconds: 10,
    });
    // interpreter.run_code requires approval — set approved state for routing test
    env.approval_state = "approved";
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("interpreter.run_code");
    expect(result.status).toBe("completed");
  });

  it("files.* routes to files worker", async () => {
    const env = buildEnvelope("files.inspect", { path: "." });
    const result = await registry.executeJob(env);
    expect(result.error?.code).not.toBe("UNKNOWN_JOB_TYPE");
    expect(result.job_type).toBe("files.inspect");
  });

  it("multiple jobs with different prefixes route independently", async () => {
    const envBrowser = buildEnvelope("browser.navigate", { url: "https://a.com" });
    const envSocial = buildEnvelope("social.scan_feed", { platform: "linkedin" });
    const envOffice = buildEnvelope("office.preview", {
      source_artifact: { artifact_id: "x" },
      format: "text",
      output_name: "p.txt",
    });

    const [r1, r2, r3] = await Promise.all([
      registry.executeJob(envBrowser),
      registry.executeJob(envSocial),
      registry.executeJob(envOffice),
    ]);

    expect(r1.job_type).toBe("browser.navigate");
    expect(r2.job_type).toBe("social.scan_feed");
    expect(r3.job_type).toBe("office.preview");
  });

  it("multiple unknown prefixes all return UNKNOWN_JOB_TYPE", async () => {
    const prefixes = ["alpha.test", "beta.test", "gamma.test"];
    for (const p of prefixes) {
      const env = makeEnvelope(p, {});
      const result = await registry.executeJob(env);
      expect(result.status).toBe("failed");
      expect(result.error!.code).toBe("UNKNOWN_JOB_TYPE");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CHAT HELPER
// ═════════════════════════════════════════════════════════════════════════════

describe("Chat Helper", () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = createWorkerRegistry(makeMockConfig(), makeSilentLogger());
  });

  it("chat() calls inference worker with correct prompt", async () => {
    const response = await registry.chat("What is 2+2?");
    expect(typeof response).toBe("string");
    expect(response.length).toBeGreaterThan(0);
  });

  it("chat() includes system prompt when provided", async () => {
    const response = await registry.chat("Explain ISO 26262", "You are a safety expert");
    expect(typeof response).toBe("string");
    expect(response.length).toBeGreaterThan(0);
  });

  it("chat() returns a string result", async () => {
    const result = await registry.chat("Hello");
    expect(typeof result).toBe("string");
  });

  it("chat() works with long prompts", async () => {
    const longPrompt = "Analyze " + "this ".repeat(200) + "text";
    const result = await registry.chat(longPrompt);
    expect(typeof result).toBe("string");
  });

  it("chat() works with empty system prompt", async () => {
    const result = await registry.chat("Test prompt", "");
    expect(typeof result).toBe("string");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildEnvelope
// ═════════════════════════════════════════════════════════════════════════════

describe("buildEnvelope", () => {
  it("creates valid envelope with UUID job_id", () => {
    const env = buildEnvelope("inference.chat", { messages: [] });
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(env.job_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("sets correct type", () => {
    const env = buildEnvelope("email.search", { query: "test" });
    expect(env.type).toBe("email.search");
  });

  it("uses timeout from contracts", () => {
    const env = buildEnvelope("office.merge_excel", { files: [] });
    const expectedTimeout = JOB_TIMEOUT_SECONDS["office.merge_excel" as JarvisJobType];
    expect(env.timeout_seconds).toBe(expectedTimeout);
    expect(env.timeout_seconds).toBe(900);
  });

  it("sets correct metadata", () => {
    const env = buildEnvelope("browser.navigate", { url: "https://example.com" });
    expect(env.metadata.agent_id).toBe("daemon");
    expect(env.metadata.thread_key).toBeNull();
    expect(env.requested_by.channel).toBe("agent");
    expect(env.requested_by.user_id).toBe("daemon");
  });

  it("sets contract_version, priority, approval_state, and attempt", () => {
    const env = buildEnvelope("social.like", {
      platform: "linkedin",
      post_url: "https://linkedin.com/p/1",
    });
    expect(env.contract_version).toBe("jarvis.v1");
    expect(env.priority).toBe("normal");
    expect(env.approval_state).toBe("not_required");
    expect(env.attempt).toBe(1);
    expect(env.artifacts_in).toEqual([]);
  });

  it("allows approval_state overrides for pre-approved actions", () => {
    const env = buildEnvelope("email.send", {
      to: ["test@example.com"],
      subject: "Hello",
      body_text: "world",
    }, {
      approval_state: "approved",
    });
    expect(env.approval_state).toBe("approved");
  });

  it("falls back to 120s timeout for unknown job types", () => {
    const env = buildEnvelope("unknown.type" as any, {});
    expect(env.timeout_seconds).toBe(120);
  });
});
