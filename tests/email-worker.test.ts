import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  JOB_APPROVAL_REQUIREMENT,
  resetJarvisState
} from "@jarvis/shared";
import {
  MockEmailAdapter,
  createMockEmailAdapter,
  createEmailWorker,
  executeEmailJob,
  isEmailJobType,
  EMAIL_JOB_TYPES,
  EMAIL_WORKER_ID,
  EmailWorkerError
} from "@jarvis/email-worker";
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
    timeout_seconds: 60,
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

// ── EMAIL_JOB_TYPES ───────────────────────────────────────────────────────────

describe("EMAIL_JOB_TYPES", () => {
  it("contains all 6 email job types", () => {
    expect(EMAIL_JOB_TYPES).toHaveLength(6);
    expect(EMAIL_JOB_TYPES).toContain("email.search");
    expect(EMAIL_JOB_TYPES).toContain("email.read");
    expect(EMAIL_JOB_TYPES).toContain("email.draft");
    expect(EMAIL_JOB_TYPES).toContain("email.send");
    expect(EMAIL_JOB_TYPES).toContain("email.label");
    expect(EMAIL_JOB_TYPES).toContain("email.list_threads");
  });
});

// ── isEmailJobType ────────────────────────────────────────────────────────────

describe("isEmailJobType", () => {
  it("returns true for all known email job types", () => {
    for (const type of EMAIL_JOB_TYPES) {
      expect(isEmailJobType(type)).toBe(true);
    }
  });

  it("returns false for non-email job types", () => {
    expect(isEmailJobType("system.monitor_cpu")).toBe(false);
    expect(isEmailJobType("agent.start")).toBe(false);
    expect(isEmailJobType("unknown.job")).toBe(false);
    expect(isEmailJobType("")).toBe(false);
  });
});

// ── JOB_APPROVAL_REQUIREMENT ──────────────────────────────────────────────────

describe("JOB_APPROVAL_REQUIREMENT for email", () => {
  it("email.send requires approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["email.send"]).toBe("required");
  });

  it("email.search does not require approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["email.search"]).toBe("not_required");
  });

  it("email.read does not require approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["email.read"]).toBe("not_required");
  });

  it("email.draft does not require approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["email.draft"]).toBe("not_required");
  });

  it("email.label is conditional", () => {
    expect(JOB_APPROVAL_REQUIREMENT["email.label"]).toBe("conditional");
  });

  it("email.list_threads does not require approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["email.list_threads"]).toBe("not_required");
  });
});

// ── MockEmailAdapter ──────────────────────────────────────────────────────────

