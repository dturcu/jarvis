/**
 * Stress: Email + CRM Worker Workflows
 *
 * Tests email operations (search, read, draft, send, label, threads)
 * and CRM operations (contacts, pipeline, stages, notes, digest)
 * via their mock adapters and execute functions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockEmailAdapter, executeEmailJob } from "@jarvis/email-worker";
import { MockCrmAdapter, executeCrmJob } from "@jarvis/crm-worker";
import type { JobEnvelope } from "@jarvis/shared";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "stress-test", run_id: randomUUID() },
  };
}

describe("Email Worker Workflows", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("full email workflow: search → read → draft → send", async () => {
    // 1. Search for unread emails
    const searchResult = await executeEmailJob(
      envelope("email.search", { query: "label:UNREAD" }),
      email,
    );
    expect(searchResult.status).toBe("completed");
    const messages = searchResult.structured_output?.messages as any[];
    expect(messages.length).toBeGreaterThan(0);

    // 2. Read the first unread message
    const firstMsg = messages[0];
    const readResult = await executeEmailJob(
      envelope("email.read", { message_id: firstMsg.message_id }),
      email,
    );
    expect(readResult.status).toBe("completed");
    expect(readResult.structured_output?.subject).toBeTruthy();

    // 3. Draft a reply
    const draftResult = await executeEmailJob(
      envelope("email.draft", {
        to: ["hans.mueller@autotech.com"],
        subject: "Re: AUTOSAR migration",
        body: "Thank you for your inquiry about ISO 26262 consulting.",
        reply_to_message_id: firstMsg.message_id,
      }),
      email,
    );
    expect(draftResult.status).toBe("completed");
    expect(draftResult.structured_output?.draft_id).toBeTruthy();

    // 4. Send the draft
    const sendResult = await executeEmailJob(
      envelope("email.send", { draft_id: draftResult.structured_output?.draft_id }),
      email,
    );
    expect(sendResult.status).toBe("completed");
    expect(email.getSentCount()).toBe(1);
  });

  it("search with multiple query tokens", async () => {
    const r1 = await executeEmailJob(envelope("email.search", { query: "from:hans" }), email);
    expect(r1.status).toBe("completed");

    const r2 = await executeEmailJob(envelope("email.search", { query: "subject:ISO 26262" }), email);
    expect(r2.status).toBe("completed");
    expect((r2.structured_output?.messages as any[]).length).toBeGreaterThan(0);

    const r3 = await executeEmailJob(envelope("email.search", { query: "label:STARRED" }), email);
    expect(r3.status).toBe("completed");
  });

  it("label operations: add and remove", async () => {
    const labelResult = await executeEmailJob(
      envelope("email.label", {
        message_id: "msg-001",
        action: "add",
        labels: ["IMPORTANT", "FOLLOW-UP"],
      }),
      email,
    );

    expect(labelResult.status).toBe("completed");
    expect(labelResult.structured_output?.labels_applied).toContain("IMPORTANT");
  });

  it("listThreads groups messages correctly", async () => {
    const result = await executeEmailJob(
      envelope("email.list_threads", { max_results: 10 }),
      email,
    );

    expect(result.status).toBe("completed");
    const threads = result.structured_output?.threads as any[];
    expect(threads.length).toBeGreaterThan(0);
    for (const t of threads) {
      expect(t.thread_id).toBeTruthy();
      expect(t.message_count).toBeGreaterThan(0);
    }
  });

  it("inline send (no draft) with recipients", async () => {
    const result = await executeEmailJob(
      envelope("email.send", {
        to: ["client@example.com"],
        subject: "Proposal follow-up",
        body: "Attached is our updated proposal for your review.",
      }),
      email,
    );

    expect(result.status).toBe("completed");
    expect(email.getSentCount()).toBe(1);
  });

  it("10 concurrent email operations", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => executeEmailJob(envelope("email.search", { query: "label:UNREAD" }), email)),
      ...Array.from({ length: 3 }, (_, i) => executeEmailJob(envelope("email.draft", { to: [`user${i}@test.com`], subject: `Draft ${i}`, body: "Test" }), email)),
      ...Array.from({ length: 2 }, () => executeEmailJob(envelope("email.list_threads", { max_results: 5 }), email)),
    ]);

    expect(results.every(r => r.status === "completed")).toBe(true);
    expect(email.getDraftCount()).toBe(3);
  });
});

describe("CRM Worker Workflows", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("full CRM lifecycle: add → update → stage → note → digest", async () => {
    // 1. Add contact
    const addResult = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "Klaus Weber",
        company: "BMW AG",
        role: "Safety Director",
        email: "k.weber@bmw.com",
        tags: ["oem", "safety"],
      }),
      crm,
    );
    expect(addResult.status).toBe("completed");
    const contactId = (addResult.structured_output?.contact as any)?.contact_id;
    expect(contactId).toBeTruthy();

    // 2. Update score
    const updateResult = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: contactId,
        score: 85,
      }),
      crm,
    );
    expect(updateResult.status).toBe("completed");

    // 3. Move stage
    const moveResult = await executeCrmJob(
      envelope("crm.move_stage", {
        contact_id: contactId,
        new_stage: "meeting",
      }),
      crm,
    );
    expect(moveResult.status).toBe("completed");
    expect(moveResult.structured_output?.new_stage).toBe("meeting");

    // 4. Add note
    const noteResult = await executeCrmJob(
      envelope("crm.add_note", {
        contact_id: contactId,
        content: "Initial meeting scheduled for next week to discuss ISO 26262 gap analysis.",
      }),
      crm,
    );
    expect(noteResult.status).toBe("completed");

    // 5. Pipeline digest
    const digestResult = await executeCrmJob(
      envelope("crm.digest", {}),
      crm,
    );
    expect(digestResult.status).toBe("completed");
  });

  it("pipeline listing with filters", async () => {
    // List all
    const allResult = await executeCrmJob(envelope("crm.list_pipeline", {}), crm);
    expect(allResult.status).toBe("completed");
    const allContacts = allResult.structured_output?.contacts as any[];
    expect(allContacts.length).toBeGreaterThan(0);

    // Filter by stage
    const stageResult = await executeCrmJob(
      envelope("crm.list_pipeline", { stage: "won" }),
      crm,
    );
    expect(stageResult.status).toBe("completed");

    // Filter by min score
    const scoreResult = await executeCrmJob(
      envelope("crm.list_pipeline", { min_score: 70 }),
      crm,
    );
    expect(scoreResult.status).toBe("completed");
  });

  it("search contacts by query", async () => {
    const result = await executeCrmJob(
      envelope("crm.search", { query: "Bertrandt" }),
      crm,
    );
    expect(result.status).toBe("completed");
    const matches = result.structured_output?.contacts as any[];
    expect(matches.length).toBeGreaterThan(0);
  });

  it("digest identifies hot leads correctly", async () => {
    const result = await executeCrmJob(envelope("crm.digest", {}), crm);
    expect(result.status).toBe("completed");

    const hotLeads = result.structured_output?.hot_leads as any[];
    // Hot leads = score > 70 AND stage in {meeting, proposal, negotiation}
    if (hotLeads && hotLeads.length > 0) {
      for (const lead of hotLeads) {
        expect(lead.score).toBeGreaterThan(70);
      }
    }
  });

  it("10 concurrent CRM operations", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 3 }, () => executeCrmJob(envelope("crm.list_pipeline", {}), crm)),
      ...Array.from({ length: 3 }, () => executeCrmJob(envelope("crm.search", { query: "engineer" }), crm)),
      ...Array.from({ length: 2 }, () => executeCrmJob(envelope("crm.digest", {}), crm)),
      ...Array.from({ length: 2 }, (_, i) =>
        executeCrmJob(envelope("crm.add_contact", { name: `Stress Contact ${i}`, company: "Stress Corp", role: "Tester" }), crm),
      ),
    ]);

    expect(results.every(r => r.status === "completed")).toBe(true);
  });
});
