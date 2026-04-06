import { beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, resetJarvisState } from "@jarvis/shared";
import {
  MockInterpreterAdapter,
  createMockInterpreterAdapter,
  createInterpreterWorker,
  executeInterpreterJob,
  isInterpreterJobType,
  INTERPRETER_JOB_TYPES,
  InterpreterWorkerError
} from "@jarvis/interpreter-worker";
import type { JobEnvelope } from "@jarvis/shared";

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
    approval_state: "approved",
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

// ── INTERPRETER_JOB_TYPES ─────────────────────────────────────────────────────

describe("INTERPRETER_JOB_TYPES", () => {
  it("contains all 3 interpreter job types", () => {
    expect(INTERPRETER_JOB_TYPES).toHaveLength(3);
    expect(INTERPRETER_JOB_TYPES).toContain("interpreter.run_task");
    expect(INTERPRETER_JOB_TYPES).toContain("interpreter.run_code");
    expect(INTERPRETER_JOB_TYPES).toContain("interpreter.status");
  });
});

describe("isInterpreterJobType", () => {
  it("returns true for known interpreter job types", () => {
    for (const type of INTERPRETER_JOB_TYPES) {
      expect(isInterpreterJobType(type)).toBe(true);
    }
  });

  it("returns false for unknown job types", () => {
    expect(isInterpreterJobType("device.snapshot")).toBe(false);
    expect(isInterpreterJobType("inference.chat")).toBe(false);
    expect(isInterpreterJobType("unknown.job")).toBe(false);
    expect(isInterpreterJobType("")).toBe(false);
  });

  it("returns false for partial interpreter types", () => {
    expect(isInterpreterJobType("interpreter")).toBe(false);
    expect(isInterpreterJobType("interpreter.")).toBe(false);
    expect(isInterpreterJobType("interpreter.nonexistent")).toBe(false);
  });
});

// ── MockInterpreterAdapter ────────────────────────────────────────────────────