describe("MockEmailAdapter", () => {
  let adapter: MockEmailAdapter;

  beforeEach(() => {
    adapter = new MockEmailAdapter();
  });

  describe("search", () => {
    it("returns all inbox messages when given a wildcard query", async () => {
      const result = await adapter.search({ query: "*" });
      expect(result.structured_output.messages.length).toBeGreaterThan(0);
      expect(result.structured_output.total_results).toBeGreaterThan(0);
    });

    it("filters by subject using subject: prefix", async () => {
      const result = await adapter.search({ query: "subject:RFQ" });
      expect(result.structured_output.messages.length).toBeGreaterThan(0);
      for (const msg of result.structured_output.messages) {
        expect(msg.subject.toLowerCase()).toContain("rfq");
      }
    });

    it("filters by from: prefix", async () => {
      const result = await adapter.search({ query: "from:automotech" });
      expect(result.structured_output.messages.length).toBeGreaterThan(0);
      for (const msg of result.structured_output.messages) {
        expect(msg.from.toLowerCase()).toContain("automotech");
      }
    });

    it("returns empty array when query matches nothing", async () => {
      const result = await adapter.search({ query: "subject:nonexistent-xyzzy-12345" });
      expect(result.structured_output.messages).toHaveLength(0);
      expect(result.structured_output.total_results).toBe(0);
    });

    it("respects max_results limit", async () => {
      const result = await adapter.search({ query: "*", max_results: 2 });
      expect(result.structured_output.messages.length).toBeLessThanOrEqual(2);
    });

    it("returns next_page_token when results are truncated", async () => {
      const result = await adapter.search({ query: "*", max_results: 1 });
      expect(result.structured_output.next_page_token).toBeDefined();
    });

    it("message objects have correct shape", async () => {
      const result = await adapter.search({ query: "*" });
      const msg = result.structured_output.messages[0]!;
      expect(msg).toMatchObject({
        message_id: expect.any(String),
        thread_id: expect.any(String),
        subject: expect.any(String),
        from: expect.any(String),
        to: expect.any(Array),
        date: expect.any(String),
        snippet: expect.any(String),
        has_attachments: expect.any(Boolean),
        labels: expect.any(Array)
      });
    });
  });

  describe("read", () => {
    it("returns full message details for a known ID", async () => {
      const result = await adapter.read({ message_id: "msg-002" });
      const out = result.structured_output;
      expect(out.message_id).toBe("msg-002");
      expect(out.subject).toContain("RFQ");
      expect(out.from).toBe("procurement@automotech.com");
      expect(out.body_text.length).toBeGreaterThan(0);
      expect(out.attachments.length).toBeGreaterThan(0);
      expect(out.labels).toContain("INBOX");
    });

    it("throws EMAIL_NOT_FOUND for unknown message ID", async () => {
      await expect(
        adapter.read({ message_id: "nonexistent-msg-9999" })
      ).rejects.toThrow(EmailWorkerError);

      try {
        await adapter.read({ message_id: "nonexistent-msg-9999" });
      } catch (err) {
        expect(err instanceof EmailWorkerError).toBe(true);
        expect((err as EmailWorkerError).code).toBe("EMAIL_NOT_FOUND");
      }
    });

    it("attachments have correct shape", async () => {
      const result = await adapter.read({ message_id: "msg-002" });
      const att = result.structured_output.attachments[0]!;
      expect(att).toMatchObject({
        filename: expect.any(String),
        content_type: expect.any(String),
        size_bytes: expect.any(Number)
      });
    });

    it("returns body text for message with no attachments", async () => {
      const result = await adapter.read({ message_id: "msg-001" });
      expect(result.structured_output.body_text.length).toBeGreaterThan(0);
      expect(result.structured_output.attachments).toHaveLength(0);
    });
  });

  describe("draft", () => {
    it("creates a draft and returns draft_id and message_id", async () => {
      const result = await adapter.draft({
        to: ["prospect@client.com"],
        subject: "AUTOSAR migration proposal",
        body: "Dear Team, please find our proposal attached."
      });
      const out = result.structured_output;
      expect(out.draft_id).toBeDefined();
      expect(out.message_id).toBeDefined();
      expect(out.created_at).toBe(MOCK_NOW);
    });

    it("increments getDraftCount after creation", async () => {
      expect(adapter.getDraftCount()).toBe(0);
      await adapter.draft({ to: ["a@b.com"], subject: "Test", body: "Body" });
      expect(adapter.getDraftCount()).toBe(1);
      await adapter.draft({ to: ["c@d.com"], subject: "Test 2", body: "Body 2" });
      expect(adapter.getDraftCount()).toBe(2);
    });

    it("sets thread_id when reply_to_message_id is provided", async () => {
      const result = await adapter.draft({
        to: ["hans.mueller@tier1-supplier.de"],
        subject: "Re: AUTOSAR migration scope",
        body: "Thank you for your inquiry.",
        reply_to_message_id: "msg-001"
      });
      expect(result.structured_output.thread_id).toBe("thread-001");
    });

    it("does not set thread_id for new thread", async () => {
      const result = await adapter.draft({
        to: ["new@client.com"],
        subject: "New outreach",
        body: "Hello!"
      });
      expect(result.structured_output.thread_id).toBeUndefined();
    });
  });

  describe("send", () => {
    it("sends a draft by draft_id and removes it from drafts", async () => {
      const draftResult = await adapter.draft({
        to: ["procurement@automotech.com"],
        subject: "ISO 26262 proposal",
        body: "Please find attached."
      });
      const draftId = draftResult.structured_output.draft_id;

      expect(adapter.getDraftCount()).toBe(1);

      const sendResult = await adapter.send({ draft_id: draftId });
      expect(sendResult.structured_output.message_id).toBeDefined();
      expect(sendResult.structured_output.thread_id).toBeDefined();
      expect(sendResult.structured_output.sent_at).toBe(MOCK_NOW);

      expect(adapter.getDraftCount()).toBe(0);
    });

    it("increments getSentCount after send", async () => {
      expect(adapter.getSentCount()).toBe(0);

      const draftResult = await adapter.draft({
        to: ["a@b.com"], subject: "S1", body: "B1"
      });
      await adapter.send({ draft_id: draftResult.structured_output.draft_id });
      expect(adapter.getSentCount()).toBe(1);
    });

    it("sends inline (without draft_id) using to/subject/body", async () => {
      const result = await adapter.send({
        to: ["ceo@prospect.com"],
        subject: "Introduction",
        body: "We offer functional safety consulting."
      });
      expect(result.structured_output.message_id).toBeDefined();
      expect(result.structured_output.sent_at).toBe(MOCK_NOW);
      expect(adapter.getSentCount()).toBe(1);
    });

    it("throws DRAFT_NOT_FOUND when draft_id does not exist", async () => {
      await expect(
        adapter.send({ draft_id: "draft-9999" })
      ).rejects.toThrow(EmailWorkerError);

      try {
        await adapter.send({ draft_id: "draft-9999" });
      } catch (err) {
        expect((err as EmailWorkerError).code).toBe("DRAFT_NOT_FOUND");
      }
    });
  });

  describe("label", () => {
    it("adds labels to a message", async () => {
      const result = await adapter.label({
        message_id: "msg-002",
        action: "add",
        labels: ["RFQ_PENDING", "PRIORITY"]
      });
      expect(result.structured_output.action).toBe("add");
      expect(result.structured_output.labels_applied).toContain("RFQ_PENDING");
      expect(result.structured_output.labels_applied).toContain("PRIORITY");
      expect(result.structured_output.labels_removed).toHaveLength(0);
    });

    it("removes labels from a message", async () => {
      // First add
      await adapter.label({
        message_id: "msg-002",
        action: "add",
        labels: ["TEST_LABEL"]
      });

      // Then remove
      const result = await adapter.label({
        message_id: "msg-002",
        action: "remove",
        labels: ["TEST_LABEL"]
      });
      expect(result.structured_output.action).toBe("remove");
      expect(result.structured_output.labels_removed).toContain("TEST_LABEL");
      expect(result.structured_output.labels_applied).toHaveLength(0);
    });

    it("getLabels reflects applied labels", async () => {
      await adapter.label({
        message_id: "msg-001",
        action: "add",
        labels: ["AUTOSAR_PROJECT"]
      });
      const labels = adapter.getLabels("msg-001");
      expect(labels).toContain("AUTOSAR_PROJECT");
    });

    it("getLabels reflects removed labels", async () => {
      const labelsBefore = adapter.getLabels("msg-001");
      expect(labelsBefore).toContain("INBOX");

      await adapter.label({
        message_id: "msg-001",
        action: "remove",
        labels: ["UNREAD"]
      });
      const labelsAfter = adapter.getLabels("msg-001");
      expect(labelsAfter).not.toContain("UNREAD");
    });

    it("throws EMAIL_NOT_FOUND for unknown message", async () => {
      await expect(
        adapter.label({ message_id: "nonexistent-msg", action: "add", labels: ["TEST"] })
      ).rejects.toThrow(EmailWorkerError);
    });
  });

  describe("listThreads", () => {
    it("returns all threads when no query is provided", async () => {
      const result = await adapter.listThreads({});
      expect(result.structured_output.threads.length).toBeGreaterThan(0);
      expect(result.structured_output.total_results).toBeGreaterThan(0);
    });

    it("groups messages by thread_id correctly", async () => {
      const result = await adapter.listThreads({});
      const thread001 = result.structured_output.threads.find(
        (t) => t.thread_id === "thread-001"
      );
      expect(thread001).toBeDefined();
      // thread-001 has 2 messages (msg-001 and msg-004)
      expect(thread001!.message_count).toBe(2);
    });

    it("filters threads by query", async () => {
      const result = await adapter.listThreads({ query: "AUTOSAR" });
      expect(result.structured_output.threads.length).toBeGreaterThan(0);
      for (const thread of result.structured_output.threads) {
        expect(thread.subject.toLowerCase()).toContain("autosar");
      }
    });

    it("returns empty when no threads match query", async () => {
      const result = await adapter.listThreads({ query: "nonexistent-xyzzy-99999" });
      expect(result.structured_output.threads).toHaveLength(0);
      expect(result.structured_output.total_results).toBe(0);
    });

    it("thread objects have correct shape", async () => {
      const result = await adapter.listThreads({});
      const thread = result.structured_output.threads[0]!;
      expect(thread).toMatchObject({
        thread_id: expect.any(String),
        subject: expect.any(String),
        snippet: expect.any(String),
        message_count: expect.any(Number),
        last_message_date: expect.any(String),
        participants: expect.any(Array)
      });
      expect(thread.participants.length).toBeGreaterThan(0);
    });

    it("respects max_results", async () => {
      const result = await adapter.listThreads({ max_results: 2 });
      expect(result.structured_output.threads.length).toBeLessThanOrEqual(2);
    });
  });
});

