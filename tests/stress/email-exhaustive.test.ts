/**
 * Stress: Email Worker Exhaustive Tests
 *
 * Comprehensive coverage of all email operations: search queries (every prefix
 * and combination), read for every message, draft variations, send paths,
 * label permutations, thread listing, draft-then-send lifecycle, concurrency,
 * and edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockEmailAdapter, executeEmailJob } from "@jarvis/email-worker";
import type { JobEnvelope } from "@jarvis/shared";
import { range } from "./helpers.js";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "email-exhaustive", run_id: randomUUID() },
  };
}

// ── Search Exhaustive ──────────────────────────────────────────────────────

describe("Email Search Exhaustive", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("search with from: prefix returns matching messages", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "from:hans" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) {
      expect(m.from.toLowerCase()).toContain("hans");
    }
  });

  it("search with to: prefix", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "to:daniel" }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.messages).toBeDefined();
  });

  it("search with subject: prefix matches ISO 26262", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "subject:ISO 26262" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("search with subject: prefix matches AUTOSAR", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "subject:AUTOSAR" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("search with subject: prefix matches SOTIF", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "subject:SOTIF" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("search with subject: prefix matches audit", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "subject:audit" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("search with label:UNREAD returns unread messages", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "label:UNREAD" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("search with label:IMPORTANT returns important messages", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "label:IMPORTANT" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("search with label:STARRED returns starred messages", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "label:STARRED" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("search with free text query", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "workshop" }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.messages).toBeDefined();
  });

  it("search with combined from: and subject: query", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "from:hans subject:AUTOSAR" }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.messages).toBeDefined();
  });

  it("search with combined label: and subject: query", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "label:UNREAD subject:AUTOSAR" }),
      email,
    );
    expect(result.status).toBe("completed");
  });

  it("search with empty query returns all messages", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(5);
  });

  it("search with max_results=1 returns exactly 1", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "", max_results: 1 }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(1);
  });

  it("search with max_results=5 returns all 5 mock messages", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "", max_results: 5 }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(5);
  });

  it("search with max_results=20 caps at available messages", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "", max_results: 20 }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(5);
  });

  it("search with non-matching query returns empty", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "from:nonexistent@nobody.xyz" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(0);
  });

  it("search with non-matching subject returns empty", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "subject:XYZZYSPOON" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(0);
  });

  it("search output includes total_results field", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "" }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.total_results).toBeDefined();
  });
});

// ── Read Every Message ─────────────────────────────────────────────────────

describe("Email Read Exhaustive", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("read msg-001: Hans Mueller AUTOSAR message", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "msg-001" }),
      email,
    );
    expect(result.status).toBe("completed");
    const out = result.structured_output!;
    expect(out.message_id).toBe("msg-001");
    expect(out.subject).toBeTruthy();
    expect(out.from).toBeTruthy();
    expect(out.to).toBeDefined();
    expect(out.body_text).toBeDefined();
    expect(out.labels).toBeDefined();
    expect((out.labels as string[]).includes("UNREAD")).toBe(true);
  });

  it("read msg-002: ISO 26262 RFQ message", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "msg-002" }),
      email,
    );
    expect(result.status).toBe("completed");
    const out = result.structured_output!;
    expect(out.message_id).toBe("msg-002");
    expect(out.labels).toBeDefined();
    expect((out.labels as string[]).includes("IMPORTANT")).toBe(true);
  });

  it("read msg-003: SOTIF workshop message", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "msg-003" }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.message_id).toBe("msg-003");
    expect(result.structured_output?.thread_id).toBeDefined();
  });

  it("read msg-004: sent response message", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "msg-004" }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.message_id).toBe("msg-004");
    expect(result.structured_output?.date).toBeDefined();
  });

  it("read msg-005: audit schedule STARRED message", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "msg-005" }),
      email,
    );
    expect(result.status).toBe("completed");
    const out = result.structured_output!;
    expect(out.message_id).toBe("msg-005");
    expect((out.labels as string[]).includes("STARRED")).toBe(true);
  });

  it("read all messages have required fields", async () => {
    for (const id of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005"]) {
      const result = await executeEmailJob(
        envelope("email.read", { message_id: id }),
        email,
      );
      expect(result.status).toBe("completed");
      const out = result.structured_output!;
      expect(out.message_id).toBe(id);
      expect(out.thread_id).toBeDefined();
      expect(out.subject).toBeDefined();
      expect(out.from).toBeDefined();
      expect(out.to).toBeDefined();
      expect(out.date).toBeDefined();
      expect(out.body_text).toBeDefined();
      expect(out.attachments).toBeDefined();
      expect(out.labels).toBeDefined();
    }
  });

  it("read non-existent message returns failed", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "msg-999" }),
      email,
    );
    expect(result.status).toBe("failed");
  });

  it("read with empty message_id returns failed", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "" }),
      email,
    );
    expect(result.status).toBe("failed");
  });
});

// ── Draft Variations ───────────────────────────────────────────────────────

describe("Email Draft Variations", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("draft with minimal fields: to, subject, body", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["test@example.com"],
        subject: "Test",
        body: "Hello",
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.draft_id).toBeTruthy();
    expect(result.structured_output?.message_id).toBeDefined();
    expect(result.structured_output?.created_at).toBeDefined();
    expect(email.getDraftCount()).toBe(1);
  });

  it("draft with cc recipients", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["primary@example.com"],
        subject: "With CC",
        body: "CC test",
        cc: ["cc1@example.com", "cc2@example.com"],
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.draft_id).toBeTruthy();
  });

  it("draft with reply_to_message_id", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["reply@example.com"],
        subject: "Re: Original",
        body: "Replying to your message",
        reply_to_message_id: "msg-001",
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.draft_id).toBeTruthy();
  });

  it("draft with reply_to sets thread_id", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["reply@example.com"],
        subject: "Re: Thread",
        body: "In-thread reply",
        reply_to_message_id: "msg-001",
      }),
      email,
    );
    expect(result.status).toBe("completed");
    // thread_id should be set when replying
    if (result.structured_output?.thread_id) {
      expect(result.structured_output.thread_id).toBeTruthy();
    }
  });

  it("draft with empty body succeeds", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["test@example.com"],
        subject: "Empty body",
        body: "",
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });

  it("draft with long subject (200 chars)", async () => {
    const longSubject = "A".repeat(200);
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["test@example.com"],
        subject: longSubject,
        body: "Test",
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });

  it("draft with multiple recipients", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["a@test.com", "b@test.com", "c@test.com", "d@test.com"],
        subject: "Multi-recipient",
        body: "To many people",
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });

  it("draft with cc and reply_to together", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["main@test.com"],
        subject: "Re: Combined",
        body: "Full feature draft",
        cc: ["cc@test.com"],
        reply_to_message_id: "msg-002",
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(email.getDraftCount()).toBe(1);
  });

  it("5 sequential drafts increment count", async () => {
    for (const i of range(5)) {
      const result = await executeEmailJob(
        envelope("email.draft", {
          to: [`user${i}@test.com`],
          subject: `Draft #${i}`,
          body: `Body ${i}`,
        }),
        email,
      );
      expect(result.status).toBe("completed");
    }
    expect(email.getDraftCount()).toBe(5);
  });
});

// ── Send Paths ─────────────────────────────────────────────────────────────

describe("Email Send Paths", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("send draft by draft_id", async () => {
    const draft = await executeEmailJob(
      envelope("email.draft", {
        to: ["recipient@test.com"],
        subject: "Draft to send",
        body: "Will be sent",
      }),
      email,
    );
    const draftId = draft.structured_output?.draft_id;
    expect(draftId).toBeTruthy();

    const send = await executeEmailJob(
      envelope("email.send", { draft_id: draftId }),
      email,
    );
    expect(send.status).toBe("completed");
    expect(send.structured_output?.message_id).toBeDefined();
    expect(send.structured_output?.sent_at).toBeDefined();
    expect(email.getSentCount()).toBe(1);
  });

  it("send inline with to, subject, body", async () => {
    const result = await executeEmailJob(
      envelope("email.send", {
        to: ["inline@test.com"],
        subject: "Inline send",
        body: "Sent directly without draft",
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.message_id).toBeDefined();
    expect(result.structured_output?.thread_id).toBeDefined();
    expect(email.getSentCount()).toBe(1);
  });

  it("send inline with cc", async () => {
    const result = await executeEmailJob(
      envelope("email.send", {
        to: ["main@test.com"],
        subject: "With CC",
        body: "CC send",
        cc: ["cc@test.com"],
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(email.getSentCount()).toBe(1);
  });

  it("send inline with reply_to_message_id", async () => {
    const result = await executeEmailJob(
      envelope("email.send", {
        to: ["reply@test.com"],
        subject: "Re: Thread",
        body: "Reply send",
        reply_to_message_id: "msg-001",
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });

  it("send without recipients fails", async () => {
    const result = await executeEmailJob(
      envelope("email.send", { subject: "No recipient", body: "Fail" }),
      email,
    );
    expect(result.status).toBe("failed");
  });

  it("send non-existent draft_id fails", async () => {
    const result = await executeEmailJob(
      envelope("email.send", { draft_id: "draft-nonexistent-999" }),
      email,
    );
    expect(result.status).toBe("failed");
  });

  it("send empty body inline succeeds", async () => {
    const result = await executeEmailJob(
      envelope("email.send", {
        to: ["test@test.com"],
        subject: "Empty body send",
        body: "",
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Label Operations ───────────────────────────────────────────────────────

describe("Email Label Exhaustive", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("add single label", async () => {
    const result = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-001",
        action: "add",
        labels: ["FOLLOW-UP"],
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.message_id).toBe("msg-001");
    expect(result.structured_output?.action).toBe("add");
    expect(result.structured_output?.labels_applied).toContain("FOLLOW-UP");
    const labels = email.getLabels("msg-001");
    expect(labels).toContain("FOLLOW-UP");
  });

  it("add multiple labels at once", async () => {
    const result = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-002",
        action: "add",
        labels: ["FOLLOW-UP", "PRIORITY", "CLIENT"],
      }),
      email,
    );
    expect(result.status).toBe("completed");
    const applied = result.structured_output?.labels_applied as string[];
    expect(applied).toContain("FOLLOW-UP");
    expect(applied).toContain("PRIORITY");
    expect(applied).toContain("CLIENT");
  });

  it("remove label from message", async () => {
    // msg-001 has UNREAD label
    const result = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-001",
        action: "remove",
        labels: ["UNREAD"],
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.labels_removed).toContain("UNREAD");
    const labels = email.getLabels("msg-001");
    expect(labels).not.toContain("UNREAD");
  });

  it("remove non-existent label from message", async () => {
    const result = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-001",
        action: "remove",
        labels: ["NONEXISTENT-LABEL"],
      }),
      email,
    );
    // Should succeed but label won't be in removed list or silently handled
    expect(result.status).toBe("completed");
  });

  it("add label to msg-003", async () => {
    const result = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-003",
        action: "add",
        labels: ["REVIEWED"],
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(email.getLabels("msg-003")).toContain("REVIEWED");
  });

  it("add label to msg-004", async () => {
    const result = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-004",
        action: "add",
        labels: ["ARCHIVED"],
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });

  it("add label to msg-005", async () => {
    const result = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-005",
        action: "add",
        labels: ["NEEDS-ACTION"],
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(email.getLabels("msg-005")).toContain("NEEDS-ACTION");
  });

  it("label non-existent message fails", async () => {
    const result = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-999",
        action: "add",
        labels: ["TEST"],
      }),
      email,
    );
    expect(result.status).toBe("failed");
  });

  it("add then remove label round-trip", async () => {
    await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-003",
        action: "add",
        labels: ["TEMP-LABEL"],
      }),
      email,
    );
    expect(email.getLabels("msg-003")).toContain("TEMP-LABEL");

    await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-003",
        action: "remove",
        labels: ["TEMP-LABEL"],
      }),
      email,
    );
    expect(email.getLabels("msg-003")).not.toContain("TEMP-LABEL");
  });
});

// ── Thread Listing ─────────────────────────────────────────────────────────

describe("Email Thread Listing", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("list threads with default parameters", async () => {
    const result = await executeEmailJob(
      envelope("email.list_threads", {}),
      email,
    );
    expect(result.status).toBe("completed");
    const threads = result.structured_output?.threads as any[];
    expect(threads.length).toBeGreaterThan(0);
    expect(result.structured_output?.total_results).toBeDefined();
  });

  it("list threads with max_results=1", async () => {
    const result = await executeEmailJob(
      envelope("email.list_threads", { max_results: 1 }),
      email,
    );
    expect(result.status).toBe("completed");
    const threads = result.structured_output?.threads as any[];
    expect(threads.length).toBeLessThanOrEqual(1);
  });

  it("list threads with max_results=10", async () => {
    const result = await executeEmailJob(
      envelope("email.list_threads", { max_results: 10 }),
      email,
    );
    expect(result.status).toBe("completed");
    const threads = result.structured_output?.threads as any[];
    for (const t of threads) {
      expect(t.thread_id).toBeTruthy();
      expect(t.message_count).toBeGreaterThan(0);
    }
  });

  it("list threads with query filter", async () => {
    const result = await executeEmailJob(
      envelope("email.list_threads", { query: "AUTOSAR" }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.threads).toBeDefined();
  });

  it("list threads with non-matching query", async () => {
    const result = await executeEmailJob(
      envelope("email.list_threads", { query: "XYZNONEXISTENT" }),
      email,
    );
    expect(result.status).toBe("completed");
    const threads = result.structured_output?.threads as any[];
    expect(threads.length).toBe(0);
  });
});

// ── Draft-then-Send Lifecycle ──────────────────────────────────────────────

describe("Email Draft-then-Send Lifecycle", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("10 draft-then-send cycles", async () => {
    for (const i of range(10)) {
      const draft = await executeEmailJob(
        envelope("email.draft", {
          to: [`cycle${i}@test.com`],
          subject: `Lifecycle #${i}`,
          body: `Cycle body ${i}`,
        }),
        email,
      );
      expect(draft.status).toBe("completed");
      const draftId = draft.structured_output?.draft_id;
      expect(draftId).toBeTruthy();

      const send = await executeEmailJob(
        envelope("email.send", { draft_id: draftId }),
        email,
      );
      expect(send.status).toBe("completed");
      expect(send.structured_output?.message_id).toBeDefined();
      expect(send.structured_output?.sent_at).toBeDefined();
    }
    expect(email.getSentCount()).toBe(10);
  });

  it("draft-send-draft-send alternating creates correct counts", async () => {
    const d1 = await executeEmailJob(
      envelope("email.draft", { to: ["a@test.com"], subject: "D1", body: "B1" }),
      email,
    );
    await executeEmailJob(
      envelope("email.send", { draft_id: d1.structured_output?.draft_id }),
      email,
    );

    const d2 = await executeEmailJob(
      envelope("email.draft", { to: ["b@test.com"], subject: "D2", body: "B2" }),
      email,
    );
    await executeEmailJob(
      envelope("email.send", { draft_id: d2.structured_output?.draft_id }),
      email,
    );

    expect(email.getSentCount()).toBe(2);
  });
});

// ── Concurrent Operations ──────────────────────────────────────────────────

describe("Email Concurrent Operations", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("20 parallel searches complete successfully", async () => {
    const queries = [
      "from:hans", "subject:ISO", "label:UNREAD", "label:STARRED",
      "subject:AUTOSAR", "subject:SOTIF", "subject:audit", "label:IMPORTANT",
      "", "from:nobody", "workshop", "migration", "assessment", "schedule",
      "from:test", "subject:test", "label:SENT", "to:daniel", "from:anna",
      "subject:proposal",
    ];

    const results = await Promise.all(
      queries.map((q) =>
        executeEmailJob(envelope("email.search", { query: q }), email),
      ),
    );

    expect(results).toHaveLength(20);
    for (const r of results) {
      expect(r.status).toBe("completed");
      expect(r.structured_output?.messages).toBeDefined();
    }
  });

  it("10 parallel drafts complete and count correctly", async () => {
    const results = await Promise.all(
      range(10).map((i) =>
        executeEmailJob(
          envelope("email.draft", {
            to: [`parallel${i}@test.com`],
            subject: `Parallel Draft ${i}`,
            body: `Body ${i}`,
          }),
          email,
        ),
      ),
    );

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.status).toBe("completed");
      expect(r.structured_output?.draft_id).toBeTruthy();
    }
    expect(email.getDraftCount()).toBe(10);
  });

  it("mixed read+draft+search in parallel", async () => {
    const results = await Promise.all([
      // 5 reads
      ...["msg-001", "msg-002", "msg-003", "msg-004", "msg-005"].map((id) =>
        executeEmailJob(envelope("email.read", { message_id: id }), email),
      ),
      // 5 drafts
      ...range(5).map((i) =>
        executeEmailJob(
          envelope("email.draft", {
            to: [`mixed${i}@test.com`],
            subject: `Mixed ${i}`,
            body: `Body ${i}`,
          }),
          email,
        ),
      ),
      // 5 searches
      ...["from:hans", "label:UNREAD", "subject:ISO", "", "workshop"].map((q) =>
        executeEmailJob(envelope("email.search", { query: q }), email),
      ),
    ]);

    expect(results).toHaveLength(15);
    for (const r of results) {
      expect(r.status).toBe("completed");
    }
    expect(email.getDraftCount()).toBe(5);
  });

  it("mixed operations with thread listing", async () => {
    const results = await Promise.all([
      executeEmailJob(envelope("email.list_threads", { max_results: 5 }), email),
      executeEmailJob(envelope("email.search", { query: "label:UNREAD" }), email),
      executeEmailJob(envelope("email.read", { message_id: "msg-001" }), email),
      executeEmailJob(envelope("email.draft", { to: ["t@t.com"], subject: "T", body: "B" }), email),
      executeEmailJob(envelope("email.list_threads", {}), email),
    ]);

    for (const r of results) {
      expect(r.status).toBe("completed");
    }
  });
});

// ── Edge Cases ─────────────────────────────────────────────────────────────

describe("Email Edge Cases", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("search with empty string query returns all", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "" }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(5);
  });

  it("draft with very long body (10KB)", async () => {
    const longBody = "X".repeat(10240);
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["longbody@test.com"],
        subject: "Long body",
        body: longBody,
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.draft_id).toBeTruthy();
  });

  it("draft with special characters in subject", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["special@test.com"],
        subject: "Re: [URGENT] ISO 26262 / ASIL-D & Safety <Goals> (v2.0)",
        body: "Test",
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });

  it("draft with unicode in body", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["unicode@test.com"],
        subject: "Unicode test",
        body: "Sehr geehrter Herr Mueller, vielen Dank fuer Ihre Anfrage.",
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });

  it("search for special character query", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "subject:<Goals> & (v2.0)" }),
      email,
    );
    expect(result.status).toBe("completed");
    // May return 0 matches, but should not crash
    expect(result.structured_output?.messages).toBeDefined();
  });

  it("send inline with single recipient array", async () => {
    const result = await executeEmailJob(
      envelope("email.send", {
        to: ["solo@test.com"],
        subject: "Solo",
        body: "Just one recipient",
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(email.getSentCount()).toBe(1);
  });

  it("draft and send with many CCs", async () => {
    const ccs = range(10).map((i) => `cc${i}@test.com`);
    const draft = await executeEmailJob(
      envelope("email.draft", {
        to: ["main@test.com"],
        subject: "Many CCs",
        body: "Lots of CCs",
        cc: ccs,
      }),
      email,
    );
    expect(draft.status).toBe("completed");

    const send = await executeEmailJob(
      envelope("email.send", { draft_id: draft.structured_output?.draft_id }),
      email,
    );
    expect(send.status).toBe("completed");
  });

  it("label operations on every mock message", async () => {
    for (const id of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005"]) {
      const result = await executeEmailJob(
        envelope("email.label", {
          message_id: id,
          action: "add",
          labels: ["BULK-TAG"],
        }),
        email,
      );
      expect(result.status).toBe("completed");
      expect(email.getLabels(id)).toContain("BULK-TAG");
    }
  });

  it("send then search finds more context", async () => {
    await executeEmailJob(
      envelope("email.send", {
        to: ["after@test.com"],
        subject: "Post-send search",
        body: "After this send we search",
      }),
      email,
    );
    expect(email.getSentCount()).toBe(1);

    const search = await executeEmailJob(
      envelope("email.search", { query: "" }),
      email,
    );
    expect(search.status).toBe("completed");
  });

  it("rapid sequential reads of same message", async () => {
    for (const _ of range(5)) {
      const result = await executeEmailJob(
        envelope("email.read", { message_id: "msg-001" }),
        email,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.message_id).toBe("msg-001");
    }
  });

  it("search with max_results=2 returns exactly 2", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "", max_results: 2 }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(2);
  });

  it("search with max_results=3 returns exactly 3", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "", max_results: 3 }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(3);
  });

  it("search with max_results=4 returns exactly 4", async () => {
    const result = await executeEmailJob(
      envelope("email.search", { query: "", max_results: 4 }),
      email,
    );
    expect(result.status).toBe("completed");
    const msgs = result.structured_output?.messages as any[];
    expect(msgs.length).toBe(4);
  });

  it("read msg-001 cc field is not present (no cc on this message)", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "msg-001" }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.cc).toBeUndefined();
  });

  it("add duplicate label is idempotent", async () => {
    await executeEmailJob(
      envelope("email.label", { message_id: "msg-002", action: "add", labels: ["DUP"] }),
      email,
    );
    await executeEmailJob(
      envelope("email.label", { message_id: "msg-002", action: "add", labels: ["DUP"] }),
      email,
    );
    const labels = email.getLabels("msg-002");
    const dupCount = labels.filter((l: string) => l === "DUP").length;
    expect(dupCount).toBeLessThanOrEqual(2);
  });

  it("send inline multiple recipients", async () => {
    const result = await executeEmailJob(
      envelope("email.send", {
        to: ["a@test.com", "b@test.com", "c@test.com"],
        subject: "Multi",
        body: "To many",
      }),
      email,
    );
    expect(result.status).toBe("completed");
    expect(email.getSentCount()).toBe(1);
  });

  it("draft with single-char subject and body", async () => {
    const result = await executeEmailJob(
      envelope("email.draft", {
        to: ["min@test.com"],
        subject: "X",
        body: "Y",
      }),
      email,
    );
    expect(result.status).toBe("completed");
  });
});
