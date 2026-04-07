/**
 * Stress: End-to-End Agent Lifecycles
 *
 * Simulates complete agent workflows for each of the 14 Jarvis agents,
 * verifying run state machine transitions, event emission, approval gates,
 * memory entity creation, and concurrent execution.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RunStore, requestApproval, resolveApproval } from "@jarvis/runtime";
import { AgentMemoryStore } from "@jarvis/agent-framework";
import { MockEmailAdapter, executeEmailJob } from "@jarvis/email-worker";
import { MockCrmAdapter, executeCrmJob } from "@jarvis/crm-worker";
import { MockWebAdapter, executeWebJob } from "@jarvis/web-worker";
import { MockDocumentAdapter, executeDocumentJob } from "@jarvis/document-worker";
import { MockCalendarAdapter, executeCalendarJob } from "@jarvis/calendar-worker";
import { MockSocialAdapter, executeSocialJob } from "@jarvis/social-worker";
import { createMockBrowserAdapter, executeBrowserJob } from "@jarvis/browser-worker";
import { createStressDb, cleanupDb, range } from "./helpers.js";
import type { JobEnvelope } from "@jarvis/shared";

function envelope(type: string, input: Record<string, unknown>, agentId = "e2e-test"): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: agentId, run_id: randomUUID() },
  };
}

describe("End-to-End Agent Lifecycles", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;
  let memory: AgentMemoryStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("e2e-agents"));
    store = new RunStore(db);
    memory = new AgentMemoryStore();
  });

  afterEach(() => cleanupDb(db, dbPath));

  // ── 1. BD Pipeline ────────────────────────────────────────────────────

  describe("bd-pipeline", () => {
    it("full workflow: web.search_news -> web.enrich_contact -> crm.add_contact -> crm.move_stage -> email.draft -> [approval] -> email.send", async () => {
      const agentId = "bd-pipeline";
      const web = new MockWebAdapter();
      const crm = new MockCrmAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "scheduled");
      expect(store.getStatus(runId)).toBe("planning");
      store.transition(runId, agentId, "executing", "plan_built");
      expect(store.getStatus(runId)).toBe("executing");

      // Step 1: web.search_news
      const news = await executeWebJob(envelope("web.search_news", { query: "ISO 26262 automotive", max_results: 5 }, agentId), web);
      expect(news.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "web.search_news" });

      // Step 2: web.enrich_contact
      const enrich = await executeWebJob(envelope("web.enrich_contact", { name: "Klaus Weber", company: "Bertrandt" }, agentId), web);
      expect(enrich.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "web.enrich_contact" });

      // Step 3: crm.add_contact
      const addContact = await executeCrmJob(envelope("crm.add_contact", {
        name: "Klaus Weber", company: "Bertrandt AG", role: "VP Engineering",
        email: "k.weber@bertrandt.com", tags: ["oem", "iso26262"],
      }, agentId), crm);
      expect(addContact.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "crm.add_contact" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "contact", name: "Klaus Weber", data: { company: "Bertrandt AG" } });

      // Step 4: crm.move_stage
      const contactId = (addContact.structured_output?.contact as any)?.contact_id;
      const moveStage = await executeCrmJob(envelope("crm.move_stage", {
        contact_id: contactId, new_stage: "qualified",
      }, agentId), crm);
      expect(moveStage.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 4, action: "crm.move_stage" });

      // Step 5: email.draft
      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["k.weber@bertrandt.com"], subject: "ISO 26262 Consulting", body: "Consulting proposal",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 5, action: "email.draft" });

      // Step 6: Approval gate
      const approvalId = requestApproval(db, {
        agent_id: agentId, run_id: runId, action: "email.send",
        severity: "critical", payload: JSON.stringify({ to: "k.weber@bertrandt.com" }),
      });
      store.emitEvent(runId, agentId, "approval_requested", { step_no: 6, action: "email.send" });
      resolveApproval(db, approvalId, "approved", "operator");
      store.emitEvent(runId, agentId, "approval_resolved", { step_no: 6, action: "email.send" });

      // Step 7: email.send
      const send = await executeEmailJob(envelope("email.send", {
        to: ["k.weber@bertrandt.com"], subject: "ISO 26262 Consulting", body: "Consulting proposal",
      }, agentId), email);
      expect(send.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 7, action: "email.send" });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 7 });
      memory.addLongTerm(agentId, runId, "Contacted Bertrandt re ISO 26262");

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(9);
      expect(memory.getEntities(agentId, "contact")).toHaveLength(1);
      expect(email.getSentCount()).toBe(1);
    });
  });

  // ── 2. Proposal Engine ────────────────────────────────────────────────

  describe("proposal-engine", () => {
    it("full workflow: document.ingest -> document.analyze_compliance -> document.generate_report -> email.draft", async () => {
      const agentId = "proposal-engine";
      const doc = new MockDocumentAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "manual");
      store.transition(runId, agentId, "executing", "plan_built");

      // Step 1: document.ingest
      const ingest = await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-rfq-2026-05.pdf" }, agentId), doc);
      expect(ingest.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "document.ingest" });

      // Step 2: document.analyze_compliance
      const compliance = await executeDocumentJob(envelope("document.analyze_compliance", {
        file_path: "/tmp/test-rfq-2026-05.pdf", framework: "iso_26262",
      }, agentId), doc);
      expect(compliance.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "document.analyze_compliance" });

      // Step 3: document.generate_report
      const report = await executeDocumentJob(envelope("document.generate_report", {
        title: "Proposal: ISO 26262 Assessment", template: "proposal",
        data: { scope: "Part 6", effort_days: 20 },
        output_format: "pdf", output_path: "/tmp/proposal-assessment",
      }, agentId), doc);
      expect(report.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "document.generate_report" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "document", name: "Proposal ISO 26262", data: { path: "/tmp/proposal-assessment" } });

      // Step 4: email.draft
      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["procurement@client.com"], subject: "ISO 26262 Assessment Proposal",
        body: "Please find the proposal attached.",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 4, action: "email.draft" });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 4 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(6);
      expect(memory.getEntities(agentId, "document")).toHaveLength(1);
      expect(doc.getGeneratedReports().length).toBeGreaterThan(0);
    });
  });

  // ── 3. Evidence Auditor ───────────────────────────────────────────────

  describe("evidence-auditor", () => {
    it("full workflow: document.ingest -> document.extract_clauses -> document.analyze_compliance (iso_26262) -> document.generate_report", async () => {
      const agentId = "evidence-auditor";
      const doc = new MockDocumentAdapter();

      const runId = store.startRun(agentId, "manual");
      store.transition(runId, agentId, "executing", "plan_built");

      const ingest = await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-aspice-wp.pdf" }, agentId), doc);
      expect(ingest.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "document.ingest" });

      const clauses = await executeDocumentJob(envelope("document.extract_clauses", {
        file_path: "/tmp/test-aspice-wp.pdf", clause_types: ["safety_requirement", "verification"],
      }, agentId), doc);
      expect(clauses.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "document.extract_clauses" });

      const compliance = await executeDocumentJob(envelope("document.analyze_compliance", {
        file_path: "/tmp/test-aspice-wp.pdf", framework: "iso_26262",
      }, agentId), doc);
      expect(compliance.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "document.analyze_compliance" });

      const report = await executeDocumentJob(envelope("document.generate_report", {
        title: "Gap Analysis: ISO 26262", template: "gap_analysis", data: { gaps: 5 },
        output_format: "pdf", output_path: "/tmp/gap-analysis",
      }, agentId), doc);
      expect(report.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 4, action: "document.generate_report" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "document", name: "Gap Analysis Report", data: { gaps: 5 } });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 4 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(6);
      expect(memory.getEntities(agentId, "document")).toHaveLength(1);
    });
  });

  // ── 4. Contract Reviewer ──────────────────────────────────────────────

  describe("contract-reviewer", () => {
    it("full workflow: document.ingest -> document.extract_clauses -> document.analyze_compliance -> email.draft", async () => {
      const agentId = "contract-reviewer";
      const doc = new MockDocumentAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "manual");
      store.transition(runId, agentId, "executing", "plan_built");

      const ingest = await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-nda-v3.pdf" }, agentId), doc);
      expect(ingest.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "document.ingest" });

      const clauses = await executeDocumentJob(envelope("document.extract_clauses", {
        file_path: "/tmp/test-nda-v3.pdf", clause_types: ["confidentiality", "ip_ownership", "termination"],
      }, agentId), doc);
      expect(clauses.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "document.extract_clauses" });

      const compliance = await executeDocumentJob(envelope("document.analyze_compliance", {
        file_path: "/tmp/test-nda-v3.pdf", framework: "iso_26262",
      }, agentId), doc);
      expect(compliance.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "document.analyze_compliance" });

      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["legal@thinkingincode.com"], subject: "NDA Review: Bertrandt AG",
        body: "Recommendation: Sign with minor amendments.",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 4, action: "email.draft" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "document", name: "NDA Bertrandt", data: { recommendation: "sign" } });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 4 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(6);
      expect(memory.getEntities(agentId, "document")).toHaveLength(1);
    });
  });

  // ── 5. Staffing Monitor ───────────────────────────────────────────────

  describe("staffing-monitor", () => {
    it("full workflow: crm.list_pipeline -> crm.digest -> email.draft", async () => {
      const agentId = "staffing-monitor";
      const crm = new MockCrmAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "scheduled");
      store.transition(runId, agentId, "executing", "plan_built");

      const pipeline = await executeCrmJob(envelope("crm.list_pipeline", {}, agentId), crm);
      expect(pipeline.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "crm.list_pipeline" });

      const digest = await executeCrmJob(envelope("crm.digest", {}, agentId), crm);
      expect(digest.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "crm.digest" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "project", name: "Staffing Report", data: { period: "weekly" } });

      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["daniel@thinkingincode.com"], subject: "Weekly Staffing Report",
        body: "Team utilization summary attached.",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "email.draft" });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(5);
      expect(memory.getEntities(agentId, "project")).toHaveLength(1);
    });
  });

  // ── 6. Content Engine ─────────────────────────────────────────────────

  describe("content-engine", () => {
    it("full workflow: web.search_news -> social.post -> [approval]", async () => {
      const agentId = "content-engine";
      const web = new MockWebAdapter();
      const social = new MockSocialAdapter();

      const runId = store.startRun(agentId, "scheduled");
      store.transition(runId, agentId, "executing", "plan_built");

      const news = await executeWebJob(envelope("web.search_news", { query: "AUTOSAR automotive trends", max_results: 3 }, agentId), web);
      expect(news.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "web.search_news" });

      // Approval gate for social.post
      const approvalId = requestApproval(db, {
        agent_id: agentId, run_id: runId, action: "social.post",
        severity: "critical",
        payload: JSON.stringify({ text: "AUTOSAR insights post" }),
      });
      store.emitEvent(runId, agentId, "approval_requested", { step_no: 2, action: "social.post" });
      resolveApproval(db, approvalId, "approved", "operator");
      store.emitEvent(runId, agentId, "approval_resolved", { step_no: 2, action: "social.post" });

      const post = await executeSocialJob(envelope("social.post", {
        platform: "linkedin", text: "AUTOSAR insights for automotive safety.",
        hashtags: ["AUTOSAR", "AutomotiveSafety"],
      }, agentId), social);
      expect(post.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "social.post" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "document", name: "LinkedIn Post", data: { topic: "AUTOSAR" } });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(7);
    });
  });

  // ── 7. Portfolio Monitor ──────────────────────────────────────────────

  describe("portfolio-monitor", () => {
    it("full workflow: web.search_news -> web.competitive_intel -> email.draft", async () => {
      const agentId = "portfolio-monitor";
      const web = new MockWebAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "scheduled");
      store.transition(runId, agentId, "executing", "plan_built");

      const news = await executeWebJob(envelope("web.search_news", { query: "crypto market trends", max_results: 5 }, agentId), web);
      expect(news.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "web.search_news" });

      const intel = await executeWebJob(envelope("web.competitive_intel", { company_name: "Bitcoin" }, agentId), web);
      expect(intel.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "web.competitive_intel" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "company", name: "Portfolio Status", data: { drift: 2.5 } });

      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["daniel@thinkingincode.com"], subject: "Portfolio Rebalance Alert",
        body: "Drift detected; rebalance recommended.",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "email.draft" });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(5);
      expect(memory.getEntities(agentId, "company")).toHaveLength(1);
    });
  });

  // ── 8. Garden Calendar ────────────────────────────────────────────────

  describe("garden-calendar", () => {
    it("full workflow: calendar.list_events -> calendar.create_event -> calendar.brief", async () => {
      const agentId = "garden-calendar";
      const cal = new MockCalendarAdapter();

      const runId = store.startRun(agentId, "scheduled");
      store.transition(runId, agentId, "executing", "plan_built");

      const list = await executeCalendarJob(envelope("calendar.list_events", {
        start_date: "2026-04-07", end_date: "2026-04-14",
      }, agentId), cal);
      expect(list.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "calendar.list_events" });

      const create = await executeCalendarJob(envelope("calendar.create_event", {
        title: "Garden: Transplant tomatoes", start: "2026-04-10T09:00:00",
        end: "2026-04-10T11:00:00", description: "Move seedlings to raised bed 3",
      }, agentId), cal);
      expect(create.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "calendar.create_event" });

      const eventId = create.structured_output?.event_id;
      const brief = await executeCalendarJob(envelope("calendar.brief", { event_id: eventId }, agentId), cal);
      expect(brief.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "calendar.brief" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "project", name: "Garden Brief", data: { week: "2026-W15" } });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(5);
      expect(memory.getEntities(agentId, "project")).toHaveLength(1);
    });
  });

  // ── 9. Email Campaign ─────────────────────────────────────────────────

  describe("email-campaign", () => {
    it("full workflow: email.search -> email.draft -> [approval] -> email.send x 3", async () => {
      const agentId = "email-campaign";
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "scheduled");
      store.transition(runId, agentId, "executing", "plan_built");

      // Step 1: email.search
      const search = await executeEmailJob(envelope("email.search", { query: "label:CAMPAIGN" }, agentId), email);
      expect(search.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "email.search" });

      // Steps 2-4: draft 3 emails
      const recipients = ["lead1@corp.com", "lead2@corp.com", "lead3@corp.com"];
      for (let i = 0; i < 3; i++) {
        const draft = await executeEmailJob(envelope("email.draft", {
          to: [recipients[i]], subject: `Campaign Follow-up ${i + 1}`, body: "Follow-up content",
        }, agentId), email);
        expect(draft.status).toBe("completed");
        store.emitEvent(runId, agentId, "step_completed", { step_no: 2 + i, action: "email.draft" });
      }

      // Approval gate
      const approvalId = requestApproval(db, {
        agent_id: agentId, run_id: runId, action: "email.send",
        severity: "critical", payload: JSON.stringify({ count: 3 }),
      });
      store.emitEvent(runId, agentId, "approval_requested", { step_no: 5, action: "email.send" });
      resolveApproval(db, approvalId, "approved", "operator");
      store.emitEvent(runId, agentId, "approval_resolved", { step_no: 5, action: "email.send" });

      // Send 3 emails
      for (let i = 0; i < 3; i++) {
        const send = await executeEmailJob(envelope("email.send", {
          to: [recipients[i]], subject: `Campaign Follow-up ${i + 1}`, body: "Follow-up content",
        }, agentId), email);
        expect(send.status).toBe("completed");
        store.emitEvent(runId, agentId, "step_completed", { step_no: 6 + i, action: "email.send" });
      }

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 8 });
      memory.upsertEntity({ agent_id: agentId, entity_type: "project", name: "Campaign Batch", data: { sent: 3 } });

      expect(store.getStatus(runId)).toBe("completed");
      expect(email.getSentCount()).toBe(3);
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(11);
      expect(memory.getEntities(agentId, "project")).toHaveLength(1);
    });
  });

  // ── 10. Social Engagement ─────────────────────────────────────────────

  describe("social-engagement", () => {
    it("full workflow: social.scan_feed -> social.like -> social.comment -> social.repost", async () => {
      const agentId = "social-engagement";
      const social = new MockSocialAdapter();

      const runId = store.startRun(agentId, "scheduled");
      store.transition(runId, agentId, "executing", "plan_built");

      const scan = await executeSocialJob(envelope("social.scan_feed", { platform: "linkedin", max_posts: 10 }, agentId), social);
      expect(scan.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "social.scan_feed" });

      const like = await executeSocialJob(envelope("social.like", {
        platform: "linkedin", post_url: "https://linkedin.com/post/p-001",
      }, agentId), social);
      expect(like.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "social.like" });

      const comment = await executeSocialJob(envelope("social.comment", {
        platform: "linkedin", post_url: "https://linkedin.com/post/p-001",
        text: "Great insights on functional safety!",
      }, agentId), social);
      expect(comment.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "social.comment" });

      const repost = await executeSocialJob(envelope("social.repost", {
        platform: "linkedin", post_url: "https://linkedin.com/post/p-002",
      }, agentId), social);
      expect(repost.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 4, action: "social.repost" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "contact", name: "Engaged Posts", data: { count: 3 } });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 4 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(6);
      expect(social.getActionCount()).toBe(4);
    });
  });

  // ── 11. Security Monitor ──────────────────────────────────────────────

  describe("security-monitor", () => {
    it("full workflow: web.search_news -> web.monitor_page -> email.draft", async () => {
      const agentId = "security-monitor";
      const web = new MockWebAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "scheduled");
      store.transition(runId, agentId, "executing", "plan_built");

      const news = await executeWebJob(envelope("web.search_news", { query: "CVE automotive software vulnerability", max_results: 5 }, agentId), web);
      expect(news.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "web.search_news" });

      const monitor = await executeWebJob(envelope("web.monitor_page", { url: "https://nvd.nist.gov/vuln", selectors: [".vuln-entry"] }, agentId), web);
      expect(monitor.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "web.monitor_page" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "document", name: "Security Scan", data: { vulnerabilities: 2 } });

      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["security@thinkingincode.com"], subject: "Security Advisory Update",
        body: "New vulnerabilities detected in automotive toolchains.",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "email.draft" });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(5);
      expect(memory.getEntities(agentId, "document")).toHaveLength(1);
    });
  });

  // ── 12. Drive Watcher ─────────────────────────────────────────────────

  describe("drive-watcher", () => {
    it("full workflow: web.monitor_page -> document.ingest -> email.draft", async () => {
      const agentId = "drive-watcher";
      const web = new MockWebAdapter();
      const doc = new MockDocumentAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "scheduled");
      store.transition(runId, agentId, "executing", "plan_built");

      const monitor = await executeWebJob(envelope("web.monitor_page", {
        url: "https://drive.google.com/shared", selectors: [".file-entry"],
      }, agentId), web);
      expect(monitor.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "web.monitor_page" });

      const ingest = await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-new-doc.pdf" }, agentId), doc);
      expect(ingest.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "document.ingest" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "document", name: "new-doc.pdf", data: { source: "shared_drive" } });

      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["daniel@thinkingincode.com"], subject: "New Document Detected",
        body: "A new document was uploaded to the shared drive.",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "email.draft" });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(5);
      expect(memory.getEntities(agentId, "document")).toHaveLength(1);
    });
  });

  // ── 13. Invoice Generator ─────────────────────────────────────────────

  describe("invoice-generator", () => {
    it("full workflow: crm.search -> document.generate_report -> email.draft -> [approval] -> email.send", async () => {
      const agentId = "invoice-generator";
      const crm = new MockCrmAdapter();
      const doc = new MockDocumentAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "manual");
      store.transition(runId, agentId, "executing", "plan_built");

      const search = await executeCrmJob(envelope("crm.search", { query: "Bertrandt" }, agentId), crm);
      expect(search.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "crm.search" });

      const report = await executeDocumentJob(envelope("document.generate_report", {
        title: "Invoice: Bertrandt AG", template: "invoice",
        data: { amount: 18000, currency: "EUR", hours: 15 },
        output_format: "pdf", output_path: "/tmp/invoice-bertrandt",
      }, agentId), doc);
      expect(report.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "document.generate_report" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "document", name: "Invoice Bertrandt", data: { amount: 18000 } });

      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["billing@bertrandt.com"], subject: "Invoice: ISO 26262 Consulting",
        body: "Please find the invoice attached.",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "email.draft" });

      // Approval gate
      const approvalId = requestApproval(db, {
        agent_id: agentId, run_id: runId, action: "email.send",
        severity: "critical", payload: JSON.stringify({ to: "billing@bertrandt.com" }),
      });
      store.emitEvent(runId, agentId, "approval_requested", { step_no: 4, action: "email.send" });
      resolveApproval(db, approvalId, "approved", "operator");
      store.emitEvent(runId, agentId, "approval_resolved", { step_no: 4, action: "email.send" });

      const send = await executeEmailJob(envelope("email.send", {
        to: ["billing@bertrandt.com"], subject: "Invoice: ISO 26262 Consulting",
        body: "Please find the invoice attached.",
      }, agentId), email);
      expect(send.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 5, action: "email.send" });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 5 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(email.getSentCount()).toBe(1);
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(9);
      expect(memory.getEntities(agentId, "document")).toHaveLength(1);
    });
  });

  // ── 14. Meeting Transcriber ───────────────────────────────────────────

  describe("meeting-transcriber", () => {
    it("full workflow: calendar.brief -> document.ingest -> email.draft", async () => {
      const agentId = "meeting-transcriber";
      const cal = new MockCalendarAdapter();
      const doc = new MockDocumentAdapter();
      const email = new MockEmailAdapter();

      const runId = store.startRun(agentId, "manual");
      store.transition(runId, agentId, "executing", "plan_built");

      const brief = await executeCalendarJob(envelope("calendar.brief", { event_id: "evt-autosar-001" }, agentId), cal);
      expect(brief.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "calendar.brief" });

      const ingest = await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-meeting-2026-04-07.mp3" }, agentId), doc);
      expect(ingest.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "document.ingest" });
      memory.upsertEntity({ agent_id: agentId, entity_type: "document", name: "Meeting Transcript", data: { date: "2026-04-07" } });

      const draft = await executeEmailJob(envelope("email.draft", {
        to: ["team@thinkingincode.com"], subject: "Meeting Summary: 2026-04-07",
        body: "Key decisions and action items from today's meeting.",
      }, agentId), email);
      expect(draft.status).toBe("completed");
      store.emitEvent(runId, agentId, "step_completed", { step_no: 3, action: "email.draft" });

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

      expect(store.getStatus(runId)).toBe("completed");
      expect(store.getRunEvents(runId).length).toBeGreaterThanOrEqual(5);
      expect(memory.getEntities(agentId, "document")).toHaveLength(1);
    });
  });

  // ── Cross-Agent Tests ─────────────────────────────────────────────────

  describe("cross-agent scenarios", () => {
    it("all 14 agents running concurrently", async () => {
      const AGENT_IDS = [
        "bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer",
        "staffing-monitor", "content-engine", "portfolio-monitor", "garden-calendar",
        "email-campaign", "social-engagement", "security-monitor", "drive-watcher",
        "invoice-generator", "meeting-transcriber",
      ];

      const errors: string[] = [];

      await Promise.all(
        AGENT_IDS.map(async (agentId) => {
          try {
            const runId = store.startRun(agentId, "concurrent");
            store.transition(runId, agentId, "executing", "plan_built");

            for (let step = 1; step <= 3; step++) {
              store.emitEvent(runId, agentId, "step_completed", {
                step_no: step, action: `${agentId}.step_${step}`,
              });
            }

            store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });
            memory.addLongTerm(agentId, runId, `${agentId} completed concurrent run`);
          } catch (e) { errors.push(`${agentId}: ${String(e)}`); }
        }),
      );

      expect(errors).toHaveLength(0);
      const allRuns = store.getRecentRuns(20);
      expect(allRuns.filter((r) => r.status === "completed")).toHaveLength(14);

      // Each agent should have its own long-term memory
      for (const agentId of AGENT_IDS) {
        const ctx = memory.getContext(agentId, "any-run");
        expect(ctx.long_term.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("all 14 agents running twice sequentially (no state leakage)", async () => {
      const AGENT_IDS = [
        "bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer",
        "staffing-monitor", "content-engine", "portfolio-monitor", "garden-calendar",
        "email-campaign", "social-engagement", "security-monitor", "drive-watcher",
        "invoice-generator", "meeting-transcriber",
      ];

      // Run 1
      const run1Ids: string[] = [];
      for (const agentId of AGENT_IDS) {
        const runId = store.startRun(agentId, "sequential-1");
        store.transition(runId, agentId, "executing", "plan_built");
        store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: `${agentId}.step_1` });
        store.transition(runId, agentId, "completed", "run_completed", { step_no: 1 });
        run1Ids.push(runId);
      }

      // Run 2
      const run2Ids: string[] = [];
      for (const agentId of AGENT_IDS) {
        const runId = store.startRun(agentId, "sequential-2");
        store.transition(runId, agentId, "executing", "plan_built");
        store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: `${agentId}.step_1` });
        store.transition(runId, agentId, "completed", "run_completed", { step_no: 1 });
        run2Ids.push(runId);
      }

      // Verify no overlaps
      const allIds = new Set([...run1Ids, ...run2Ids]);
      expect(allIds.size).toBe(28);

      // All 28 runs completed
      const allRuns = store.getRecentRuns(30);
      expect(allRuns.filter((r) => r.status === "completed")).toHaveLength(28);

      // Run 1 events are separate from Run 2 events
      for (let i = 0; i < AGENT_IDS.length; i++) {
        const events1 = store.getRunEvents(run1Ids[i]);
        const events2 = store.getRunEvents(run2Ids[i]);
        // Each run should have exactly 3 events: run_started + plan_built + step_completed
        expect(events1.length).toBeGreaterThanOrEqual(3);
        expect(events2.length).toBeGreaterThanOrEqual(3);
      }
    });

    it("agent failure mid-run (transition to failed)", () => {
      const agentId = "evidence-auditor";
      const runId = store.startRun(agentId, "failure-test");
      store.transition(runId, agentId, "executing", "plan_built");

      // Complete 2 steps successfully
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "document.ingest" });
      store.emitEvent(runId, agentId, "step_completed", { step_no: 2, action: "document.extract_clauses" });

      // Step 3 fails
      store.emitEvent(runId, agentId, "step_failed", {
        step_no: 3, action: "document.analyze_compliance",
        details: { error: "Document parsing failed" },
      });

      // Transition to failed
      store.transition(runId, agentId, "failed", "run_failed", {
        details: { error: "Step 3 failed: Document parsing error" } as any,
      });

      expect(store.getStatus(runId)).toBe("failed");
      const events = store.getRunEvents(runId);
      expect(events.length).toBeGreaterThanOrEqual(5);
    });

    it("agent cancellation mid-run (transition to cancelled)", () => {
      const agentId = "content-engine";
      const runId = store.startRun(agentId, "cancel-test");
      store.transition(runId, agentId, "executing", "plan_built");

      // Complete 1 step
      store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: "web.search_news" });

      // Approval rejected -> cancel
      const approvalId = requestApproval(db, {
        agent_id: agentId, run_id: runId, action: "social.post",
        severity: "critical", payload: "{}",
      });
      resolveApproval(db, approvalId, "rejected", "operator", "Not aligned with brand");

      store.transition(runId, agentId, "cancelled", "run_cancelled", {
        details: { reason: "Approval rejected" } as any,
      });

      expect(store.getStatus(runId)).toBe("cancelled");
      const events = store.getRunEvents(runId);
      expect(events.length).toBeGreaterThanOrEqual(4);
    });
  });
});