// ── executeEmailJob ───────────────────────────────────────────────────────────

describe("executeEmailJob", () => {
  let adapter: MockEmailAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockEmailAdapter();
  });

  it("worker ID defaults to email-worker", () => {
    expect(EMAIL_WORKER_ID).toBe("email-worker");
  });

  it("produces a completed result for email.search", async () => {
    const envelope = makeEnvelope("email.search", {
      query: "subject:AUTOSAR",
      max_results: 10
    });
    const result = await executeEmailJob(envelope, adapter);

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_id).toBe(envelope.job_id);
    expect(result.job_type).toBe("email.search");
    expect(result.status).toBe("completed");
    expect(result.attempt).toBe(1);
    expect(result.metrics?.worker_id).toBe("email-worker");
    expect(result.metrics?.started_at).toBeTruthy();
    expect(result.metrics?.finished_at).toBeTruthy();
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.messages)).toBe(true);
    expect(typeof out.total_results).toBe("number");
  });

  it("produces a completed result for email.read", async () => {
    const envelope = makeEnvelope("email.read", { message_id: "msg-001" });
    const result = await executeEmailJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("email.read");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.message_id).toBe("msg-001");
    expect(typeof out.body_text).toBe("string");
    expect(Array.isArray(out.attachments)).toBe(true);
  });

  it("returns failed for email.read with unknown message ID", async () => {
    const envelope = makeEnvelope("email.read", { message_id: "msg-nonexistent" });
    const result = await executeEmailJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("EMAIL_NOT_FOUND");
    expect(result.error?.retryable).toBe(false);
  });

  it("produces a completed result for email.draft", async () => {
    const envelope = makeEnvelope("email.draft", {
      to: ["client@automotech.com"],
      subject: "Safety analysis kickoff",
      body: "Dear team, following up on the ISO 26262 engagement."
    });
    const result = await executeEmailJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("email.draft");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.draft_id).toBe("string");
    expect(typeof out.message_id).toBe("string");
  });

  it("produces a completed result for email.send using draft_id", async () => {
    const draftEnvelope = makeEnvelope("email.draft", {
      to: ["cfo@prospect.eu"],
      subject: "Engagement proposal",
      body: "Please review our attached proposal."
    });
    const draftResult = await executeEmailJob(draftEnvelope, adapter);
    const draftId = (draftResult.structured_output as Record<string, unknown>).draft_id as string;

    const sendEnvelope = makeEnvelope("email.send", { draft_id: draftId }, {
      approval_state: "approved"
    });
    const sendResult = await executeEmailJob(sendEnvelope, adapter);

    expect(sendResult.status).toBe("completed");
    expect(sendResult.job_type).toBe("email.send");
    const out = sendResult.structured_output as Record<string, unknown>;
    expect(typeof out.message_id).toBe("string");
    expect(typeof out.sent_at).toBe("string");
  });

  it("produces a completed result for email.label", async () => {
    const envelope = makeEnvelope("email.label", {
      message_id: "msg-002",
      action: "add",
      labels: ["RFQ_PIPELINE"]
    });
    const result = await executeEmailJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("email.label");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.action).toBe("add");
    expect(Array.isArray(out.labels_applied)).toBe(true);
  });

  it("produces a completed result for email.list_threads", async () => {
    const envelope = makeEnvelope("email.list_threads", {
      query: "AUTOSAR"
    });
    const result = await executeEmailJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("email.list_threads");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.threads)).toBe(true);
    expect(typeof out.total_results).toBe("number");
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("system.monitor_cpu", {});
    const result = await executeEmailJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("system.monitor_cpu");
    expect(result.error?.retryable).toBe(false);
  });

  it("metrics include worker_id", async () => {
    const envelope = makeEnvelope("email.search", { query: "*" });
    const result = await executeEmailJob(envelope, adapter, {
      workerId: "custom-email-worker"
    });
    expect(result.metrics?.worker_id).toBe("custom-email-worker");
  });

  it("propagates error code from EmailWorkerError", async () => {
    const faultyAdapter = new MockEmailAdapter();
    faultyAdapter.read = async (_input) => {
      throw new EmailWorkerError("QUOTA_EXCEEDED", "API quota exceeded.", true);
    };

    const envelope = makeEnvelope("email.read", { message_id: "msg-001" });
    const result = await executeEmailJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("QUOTA_EXCEEDED");
    expect(result.error?.retryable).toBe(true);
    expect(result.error?.message).toContain("quota");
  });

  it("wraps generic Error as INTERNAL_ERROR", async () => {
    const faultyAdapter = new MockEmailAdapter();
    faultyAdapter.search = async (_input) => {
      throw new Error("Unexpected internal failure");
    };

    const envelope = makeEnvelope("email.search", { query: "test" });
    const result = await executeEmailJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toContain("Unexpected internal failure");
  });
});

