import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  resetJarvisState
} from "@jarvis/shared";
import {
  MockAgentAdapter,
  createAgentWorker,
  executeAgentJob,
  isAgentJobType,
  AGENT_JOB_TYPES
} from "@jarvis/agent-worker";
import type { JobEnvelope } from "@jarvis/shared";

const MOCK_NOW = "2026-04-04T12:00:00.000Z";

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:main:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 30,
    attempt: 1,
    input,
    artifacts_in: [],
    retry_policy: { mode: "manual", max_attempts: 3 },
    metadata: {
      agent_id: "main",
      thread_key: null
    },
    ...overrides
  };
}

describe("AGENT_JOB_TYPES", () => {
  it("contains all 6 agent job types", () => {
    expect(AGENT_JOB_TYPES).toHaveLength(6);
    expect(AGENT_JOB_TYPES).toContain("agent.start");
    expect(AGENT_JOB_TYPES).toContain("agent.step");
    expect(AGENT_JOB_TYPES).toContain("agent.status");
    expect(AGENT_JOB_TYPES).toContain("agent.pause");
    expect(AGENT_JOB_TYPES).toContain("agent.resume");
    expect(AGENT_JOB_TYPES).toContain("agent.configure");
  });
});

describe("isAgentJobType", () => {
  it("returns true for known agent job types", () => {
    for (const type of AGENT_JOB_TYPES) {
      expect(isAgentJobType(type)).toBe(true);
    }
  });

  it("returns false for unknown job types", () => {
    expect(isAgentJobType("system.monitor_cpu")).toBe(false);
    expect(isAgentJobType("device.snapshot")).toBe(false);
    expect(isAgentJobType("unknown.job")).toBe(false);
    expect(isAgentJobType("")).toBe(false);
  });
});

describe("createAgentWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("creates a worker with the default workerId", () => {
    const worker = createAgentWorker({ adapter: new MockAgentAdapter() });
    expect(worker.workerId).toBe("agent-worker");
  });

  it("respects a custom workerId", () => {
    const worker = createAgentWorker({
      adapter: new MockAgentAdapter(),
      workerId: "my-agent-worker"
    });
    expect(worker.workerId).toBe("my-agent-worker");
  });

  it("executes a job via the worker facade", async () => {
    const worker = createAgentWorker({ adapter: new MockAgentAdapter() });
    const envelope = makeEnvelope("agent.start", {
      agent_id: "bd-pipeline",
      trigger_kind: "manual"
    });
    const result = await worker.execute(envelope);
    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("agent-worker");
  });
});

describe("executeAgentJob — agent.start", () => {
  let adapter: MockAgentAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockAgentAdapter();
  });

  it("happy path — result.status is completed and run_id exists", async () => {
    const envelope = makeEnvelope("agent.start", {
      agent_id: "bd-pipeline",
      trigger_kind: "manual"
    });
    const result = await executeAgentJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("agent.start");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.run_id).toBe("string");
    expect(out.run_id).toBeTruthy();
    expect(out.agent_id).toBe("bd-pipeline");
    expect(out.status).toBe("planning");
  });

  it("unknown agent returns failed with AGENT_NOT_FOUND", async () => {
    const envelope = makeEnvelope("agent.start", {
      agent_id: "nonexistent-agent",
      trigger_kind: "manual"
    });
    const result = await executeAgentJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AGENT_NOT_FOUND");
    expect(result.error?.message).toContain("nonexistent-agent");
    expect(result.error?.retryable).toBe(false);
  });

  it("start with explicit goal sets goal in output", async () => {
    const envelope = makeEnvelope("agent.start", {
      agent_id: "proposal-engine",
      trigger_kind: "manual",
      goal: "Draft Q2 proposal"
    });
    const result = await executeAgentJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.goal).toBe("Draft Q2 proposal");
  });

  it("start with trigger_kind manual succeeds", async () => {
    const envelope = makeEnvelope("agent.start", {
      agent_id: "content-engine",
      trigger_kind: "manual"
    });
    const result = await executeAgentJob(envelope, adapter);
    expect(result.status).toBe("completed");
  });

  it("start with trigger_kind schedule succeeds", async () => {
    const envelope = makeEnvelope("agent.start", {
      agent_id: "garden-calendar",
      trigger_kind: "schedule"
    });
    const result = await executeAgentJob(envelope, adapter);
    expect(result.status).toBe("completed");
  });
});