describe("MockInterpreterAdapter", () => {
  let adapter: MockInterpreterAdapter;

  beforeEach(() => {
    adapter = new MockInterpreterAdapter();
  });

  describe("runTask", () => {
    it("returns a session_id and steps", async () => {
      const result = await adapter.runTask({
        task: "Download a file and summarize it",
        auto_approve: false
      });
      expect(result.structured_output.session_id).toBeTruthy();
      expect(Array.isArray(result.structured_output.steps)).toBe(true);
      expect(result.structured_output.steps.length).toBeGreaterThan(0);
      expect(result.structured_output.artifacts).toEqual([]);
    });

    it("echoes the task in the output", async () => {
      const task = "Create a Python script to read a CSV file";
      const result = await adapter.runTask({ task, auto_approve: false });
      expect(result.structured_output.final_output).toContain("Create a Python script");
    });

    it("generates code steps with a language", async () => {
      const result = await adapter.runTask({
        task: "Write some code",
        auto_approve: false
      });
      const codeSteps = result.structured_output.steps.filter((s) => s.type === "code");
      expect(codeSteps.length).toBeGreaterThan(0);
      expect(codeSteps[0]?.language).toBeTruthy();
    });

    it("returns a non-empty summary", async () => {
      const result = await adapter.runTask({ task: "A task", auto_approve: false });
      expect(result.summary).toBeTruthy();
      expect(result.summary).toContain("session=");
    });

    it("tracks run_task calls", async () => {
      await adapter.runTask({ task: "First task", auto_approve: false });
      await adapter.runTask({ task: "Second task", auto_approve: true });
      expect(adapter.getRunTaskCalls()).toHaveLength(2);
      expect(adapter.getRunTaskCalls()[0]?.task).toBe("First task");
      expect(adapter.getRunTaskCalls()[1]?.task).toBe("Second task");
    });

    it("each call returns a unique session_id", async () => {
      const r1 = await adapter.runTask({ task: "Task 1", auto_approve: false });
      const r2 = await adapter.runTask({ task: "Task 2", auto_approve: false });
      expect(r1.structured_output.session_id).not.toBe(r2.structured_output.session_id);
    });
  });

  describe("runCode", () => {
    it("returns exit_code 0 for normal execution", async () => {
      const result = await adapter.runCode({
        language: "python",
        code: "print('hello')",
        timeout_seconds: 30
      });
      expect(result.structured_output.exit_code).toBe(0);
      expect(result.structured_output.stdout).toBeTruthy();
      expect(result.structured_output.stderr).toBe("");
    });

    it("includes execution_time_ms in the output", async () => {
      const result = await adapter.runCode({
        language: "javascript",
        code: "console.log('test')",
        timeout_seconds: 60
      });
      expect(result.structured_output.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it("includes the language in the summary", async () => {
      const result = await adapter.runCode({
        language: "shell",
        code: "echo hello",
        timeout_seconds: 10
      });
      expect(result.summary).toContain("shell");
    });

    it("tracks run_code calls", async () => {
      await adapter.runCode({ language: "python", code: "pass", timeout_seconds: 10 });
      await adapter.runCode({ language: "shell", code: "ls", timeout_seconds: 10 });
      expect(adapter.getRunCodeCalls()).toHaveLength(2);
      expect(adapter.getRunCodeCalls()[0]?.language).toBe("python");
      expect(adapter.getRunCodeCalls()[1]?.language).toBe("shell");
    });

    it("handles all supported languages", async () => {
      for (const language of ["python", "javascript", "shell"] as const) {
        const result = await adapter.runCode({
          language,
          code: `# ${language} code`,
          timeout_seconds: 30
        });
        expect(result.structured_output.exit_code).toBe(0);
      }
    });
  });

  describe("status", () => {
    it("returns empty sessions when no tasks have been run", async () => {
      const result = await adapter.status({});
      expect(result.structured_output.active_sessions).toEqual([]);
    });

    it("returns sessions after running tasks", async () => {
      await adapter.runTask({ task: "Task A", auto_approve: false });
      await adapter.runTask({ task: "Task B", auto_approve: false });
      const result = await adapter.status({});
      expect(result.structured_output.active_sessions).toHaveLength(2);
    });

    it("filters by session_id when provided", async () => {
      const r1 = await adapter.runTask({ task: "Task A", auto_approve: false });
      await adapter.runTask({ task: "Task B", auto_approve: false });
      const sessionId = r1.structured_output.session_id;
      const result = await adapter.status({ session_id: sessionId });
      expect(result.structured_output.active_sessions).toHaveLength(1);
      expect(result.structured_output.active_sessions[0]?.session_id).toBe(sessionId);
    });

    it("throws InterpreterWorkerError for unknown session_id", async () => {
      await expect(
        adapter.status({ session_id: "00000000-0000-0000-0000-000000000000" })
      ).rejects.toThrow(InterpreterWorkerError);
    });

    it("each session has required fields", async () => {
      await adapter.runTask({ task: "Test task", auto_approve: false });
      const result = await adapter.status({});
      for (const session of result.structured_output.active_sessions) {
        expect(session.session_id).toBeTruthy();
        expect(session.task).toBeTruthy();
        expect(session.started_at).toBeTruthy();
        expect(["running", "completed", "failed"]).toContain(session.status);
      }
    });

    it("addRunningSession helper adds a running session", async () => {
      const sessionId = adapter.addRunningSession("A background task");
      const result = await adapter.status({ session_id: sessionId });
      expect(result.structured_output.active_sessions[0]?.status).toBe("running");
      expect(result.structured_output.active_sessions[0]?.task).toBe("A background task");
    });

    it("setSessionStatus helper changes session status", async () => {
      const r = await adapter.runTask({ task: "Task", auto_approve: false });
      const sessionId = r.structured_output.session_id;
      adapter.setSessionStatus(sessionId, "failed");
      const result = await adapter.status({ session_id: sessionId });
      expect(result.structured_output.active_sessions[0]?.status).toBe("failed");
    });
  });
});

// ── executeInterpreterJob ─────────────────────────────────────────────────────

describe("executeInterpreterJob", () => {
  let adapter: MockInterpreterAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockInterpreterAdapter();
  });

  it("produces a completed JobResult for interpreter.run_task", async () => {
    const envelope = makeEnvelope("interpreter.run_task", {
      task: "Analyze the log file and report anomalies",
      auto_approve: false
    });
    const result = await executeInterpreterJob(envelope, adapter);

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_id).toBe(envelope.job_id);
    expect(result.job_type).toBe("interpreter.run_task");
    expect(result.status).toBe("completed");
    expect(result.attempt).toBe(1);
    expect(result.summary).toBeTruthy();
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.session_id).toBe("string");
    expect(Array.isArray(out.steps)).toBe(true);
    expect(Array.isArray(out.artifacts)).toBe(true);
    expect(result.metrics?.worker_id).toBe("interpreter-worker");
  });

  it("produces a completed JobResult for interpreter.run_code (python)", async () => {
    const envelope = makeEnvelope("interpreter.run_code", {
      language: "python",
      code: "print('hello world')",
      timeout_seconds: 30
    });
    const result = await executeInterpreterJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("interpreter.run_code");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.exit_code).toBe(0);
    expect(typeof out.stdout).toBe("string");
    expect(typeof out.stderr).toBe("string");
    expect(typeof out.execution_time_ms).toBe("number");
  });

  it("produces a completed JobResult for interpreter.run_code (javascript)", async () => {
    const envelope = makeEnvelope("interpreter.run_code", {
      language: "javascript",
      code: "console.log('hello')",
      timeout_seconds: 60
    });
    const result = await executeInterpreterJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.exit_code).toBe(0);
  });

  it("produces a completed JobResult for interpreter.run_code (shell)", async () => {
    const envelope = makeEnvelope("interpreter.run_code", {
      language: "shell",
      code: "echo hello",
      timeout_seconds: 30
    });
    const result = await executeInterpreterJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.exit_code).toBe(0);
  });

  it("produces a completed JobResult for interpreter.status (no filter)", async () => {
    const envelope = makeEnvelope("interpreter.status", {});
    const result = await executeInterpreterJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("interpreter.status");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.active_sessions)).toBe(true);
  });

  it("produces a completed JobResult for interpreter.status (with session_id)", async () => {
    const sessionId = adapter.addRunningSession("Background automation");
    const envelope = makeEnvelope("interpreter.status", { session_id: sessionId });
    const result = await executeInterpreterJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const sessions = out.active_sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.session_id).toBe(sessionId);
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("device.snapshot", {});
    const result = await executeInterpreterJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("device.snapshot");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps InterpreterWorkerError from adapter correctly", async () => {
    const faultyAdapter = new MockInterpreterAdapter();
    faultyAdapter.status = async () => {
      throw new InterpreterWorkerError("SESSION_NOT_FOUND", "Session not found.", false);
    };

    const envelope = makeEnvelope("interpreter.status", { session_id: "missing-id" });
    const result = await executeInterpreterJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("SESSION_NOT_FOUND");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps generic Error from adapter into INTERNAL_ERROR", async () => {
    const faultyAdapter = new MockInterpreterAdapter();
    (faultyAdapter as unknown as { runTask: unknown }).runTask = async () => {
      throw new Error("Unexpected subprocess failure");
    };

    const envelope = makeEnvelope("interpreter.run_task", {
      task: "Do something",
      auto_approve: false
    });
    const result = await executeInterpreterJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toBe("Unexpected subprocess failure");
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("interpreter.status", {});
    const result = await executeInterpreterJob(envelope, adapter, {
      workerId: "my-interpreter-worker"
    });

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("my-interpreter-worker");
  });

  it("includes metrics with started_at and finished_at", async () => {
    const envelope = makeEnvelope("interpreter.run_code", {
      language: "python",
      code: "pass",
      timeout_seconds: 10
    });
    const result = await executeInterpreterJob(envelope, adapter);

    expect(result.metrics?.started_at).toBeTruthy();
    expect(result.metrics?.finished_at).toBeTruthy();
    expect(result.metrics?.attempt).toBe(1);
  });
});

