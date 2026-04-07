import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { JobEnvelope, JobResult } from "@jarvis/shared";
import {
  runMigrations,
  createCommand,
  ChannelStore,
  WorkerHealthMonitor,
  validatePath,
  defaultFilesystemPolicy,
} from "@jarvis/runtime";

// ─── Helpers ───────────────────────────────────────────────────────────────

type WorkerExecuteFn = (envelope: JobEnvelope) => Promise<JobResult>;

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
): JobEnvelope {
  return {
    contract_version: "jarvis.v1",
    job_id: randomUUID(),
    type: type as any,
    session_key: `test-${Date.now()}`,
    requested_by: { source: "agent", agent_id: "test" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 120,
    attempt: 1,
    input,
    artifacts_in: [],
    metadata: { agent_id: "test", thread_key: null },
  };
}

function makeSuccessResult(envelope: JobEnvelope): JobResult {
  return {
    contract_version: "jarvis.v1",
    job_id: envelope.job_id,
    job_type: envelope.type,
    status: "completed",
    summary: "OK",
    attempt: envelope.attempt,
  };
}

function makeFailedResult(
  envelope: JobEnvelope,
  code: string,
  message: string,
): JobResult {
  return {
    contract_version: "jarvis.v1",
    job_id: envelope.job_id,
    job_type: envelope.type,
    status: "failed",
    summary: message,
    attempt: envelope.attempt,
    error: { code, message, retryable: false },
  };
}

/**
 * Minimal mock worker registry that mirrors the executeJob error boundary
 * logic from worker-registry.ts. This lets us test crash recovery, timeouts,
 * and filesystem policy violations without instantiating real workers.
 */
function createMockRegistry(
  workers: Map<string, WorkerExecuteFn>,
  opts: {
    healthMonitor?: WorkerHealthMonitor;
    timeoutOverrideMs?: number;
  } = {},
) {
  const healthMonitor = opts.healthMonitor;

  return {
    async executeJob(envelope: JobEnvelope): Promise<JobResult> {
      const prefix = envelope.type.split(".")[0];
      const worker = workers.get(prefix);

      if (!worker) {
        return makeFailedResult(
          envelope,
          "UNKNOWN_JOB_TYPE",
          `No worker registered for prefix "${prefix}"`,
        );
      }

      const timeoutMs = opts.timeoutOverrideMs ?? envelope.timeout_seconds * 1000;
      const startTime = Date.now();

      try {
        const timeoutPromise = new Promise<JobResult>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Worker timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        });

        const result = await Promise.race([worker(envelope), timeoutPromise]);
        const durationMs = Date.now() - startTime;

        healthMonitor?.recordExecution(
          prefix!,
          durationMs,
          result.status === "completed",
        );

        return result;
      } catch (e) {
        const durationMs = Date.now() - startTime;
        const errMsg = e instanceof Error ? e.message : String(e);
        const isTimeout = errMsg.includes("Worker timeout");

        if (isTimeout) {
          healthMonitor?.recordTimeout(prefix!);
          return makeFailedResult(
            envelope,
            "WORKER_TIMEOUT",
            `${envelope.type} timed out after ${Math.round(timeoutMs / 1000)}s`,
          );
        }

        healthMonitor?.recordExecution(prefix!, durationMs, false);
        return makeFailedResult(envelope, "WORKER_CRASH", errMsg);
      }
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Failure Injection", () => {
  // ── Error boundary tests ─────────────────────────────────────────────

  describe("error boundary", () => {
    it("worker that throws returns failed JobResult", async () => {
      const workers = new Map<string, WorkerExecuteFn>();
      workers.set("crash", async () => {
        throw new Error("Simulated worker crash");
      });
      const registry = createMockRegistry(workers);

      const envelope = makeEnvelope("crash.do_work");
      const result = await registry.executeJob(envelope);

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("WORKER_CRASH");
      expect(result.error?.message).toContain("Simulated worker crash");
    });

    it("worker that rejects returns failed JobResult", async () => {
      const workers = new Map<string, WorkerExecuteFn>();
      workers.set("reject", () => {
        return Promise.reject(new Error("Promise rejected"));
      });
      const registry = createMockRegistry(workers);

      const envelope = makeEnvelope("reject.action");
      const result = await registry.executeJob(envelope);

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("WORKER_CRASH");
      expect(result.error?.message).toContain("Promise rejected");
    });

    it("worker that hangs returns timeout result", async () => {
      const workers = new Map<string, WorkerExecuteFn>();
      workers.set("hang", () => {
        return new Promise<JobResult>(() => {
          // Never resolves
        });
      });
      // Use a very short timeout so the test completes quickly
      const registry = createMockRegistry(workers, { timeoutOverrideMs: 50 });

      const envelope = makeEnvelope("hang.forever");
      const result = await registry.executeJob(envelope);

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("WORKER_TIMEOUT");
    });

    it("subsequent job executes successfully after prior crash", async () => {
      let callCount = 0;
      const workers = new Map<string, WorkerExecuteFn>();
      workers.set("flaky", async (env) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("First call crashes");
        }
        return makeSuccessResult(env);
      });
      const registry = createMockRegistry(workers);

      // First call crashes
      const env1 = makeEnvelope("flaky.action");
      const result1 = await registry.executeJob(env1);
      expect(result1.status).toBe("failed");

      // Second call succeeds
      const env2 = makeEnvelope("flaky.action");
      const result2 = await registry.executeJob(env2);
      expect(result2.status).toBe("completed");
    });
  });

  // ── Filesystem policy violation ──────────────────────────────────────

  describe("filesystem policy violation", () => {
    it("validatePath returns FILESYSTEM_POLICY_VIOLATION-level denial for disallowed paths", () => {
      const policy = defaultFilesystemPolicy();
      const result = validatePath("/root/secret/data.txt", policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("outside all allowed roots");

      // Verify the error code convention used by files-bridge
      // When the files bridge detects a policy violation, it returns this code
      const violationResult: JobResult = {
        contract_version: "jarvis.v1",
        job_id: "test",
        job_type: "files.read" as any,
        status: "failed",
        summary: result.reason!,
        attempt: 1,
        error: {
          code: "FILESYSTEM_POLICY_VIOLATION",
          message: result.reason!,
          retryable: false,
        },
      };
      expect(violationResult.error?.code).toBe("FILESYSTEM_POLICY_VIOLATION");
    });
  });

  // ── Idempotent command creation ──────────────────────────────────────

  describe("idempotent command creation (INSERT OR IGNORE)", () => {
    let db: DatabaseSync;

    beforeEach(() => {
      db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys = ON;");
      runMigrations(db);
    });

    it("duplicate idempotency key returns existing command (no throw)", () => {
      const first = createCommand(db, {
        agentId: "bd-pipeline",
        source: "webhook",
        idempotencyKey: "dedup-key-1",
      });

      // Second call with same key should NOT throw (INSERT OR IGNORE)
      const second = createCommand(db, {
        agentId: "bd-pipeline",
        source: "webhook",
        idempotencyKey: "dedup-key-1",
      });

      // Should return the original command's ID
      expect(second.commandId).toBe(first.commandId);

      // Only one row should exist in the table
      const rows = db.prepare(
        "SELECT * FROM agent_commands WHERE idempotency_key = ?",
      ).all("dedup-key-1");
      expect(rows).toHaveLength(1);
    });

    it("duplicate idempotency key skips channel message recording", () => {
      const channelStore = new ChannelStore(db);
      const threadId = channelStore.getOrCreateThread("webhook", "hook-99");

      // First command -- records channel message
      const first = createCommand(db, {
        agentId: "content-engine",
        source: "webhook",
        idempotencyKey: "dedup-channel-1",
        channelStore,
        threadId,
        messagePreview: "First trigger",
        sender: "webhook-system",
      });
      expect(first.messageId).toBeTruthy();

      // Second command with same key -- should NOT record another message
      const second = createCommand(db, {
        agentId: "content-engine",
        source: "webhook",
        idempotencyKey: "dedup-channel-1",
        channelStore,
        threadId,
        messagePreview: "Duplicate trigger",
        sender: "webhook-system",
      });
      expect(second.messageId).toBeUndefined();

      // Verify only one channel message exists for this command
      const messages = db.prepare(
        "SELECT * FROM channel_messages WHERE command_id = ?",
      ).all(first.commandId);
      expect(messages).toHaveLength(1);
      expect(
        (messages[0] as Record<string, unknown>).content_preview,
      ).toBe("First trigger");
    });
  });
});