describe("executeAgentJob — agent.step", () => {
  let adapter: MockAgentAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockAgentAdapter();
  });

  it("happy path — structured_output.step is 1", async () => {
    const startEnvelope = makeEnvelope("agent.start", {
      agent_id: "bd-pipeline",
      trigger_kind: "manual"
    });
    const startResult = await executeAgentJob(startEnvelope, adapter);
    const run_id = (startResult.structured_output as Record<string, unknown>).run_id as string;

    const stepEnvelope = makeEnvelope("agent.step", { run_id });
    const result = await executeAgentJob(stepEnvelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.step).toBe(1);
    expect(out.run_id).toBe(run_id);
    expect(typeof out.action).toBe("string");
    expect(typeof out.reasoning).toBe("string");
  });

  it("unknown run_id returns failed with RUN_NOT_FOUND", async () => {
    const envelope = makeEnvelope("agent.step", { run_id: "nonexistent-run" });
    const result = await executeAgentJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_NOT_FOUND");
  });

  it("step increments: calling step 3 times yields step = 3", async () => {
    const startEnvelope = makeEnvelope("agent.start", {
      agent_id: "evidence-auditor",
      trigger_kind: "event"
    });
    const startResult = await executeAgentJob(startEnvelope, adapter);
    const run_id = (startResult.structured_output as Record<string, unknown>).run_id as string;

    for (let i = 1; i <= 3; i++) {
      const stepEnvelope = makeEnvelope("agent.step", { run_id });
      const result = await executeAgentJob(stepEnvelope, adapter);
      expect(result.status).toBe("completed");
      const out = result.structured_output as Record<string, unknown>;
      expect(out.step).toBe(i);
    }
  });
});

describe("executeAgentJob — agent.status", () => {
  let adapter: MockAgentAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockAgentAdapter();
  });

  it("returns active_runs count correctly (0 before any starts)", async () => {
    const envelope = makeEnvelope("agent.status", { agent_id: "bd-pipeline" });
    const result = await executeAgentJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.agent_id).toBe("bd-pipeline");
    expect(out.active_runs).toBe(0);
    expect(out.total_runs).toBe(0);
  });

  it("after start — total_runs is 1", async () => {
    await executeAgentJob(
      makeEnvelope("agent.start", { agent_id: "proposal-engine", trigger_kind: "manual" }),
      adapter
    );

    const result = await executeAgentJob(
      makeEnvelope("agent.status", { agent_id: "proposal-engine" }),
      adapter
    );

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.total_runs).toBe(1);
    expect(out.active_runs).toBe(1);
  });

  it("status after configure still shows run correctly", async () => {
    await executeAgentJob(
      makeEnvelope("agent.start", { agent_id: "staffing-monitor", trigger_kind: "threshold" }),
      adapter
    );
    await executeAgentJob(
      makeEnvelope("agent.configure", {
        agent_id: "staffing-monitor",
        updates: { task_profile: { objective: "classify" } }
      }),
      adapter
    );

    const result = await executeAgentJob(
      makeEnvelope("agent.status", { agent_id: "staffing-monitor" }),
      adapter
    );

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.total_runs).toBe(1);
  });
});

describe("executeAgentJob — agent.pause", () => {
  let adapter: MockAgentAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockAgentAdapter();
  });

  it("pause sets status to paused", async () => {
    const startResult = await executeAgentJob(
      makeEnvelope("agent.start", { agent_id: "contract-reviewer", trigger_kind: "manual" }),
      adapter
    );
    const run_id = (startResult.structured_output as Record<string, unknown>).run_id as string;

    const result = await executeAgentJob(
      makeEnvelope("agent.pause", { run_id }),
      adapter
    );

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.status).toBe("paused");
    expect(out.run_id).toBe(run_id);
    expect(typeof out.paused_at).toBe("string");
  });

  it("pause with unknown run_id returns failed", async () => {
    const result = await executeAgentJob(
      makeEnvelope("agent.pause", { run_id: "bad-run-id" }),
      adapter
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_NOT_FOUND");
  });
});

describe("executeAgentJob — agent.resume", () => {
  let adapter: MockAgentAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockAgentAdapter();
  });

  it("resume after pause sets status to executing", async () => {
    const startResult = await executeAgentJob(
      makeEnvelope("agent.start", { agent_id: "portfolio-monitor", trigger_kind: "schedule" }),
      adapter
    );
    const run_id = (startResult.structured_output as Record<string, unknown>).run_id as string;

    await executeAgentJob(makeEnvelope("agent.pause", { run_id }), adapter);

    const result = await executeAgentJob(
      makeEnvelope("agent.resume", { run_id }),
      adapter
    );

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.status).toBe("executing");
    expect(out.run_id).toBe(run_id);
    expect(typeof out.resumed_at).toBe("string");
  });

  it("pause then resume full sequence works", async () => {
    const startResult = await executeAgentJob(
      makeEnvelope("agent.start", { agent_id: "content-engine", trigger_kind: "manual" }),
      adapter
    );
    const run_id = (startResult.structured_output as Record<string, unknown>).run_id as string;

    const pauseResult = await executeAgentJob(
      makeEnvelope("agent.pause", { run_id }),
      adapter
    );
    expect(pauseResult.status).toBe("completed");
    expect((pauseResult.structured_output as Record<string, unknown>).status).toBe("paused");

    const resumeResult = await executeAgentJob(
      makeEnvelope("agent.resume", { run_id }),
      adapter
    );
    expect(resumeResult.status).toBe("completed");
    expect((resumeResult.structured_output as Record<string, unknown>).status).toBe("executing");
  });
});