// ── createEmailWorker ─────────────────────────────────────────────────────────

describe("createEmailWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes default workerId of email-worker", () => {
    const worker = createEmailWorker({ adapter: createMockEmailAdapter() });
    expect(worker.workerId).toBe("email-worker");
  });

  it("uses provided workerId", () => {
    const worker = createEmailWorker({
      adapter: createMockEmailAdapter(),
      workerId: "my-email-worker"
    });
    expect(worker.workerId).toBe("my-email-worker");
  });

  it("executes a search job via the worker facade", async () => {
    const worker = createEmailWorker({ adapter: createMockEmailAdapter() });
    const envelope = makeEnvelope("email.search", { query: "subject:RFQ" });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("email-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.messages)).toBe(true);
  });

  it("executes a draft then send workflow", async () => {
    const worker = createEmailWorker({ adapter: createMockEmailAdapter() });

    const draftEnvelope = makeEnvelope("email.draft", {
      to: ["partner@tier1.de"],
      subject: "SOTIF workshop follow-up",
      body: "Following up on our SOTIF discussion."
    });
    const draftResult = await worker.execute(draftEnvelope);
    expect(draftResult.status).toBe("completed");

    const draftId = (draftResult.structured_output as Record<string, unknown>).draft_id as string;
    const sendEnvelope = makeEnvelope("email.send", { draft_id: draftId }, {
      approval_state: "approved"
    });
    const sendResult = await worker.execute(sendEnvelope);
    expect(sendResult.status).toBe("completed");
  });
});