// ── createInterpreterWorker ───────────────────────────────────────────────────

describe("createInterpreterWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId", () => {
    const worker = createInterpreterWorker({ adapter: createMockInterpreterAdapter() });
    expect(worker.workerId).toBe("interpreter-worker");
  });

  it("uses the provided workerId", () => {
    const worker = createInterpreterWorker({
      adapter: createMockInterpreterAdapter(),
      workerId: "custom-interpreter-worker"
    });
    expect(worker.workerId).toBe("custom-interpreter-worker");
  });

  it("executes a run_task job via the worker facade", async () => {
    const worker = createInterpreterWorker({ adapter: createMockInterpreterAdapter() });
    const envelope = makeEnvelope("interpreter.run_task", {
      task: "Calculate pi to 100 decimal places",
      auto_approve: true
    });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("interpreter-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.session_id).toBe("string");
    expect(Array.isArray(out.steps)).toBe(true);
  });

  it("executes a run_code job via the worker facade", async () => {
    const worker = createInterpreterWorker({ adapter: createMockInterpreterAdapter() });
    const envelope = makeEnvelope("interpreter.run_code", {
      language: "python",
      code: "x = 1 + 1\nprint(x)",
      timeout_seconds: 30
    });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.exit_code).toBe(0);
  });

  it("executes a status job via the worker facade", async () => {
    const worker = createInterpreterWorker({ adapter: createMockInterpreterAdapter() });
    const envelope = makeEnvelope("interpreter.status", {});
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.active_sessions)).toBe(true);
  });
});