describe("executeAgentJob — agent.configure", () => {
  let adapter: MockAgentAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockAgentAdapter();
  });

  it("applied_updates includes the updated key", async () => {
    const result = await executeAgentJob(
      makeEnvelope("agent.configure", {
        agent_id: "bd-pipeline",
        updates: { task_profile: { objective: "plan" } }
      }),
      adapter
    );

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.applied_updates)).toBe(true);
    expect(out.applied_updates).toContain("task_profile");
  });

  it("configure returns applied_updates array with correct keys", async () => {
    const result = await executeAgentJob(
      makeEnvelope("agent.configure", {
        agent_id: "proposal-engine",
        updates: { task_profile: { objective: "plan", preferences: { prioritize_accuracy: true } }, max_steps_per_run: 10 }
      }),
      adapter
    );

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const applied = out.applied_updates as string[];
    expect(applied).toContain("task_profile");
    expect(applied).toContain("max_steps_per_run");
    expect(applied).toHaveLength(2);
  });

  it("configure task_profile update", async () => {
    const result = await executeAgentJob(
      makeEnvelope("agent.configure", {
        agent_id: "evidence-auditor",
        updates: { task_profile: { objective: "classify", preferences: { prioritize_speed: true } } }
      }),
      adapter
    );

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.agent_id).toBe("evidence-auditor");
    expect(out.applied_updates).toContain("task_profile");
  });

  it("configure max_steps_per_run update", async () => {
    const result = await executeAgentJob(
      makeEnvelope("agent.configure", {
        agent_id: "garden-calendar",
        updates: { max_steps_per_run: 20 }
      }),
      adapter
    );

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.applied_updates).toContain("max_steps_per_run");
  });
});

describe("executeAgentJob — metrics and callbacks", () => {
  let adapter: MockAgentAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockAgentAdapter();
  });

  it("result metrics include worker_id = agent-worker", async () => {
    const envelope = makeEnvelope("agent.start", {
      agent_id: "bd-pipeline",
      trigger_kind: "manual"
    });
    const result = await executeAgentJob(envelope, adapter);

    expect(result.metrics?.worker_id).toBe("agent-worker");
  });

  it("result metrics include started_at and finished_at", async () => {
    const envelope = makeEnvelope("agent.start", {
      agent_id: "proposal-engine",
      trigger_kind: "manual"
    });
    const result = await executeAgentJob(envelope, adapter);

    expect(result.metrics?.started_at).toBeTruthy();
    expect(result.metrics?.finished_at).toBeTruthy();
  });

  it("toCallback produces valid WorkerCallback structure", async () => {
    const worker = createAgentWorker({ adapter: new MockAgentAdapter() });
    const envelope = makeEnvelope("agent.start", {
      agent_id: "content-engine",
      trigger_kind: "schedule"
    });
    const result = await worker.execute(envelope);
    const callback = worker.toCallback(result);

    expect(callback.contract_version).toBe(CONTRACT_VERSION);
    expect(callback.job_id).toBe(result.job_id);
    expect(callback.job_type).toBe("agent.start");
    expect(callback.status).toBe("completed");
    expect(typeof callback.worker_id).toBe("string");
    expect(callback.worker_id).toBe("agent-worker");
    expect(callback.metrics?.worker_id).toBe("agent-worker");
  });

  it("multiple starts for same agent are tracked separately", async () => {
    await executeAgentJob(
      makeEnvelope("agent.start", { agent_id: "bd-pipeline", trigger_kind: "manual" }),
      adapter
    );
    await executeAgentJob(
      makeEnvelope("agent.start", { agent_id: "bd-pipeline", trigger_kind: "schedule" }),
      adapter
    );

    const statusResult = await executeAgentJob(
      makeEnvelope("agent.status", { agent_id: "bd-pipeline" }),
      adapter
    );

    const out = statusResult.structured_output as Record<string, unknown>;
    expect(out.total_runs).toBe(2);
    expect(out.active_runs).toBe(2);
  });

  it("error code in failed result matches AgentWorkerError code", async () => {
    const envelope = makeEnvelope("agent.start", {
      agent_id: "unknown-agent-xyz",
      trigger_kind: "manual"
    });
    const result = await executeAgentJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AGENT_NOT_FOUND");
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("device.snapshot", {});
    const result = await executeAgentJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("device.snapshot");
    expect(result.error?.retryable).toBe(false);
  });
});
