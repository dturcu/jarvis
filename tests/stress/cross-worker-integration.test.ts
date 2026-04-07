/**
 * Stress: Cross-Worker Integration
 *
 * Tests realistic multi-worker pipelines that simulate actual agent workflows:
 * BD pipeline (web → CRM → email), proposal engine (document → email),
 * and full lifecycle with approval gates.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MockEmailAdapter, executeEmailJob } from "@jarvis/email-worker";
import { MockCrmAdapter, executeCrmJob } from "@jarvis/crm-worker";
import { MockWebAdapter, executeWebJob } from "@jarvis/web-worker";
import { MockDocumentAdapter, executeDocumentJob } from "@jarvis/document-worker";
import { createMockBrowserAdapter, executeBrowserJob } from "@jarvis/browser-worker";
import { RunStore, requestApproval, resolveApproval } from "@jarvis/runtime";
import { AgentMemoryStore } from "@jarvis/agent-framework";
import { createStressDb, cleanupDb } from "./helpers.js";
import type { JobEnvelope } from "@jarvis/shared";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "integration", run_id: randomUUID() },
  };
}

describe("Cross-Worker Integration", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;
  let memory: AgentMemoryStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("integration"));
    store = new RunStore(db);
    memory = new AgentMemoryStore();
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("BD pipeline: web intel → CRM update → email outreach with approval", async () => {
    const agentId = "bd-pipeline";
    const runId = store.startRun(agentId, "scheduled");
    store.transition(runId, agentId, "executing", "plan_built");

    // Step 1: Web intelligence — search news
    const web = new MockWebAdapter();
    const newsResult = await executeWebJob(
      envelope("web.search_news", { query: "automotive safety ISO 26262", max_results: 5 }),
      web,
    );
    expect(newsResult.status).toBe("completed");
    store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "web.search_news" });
    memory.addShortTerm(agentId, runId, `Found ${(newsResult.structured_output?.articles as any[])?.length} articles`);

    // Step 2: Web intel — scrape company profile
    const profileResult = await executeWebJob(
      envelope("web.scrape_profile", { url: "https://bertrandt.com", profile_type: "company" }),
      web,
    );
    expect(profileResult.status).toBe("completed");
    store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "web.scrape_profile" });

    // Step 3: CRM — add/update contact
    const crm = new MockCrmAdapter();
    const crmResult = await executeCrmJob(
      envelope("crm.add_contact", {
        name: "New Lead",
        company: "Target OEM",
        role: "Safety Manager",
        tags: ["iso26262", "prospect"],
      }),
      crm,
    );
    expect(crmResult.status).toBe("completed");
    store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "crm.add_contact" });
    memory.upsertEntity({ agent_id: agentId, entity_type: "contact", name: "New Lead", data: { company: "Target OEM" } });

    // Step 4: Email outreach — requires approval
    const approvalId = requestApproval(db, {
      agent_id: agentId,
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: JSON.stringify({ to: "lead@target-oem.com", subject: "ISO 26262 Consulting" }),
    });
    store.emitEvent(runId, agentId, "approval_requested", { step_no: 4, action: "email.send" });

    // Simulate operator approval
    resolveApproval(db, approvalId, "approved", "operator");
    store.emitEvent(runId, agentId, "approval_resolved", { step_no: 4, action: "email.send" });

    // Step 5: Send email
    const email = new MockEmailAdapter();
    const sendResult = await executeEmailJob(
      envelope("email.send", {
        to: ["lead@target-oem.com"],
        subject: "ISO 26262 Consulting — Thinking in Code",
        body: "We specialize in ISO 26262 compliance...",
      }),
      email,
    );
    expect(sendResult.status).toBe("completed");
    store.emitEvent(runId, agentId, "step_completed", { step_no: 5, action: "email.send" });

    // Complete run
    store.transition(runId, agentId, "completed", "run_completed", { step_no: 5 });
    memory.addLongTerm(agentId, runId, "Contacted Target OEM lead about ISO 26262 consulting");
    memory.logDecision({
      agent_id: agentId, run_id: runId, step: 5,
      action: "email.send", reasoning: "Qualified lead from news intel", outcome: "sent",
    });

    // Verify full lifecycle
    expect(store.getStatus(runId)).toBe("completed");
    expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(7);
    expect(memory.getContext(agentId, runId).short_term.length).toBeGreaterThan(0);
    expect(memory.getEntities(agentId, "contact")).toHaveLength(1);
    expect(email.getSentCount()).toBe(1);
  });

  it("Proposal engine: document analysis → email draft with browser research", async () => {
    const agentId = "proposal-engine";
    const runId = store.startRun(agentId, "manual");
    store.transition(runId, agentId, "executing", "plan_built");

    // Step 1: Browser — extract RFQ from website
    const browser = createMockBrowserAdapter();
    browser.seedPage("https://client.example.com/rfq/2026-04", "RFQ", "<div>ISO 26262 Part 6 assessment needed</div>");
    const extractResult = await executeBrowserJob(
      envelope("browser.extract", { url: "https://client.example.com/rfq/2026-04", format: "text" }),
      browser,
    );
    expect(extractResult.status).toBe("completed");
    store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "browser.extract" });

    // Step 2: Document — analyze compliance
    const doc = new MockDocumentAdapter();
    const complianceResult = await executeDocumentJob(
      envelope("document.analyze_compliance", {
        file_path: "/rfqs/rfq-2026-04.pdf",
        framework: "iso_26262",
      }),
      doc,
    );
    expect(complianceResult.status).toBe("completed");
    store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "document.analyze_compliance" });

    // Step 3: Document — generate proposal report
    const reportResult = await executeDocumentJob(
      envelope("document.generate_report", {
        title: "Proposal: ISO 26262 Assessment for Client",
        template: "proposal",
        data: { scope: "Part 6", effort_days: 15, rate: 1200 },
        output_format: "pdf",
        output_path: "/tmp/proposal-iso26262-assessment",
      }),
      doc,
    );
    expect(reportResult.status).toBe("completed");
    store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "document.generate_report" });

    // Step 4: Email — draft proposal
    const email = new MockEmailAdapter();
    const draftResult = await executeEmailJob(
      envelope("email.draft", {
        to: ["procurement@client.example.com"],
        subject: "Proposal: ISO 26262 Part 6 Assessment",
        body: "Please find attached our proposal for the ISO 26262 assessment.",
      }),
      email,
    );
    expect(draftResult.status).toBe("completed");
    store.emitEvent(runId, agentId, "step_completed", { step_no: 4, action: "email.draft" });

    store.transition(runId, agentId, "completed", "run_completed", { step_no: 4 });

    expect(store.getStatus(runId)).toBe("completed");
    expect(doc.getGeneratedReports().length).toBeGreaterThan(0);
    expect(email.getDraftCount()).toBe(1);
  });

  it("Approval rejection stops pipeline", async () => {
    const agentId = "content-engine";
    const runId = store.startRun(agentId, "scheduled");
    store.transition(runId, agentId, "executing", "plan_built");

    // Request approval for social post
    const approvalId = requestApproval(db, {
      agent_id: agentId,
      run_id: runId,
      action: "social.post",
      severity: "critical",
      payload: JSON.stringify({ text: "Draft LinkedIn post about AUTOSAR" }),
    });

    // Operator rejects
    resolveApproval(db, approvalId, "rejected", "operator", "Content not aligned with brand");

    // Agent should handle rejection → cancel or fail
    store.transition(runId, agentId, "cancelled", "run_cancelled", {
      details: { reason: "Approval rejected by operator" } as any,
    });

    expect(store.getStatus(runId)).toBe("cancelled");
  });

  it("3 agents running concurrently with shared DB", async () => {
    const agents = ["bd-pipeline", "proposal-engine", "evidence-auditor"];

    const results = await Promise.all(
      agents.map(async (agentId) => {
        const runId = store.startRun(agentId, "concurrent-test");
        store.transition(runId, agentId, "executing", "plan_built");

        // Each does 3 steps
        for (let step = 1; step <= 3; step++) {
          store.emitEvent(runId, agentId, "step_completed", {
            step_no: step,
            action: `${agentId.split("-")[0]}.step_${step}`,
          });
        }

        store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

        return { agentId, runId, status: store.getStatus(runId) };
      }),
    );

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.status).toBe("completed");
    }

    // All runs should be in the database
    const allRuns = store.getRecentRuns(10);
    expect(allRuns.filter(r => r.status === "completed")).toHaveLength(3);
  });

  it("memory tracks entities across multiple agent runs", () => {
    // BD pipeline discovers a contact
    memory.upsertEntity({
      agent_id: "bd-pipeline", entity_type: "contact",
      name: "Anna Lindström", data: { company: "Volvo", role: "Safety Architect", score: 90 },
    });

    // Proposal engine references same contact
    memory.upsertEntity({
      agent_id: "proposal-engine", entity_type: "contact",
      name: "Anna Lindström", data: { company: "Volvo", engagement: "RFQ-2026-003" },
    });

    // Each agent sees their own version
    const bdEntities = memory.getEntities("bd-pipeline", "contact");
    const peEntities = memory.getEntities("proposal-engine", "contact");
    expect(bdEntities).toHaveLength(1);
    expect(peEntities).toHaveLength(1);
    expect(bdEntities[0].data.score).toBe(90);
    expect(peEntities[0].data.engagement).toBe("RFQ-2026-003");
  });
});