// ── InterpreterWorkerError ────────────────────────────────────────────────────

describe("InterpreterWorkerError", () => {
  it("has the correct name and code", () => {
    const err = new InterpreterWorkerError("TEST_CODE", "Test message", false);
    expect(err.name).toBe("InterpreterWorkerError");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("Test message");
    expect(err.retryable).toBe(false);
  });

  it("defaults retryable to false", () => {
    const err = new InterpreterWorkerError("CODE", "msg");
    expect(err.retryable).toBe(false);
  });

  it("can be marked as retryable", () => {
    const err = new InterpreterWorkerError("CODE", "msg", true);
    expect(err.retryable).toBe(true);
  });

  it("can carry details", () => {
    const details = { foo: "bar", count: 42 };
    const err = new InterpreterWorkerError("CODE", "msg", false, details);
    expect(err.details).toEqual(details);
  });

  it("is an instance of Error", () => {
    const err = new InterpreterWorkerError("CODE", "msg");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof InterpreterWorkerError).toBe(true);
  });
});

// ── contracts.ts constants ────────────────────────────────────────────────────

describe("contracts constants", () => {
  it("INTERPRETER_TOOL_NAMES contains the 3 expected tools", async () => {
    const { INTERPRETER_TOOL_NAMES } = await import("@jarvis/shared");
    expect(INTERPRETER_TOOL_NAMES).toHaveLength(3);
    expect(INTERPRETER_TOOL_NAMES).toContain("interpreter_run_task");
    expect(INTERPRETER_TOOL_NAMES).toContain("interpreter_run_code");
    expect(INTERPRETER_TOOL_NAMES).toContain("interpreter_status");
  });

  it("INTERPRETER_COMMAND_NAMES contains the 2 expected commands", async () => {
    const { INTERPRETER_COMMAND_NAMES } = await import("@jarvis/shared");
    expect(INTERPRETER_COMMAND_NAMES).toHaveLength(2);
    expect(INTERPRETER_COMMAND_NAMES).toContain("/interpret");
    expect(INTERPRETER_COMMAND_NAMES).toContain("/run-code");
  });

  it("JOB_TYPE_NAMES includes all 3 interpreter types", async () => {
    const { JOB_TYPE_NAMES } = await import("@jarvis/shared");
    expect(JOB_TYPE_NAMES).toContain("interpreter.run_task");
    expect(JOB_TYPE_NAMES).toContain("interpreter.run_code");
    expect(JOB_TYPE_NAMES).toContain("interpreter.status");
  });

  it("JOB_TIMEOUT_SECONDS has correct timeouts for interpreter types", async () => {
    const { JOB_TIMEOUT_SECONDS } = await import("@jarvis/shared");
    expect(JOB_TIMEOUT_SECONDS["interpreter.run_task"]).toBe(900);
    expect(JOB_TIMEOUT_SECONDS["interpreter.run_code"]).toBe(300);
    expect(JOB_TIMEOUT_SECONDS["interpreter.status"]).toBe(30);
  });

  it("JOB_APPROVAL_REQUIREMENT has correct requirements for interpreter types", async () => {
    const { JOB_APPROVAL_REQUIREMENT } = await import("@jarvis/shared");
    expect(JOB_APPROVAL_REQUIREMENT["interpreter.run_task"]).toBe("required");
    expect(JOB_APPROVAL_REQUIREMENT["interpreter.run_code"]).toBe("required");
    expect(JOB_APPROVAL_REQUIREMENT["interpreter.status"]).toBe("not_required");
  });
});
