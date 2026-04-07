/**
 * Stress: Concurrency Matrix
 *
 * Tests concurrent access patterns across multiple components simultaneously:
 * RunStore, DbSchedulerStore, approvals, workers (email, CRM, web, browser),
 * AgentMemoryStore, and MockAgentAdapter — all exercised under parallel load.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RunStore, DbSchedulerStore, requestApproval, resolveApproval, listApprovals } from "@jarvis/runtime";
import { MockEmailAdapter, executeEmailJob } from "@jarvis/email-worker";
import { MockCrmAdapter, executeCrmJob } from "@jarvis/crm-worker";
import { MockWebAdapter, executeWebJob } from "@jarvis/web-worker";
import { MockAgentAdapter } from "@jarvis/agent-worker";
import { AgentMemoryStore } from "@jarvis/agent-framework";
import { createMockBrowserAdapter, executeBrowserJob } from "@jarvis/browser-worker";
import type { JobEnvelope } from "@jarvis/shared";
import { createStressDb, cleanupDb, range } from "./helpers.js";

function envelope(type: string, input: Record<string, unknown>, agentId = "concurrency-test"): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: agentId, run_id: randomUUID() },
  };
}

describe("Concurrency Matrix", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("concurrency-matrix"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  // ── Test 1: 100 concurrent RunStore writes + reads ─────────────────────

  it("100 concurrent RunStore writes + reads on same DB", async () => {
    const errors: string[] = [];

    await Promise.all([
      ...range(50).map(async (i) => {
        try {
          store.startRun(`writer-${i}`, "stress", undefined, `Goal ${i}`);
        } catch (e) { errors.push(`write-${i}: ${String(e)}`); }
      }),
      ...range(50).map(async () => {
        try {
          const runs = store.getRecentRuns(200);
          expect(Array.isArray(runs)).toBe(true);
        } catch (e) { errors.push(`read: ${String(e)}`); }
      }),
    ]);

    expect(errors).toHaveLength(0);
    const final = store.getRecentRuns(200);
    expect(final).toHaveLength(50);
  });

  // ── Test 2: 50 concurrent RunStore + 50 concurrent approvals ───────────

  it("50 concurrent RunStore + 50 concurrent approvals on same DB", async () => {
    // Seed runs for approvals
    const runIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const agentId = `approval-agent-${i}`;
      const runId = store.startRun(agentId, "stress");
      store.transition(runId, agentId, "executing", "plan_built");
      runIds.push(runId);
    }

    const errors: string[] = [];

    await Promise.all([
      // 50 new runs
      ...range(50).map(async (i) => {
        try {
          store.startRun(`concurrent-writer-${i}`, "stress");
        } catch (e) { errors.push(`run-${i}: ${String(e)}`); }
      }),
      // 50 approval request+resolve cycles
      ...range(50).map(async (i) => {
        try {
          const approvalId = requestApproval(db, {
            agent_id: `approval-agent-${i}`,
            run_id: runIds[i],
            action: "email.send",
            severity: "critical",
            payload: JSON.stringify({ to: `user-${i}@test.com` }),
          });
          resolveApproval(db, approvalId, "approved", "stress-test");
        } catch (e) { errors.push(`approval-${i}: ${String(e)}`); }
      }),
    ]);

    expect(errors).toHaveLength(0);
    const totalRuns = store.getRecentRuns(200);
    expect(totalRuns.length).toBe(100); // 50 seeded + 50 concurrent
    expect(listApprovals(db, "approved")).toHaveLength(50);
  });

  // ── Test 3: 50 runs + 50 scheduler fire cycles ────────────────────────

  it("50 runs + 50 scheduler fire cycles on same DB", async () => {
    const scheduler = new DbSchedulerStore(db);
    const pastTime = new Date(Date.now() - 60_000).toISOString();

    // Seed 50 schedules
    for (let i = 0; i < 50; i++) {
      scheduler.seedSchedule({
        job_type: `concurrent.job_${i}`,
        input: { idx: i },
        cron_expression: "*/5 * * * *",
        next_fire_at: pastTime,
        enabled: true,
        label: `Schedule ${i}`,
      });
    }

    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(50);

    const errors: string[] = [];

    await Promise.all([
      // 50 runs
      ...range(50).map(async (i) => {
        try {
          store.startRun(`sched-run-${i}`, "scheduled");
        } catch (e) { errors.push(`run-${i}: ${String(e)}`); }
      }),
      // 50 fire cycles
      ...due.map(async (schedule) => {
        try {
          scheduler.markFired(schedule.schedule_id);
          scheduler.updateNextFireAt(schedule.schedule_id, new Date(Date.now() + 300_000).toISOString());
        } catch (e) { errors.push(`fire-${schedule.schedule_id}: ${String(e)}`); }
      }),
    ]);

    expect(errors).toHaveLength(0);
    expect(store.getRecentRuns(100)).toHaveLength(50);
    expect(scheduler.getDueSchedules(new Date())).toHaveLength(0);
  });

  // ── Test 4: 30 email + 30 CRM + 30 web operations in parallel ────────

  it("30 email + 30 CRM + 30 web operations in parallel", async () => {
    const email = new MockEmailAdapter();
    const crm = new MockCrmAdapter();
    const web = new MockWebAdapter();

    const results = await Promise.all([
      ...range(10).map(() => executeEmailJob(envelope("email.search", { query: "label:UNREAD" }), email)),
      ...range(10).map((i) => executeEmailJob(envelope("email.draft", { to: [`u${i}@test.com`], subject: `S${i}`, body: "B" }), email)),
      ...range(10).map(() => executeEmailJob(envelope("email.list_threads", { max_results: 5 }), email)),
      ...range(10).map(() => executeCrmJob(envelope("crm.list_pipeline", {}), crm)),
      ...range(10).map(() => executeCrmJob(envelope("crm.search", { query: "engineer" }), crm)),
      ...range(10).map(() => executeCrmJob(envelope("crm.digest", {}), crm)),
      ...range(10).map(() => executeWebJob(envelope("web.search_news", { query: "ISO 26262", max_results: 3 }), web)),
      ...range(10).map((i) => executeWebJob(envelope("web.scrape_profile", { url: `https://company-${i}.com`, profile_type: "company" }), web)),
      ...range(10).map(() => executeWebJob(envelope("web.competitive_intel", { company_name: "Bertrandt" }), web)),
    ]);

    expect(results).toHaveLength(90);
    expect(results.every((r) => r.status === "completed")).toBe(true);
  });

  // ── Test 5: 14 agent types started simultaneously ─────────────────────

  it("14 agent types started simultaneously via MockAgentAdapter", async () => {
    const AGENT_IDS = [
      "bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer",
      "staffing-monitor", "content-engine", "portfolio-monitor", "garden-calendar",
      "email-campaign", "social-engagement", "security-monitor", "drive-watcher",
      "invoice-generator", "meeting-transcriber",
    ];

    const adapter = new MockAgentAdapter();
    const errors: string[] = [];

    await Promise.all(
      AGENT_IDS.map(async (agentId) => {
        try {
          const runId = store.startRun(agentId, "concurrent-start");
          store.transition(runId, agentId, "executing", "plan_built");
          store.emitEvent(runId, agentId, "step_completed", { step_no: 1, action: `${agentId}.init` });
          store.transition(runId, agentId, "completed", "run_completed", { step_no: 1 });
        } catch (e) { errors.push(`${agentId}: ${String(e)}`); }
      }),
    );

    expect(errors).toHaveLength(0);
    const allRuns = store.getRecentRuns(20);
    expect(allRuns.filter((r) => r.status === "completed")).toHaveLength(14);
  });

  // ── Test 6: 200 mixed memory operations across 10 agents ──────────────

  it("200 mixed memory operations (short+long+entity+decision) across 10 agents", async () => {
    const memory = new AgentMemoryStore();
    const agents = range(10).map((i) => `mem-agent-${i}`);

    await Promise.all(
      agents.flatMap((agentId) => [
        ...range(5).map(async (i) => memory.addShortTerm(agentId, `run-${i}`, `short-${agentId}-${i}`)),
        ...range(5).map(async (i) => memory.addLongTerm(agentId, `run-${i}`, `long-${agentId}-${i}`)),
        ...range(5).map(async (i) => memory.upsertEntity({
          agent_id: agentId, entity_type: "contact", name: `Entity-${agentId}-${i}`, data: { i },
        })),
        ...range(5).map(async (i) => memory.logDecision({
          agent_id: agentId, run_id: `run-${i}`, step: i,
          action: "test.action", reasoning: "r", outcome: "ok",
        })),
      ]),
    );

    const stats = memory.getStats();
    expect(stats.short_term_count).toBe(50);  // 10 agents * 5
    expect(stats.long_term_count).toBe(50);
    expect(stats.entity_count).toBe(50);
    expect(stats.decision_count).toBe(50);
  });

  // ── Test 7: 50 browser extracts + 50 web searches in parallel ─────────

  it("50 browser extracts + 50 web searches in parallel", async () => {
    const web = new MockWebAdapter();

    const results = await Promise.all([
      ...range(50).map(async (i) => {
        const browser = createMockBrowserAdapter();
        browser.seedPage(`https://page-${i}.com`, `Page ${i}`, `Content ${i}`);
        return executeBrowserJob(
          envelope("browser.extract", { url: `https://page-${i}.com`, format: "text" }),
          browser,
        );
      }),
      ...range(50).map((i) => executeWebJob(
        envelope("web.search_news", { query: `topic-${i}`, max_results: 2 }),
        web,
      )),
    ]);

    expect(results).toHaveLength(100);
    expect(results.every((r) => r.status === "completed")).toBe(true);
  });

  // ── Test 8: 20 full lifecycles ────────────────────────────────────────

  it("20 full lifecycles: startRun → transition → 3 events → approval → resolve → complete", async () => {
    const errors: string[] = [];

    await Promise.all(
      range(20).map(async (i) => {
        try {
          const agentId = `lifecycle-${i}`;
          const runId = store.startRun(agentId, "stress");

          // planning → executing
          store.transition(runId, agentId, "executing", "plan_built", { step_no: 0 });

          // 3 step events
          for (let s = 1; s <= 3; s++) {
            store.emitEvent(runId, agentId, "step_completed", {
              step_no: s, action: `stress.step_${s}`,
            });
          }

          // approval
          const approvalId = requestApproval(db, {
            agent_id: agentId,
            run_id: runId,
            action: "email.send",
            severity: "critical",
            payload: "{}",
          });
          store.emitEvent(runId, agentId, "approval_requested", { step_no: 4, action: "email.send" });

          resolveApproval(db, approvalId, "approved", "stress-bot");
          store.emitEvent(runId, agentId, "approval_resolved", { step_no: 4, action: "email.send" });

          // complete
          store.transition(runId, agentId, "completed", "run_completed", { step_no: 4 });
        } catch (e) { errors.push(`lifecycle-${i}: ${String(e)}`); }
      }),
    );

    expect(errors).toHaveLength(0);
    const runs = store.getRecentRuns(30);
    expect(runs.filter((r) => r.status === "completed")).toHaveLength(20);
    expect(listApprovals(db, "approved")).toHaveLength(20);
  });

  // ── Test 9: Rapid DB read/write interleaving ──────────────────────────

  it("rapid DB read/write interleaving: 100 iterations of write-then-read", () => {
    const errors: string[] = [];

    for (let i = 0; i < 100; i++) {
      try {
        const runId = store.startRun(`interleave-${i}`, "stress");
        const status = store.getStatus(runId);
        expect(status).toBe("planning");
      } catch (e) { errors.push(`iter-${i}: ${String(e)}`); }
    }

    expect(errors).toHaveLength(0);
    expect(store.getRecentRuns(200)).toHaveLength(100);
  });

  // ── Test 10: Memory + RunStore concurrent ─────────────────────────────

  it("memory decisions + RunStore startRun concurrently", async () => {
    const memory = new AgentMemoryStore();
    const errors: string[] = [];

    await Promise.all([
      ...range(50).map(async (i) => {
        try {
          store.startRun(`mem-run-${i}`, "stress");
        } catch (e) { errors.push(`run-${i}: ${String(e)}`); }
      }),
      ...range(50).map(async (i) => {
        try {
          memory.logDecision({
            agent_id: `mem-agent-${i % 5}`, run_id: `mem-run-${i}`, step: i,
            action: "test", reasoning: "concurrent", outcome: "ok",
          });
        } catch (e) { errors.push(`decision-${i}: ${String(e)}`); }
      }),
    ]);

    expect(errors).toHaveLength(0);
    expect(store.getRecentRuns(100)).toHaveLength(50);
    expect(memory.getStats().decision_count).toBe(50);
  });

  // ── Test 11: All worker types at once ─────────────────────────────────

  it("all worker types at once: email + crm + web + browser + social + document + calendar", async () => {
    const { MockDocumentAdapter, executeDocumentJob } = await import("@jarvis/document-worker");
    const { MockCalendarAdapter, executeCalendarJob } = await import("@jarvis/calendar-worker");
    const { MockSocialAdapter, executeSocialJob } = await import("@jarvis/social-worker");

    const email = new MockEmailAdapter();
    const crm = new MockCrmAdapter();
    const web = new MockWebAdapter();
    const browser = createMockBrowserAdapter();
    const social = new MockSocialAdapter();
    const doc = new MockDocumentAdapter();
    const cal = new MockCalendarAdapter();

    browser.seedPage("https://test.com", "Test", "<div>Test</div>");

    const results = await Promise.all([
      executeEmailJob(envelope("email.search", { query: "label:UNREAD" }), email),
      executeCrmJob(envelope("crm.list_pipeline", {}), crm),
      executeWebJob(envelope("web.search_news", { query: "automotive", max_results: 3 }), web),
      executeBrowserJob(envelope("browser.extract", { url: "https://test.com", format: "text" }), browser),
      executeSocialJob(envelope("social.scan_feed", { platform: "linkedin", max_posts: 5 }), social),
      executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-concurrent.pdf" }), doc),
      executeCalendarJob(envelope("calendar.list_events", { start_date: "2026-04-07", end_date: "2026-04-14" }), cal),
    ]);

    expect(results).toHaveLength(7);
    expect(results.every((r) => r.status === "completed")).toBe(true);
  });

  // ── Test 12: DB saturation — 500 startRun calls ───────────────────────

  it("DB saturation: 500 startRun calls, verify all stored", () => {
    const errors: string[] = [];
    const runIds: string[] = [];

    for (let i = 0; i < 500; i++) {
      try {
        runIds.push(store.startRun(`saturation-${i}`, "stress"));
      } catch (e) { errors.push(`sat-${i}: ${String(e)}`); }
    }

    expect(errors).toHaveLength(0);
    expect(runIds).toHaveLength(500);

    const allRuns = store.getRecentRuns(600);
    expect(allRuns).toHaveLength(500);

    // Verify each run has planning status
    for (const runId of runIds.slice(0, 50)) {
      expect(store.getStatus(runId)).toBe("planning");
    }
  });

  // ── Test 13: Scheduler + approval ─────────────────────────────────────

  it("scheduler + approval: seed 50 schedules, fire all, request approvals, resolve all", async () => {
    const scheduler = new DbSchedulerStore(db);
    const pastTime = new Date(Date.now() - 60_000).toISOString();

    // Seed 50 schedules
    for (let i = 0; i < 50; i++) {
      scheduler.seedSchedule({
        job_type: `sched-approval.${i}`,
        input: { idx: i },
        cron_expression: "0 * * * *",
        next_fire_at: pastTime,
        enabled: true,
      });
    }

    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(50);

    const errors: string[] = [];
    const approvalIds: string[] = [];

    // Fire all and create runs + approvals
    await Promise.all(
      due.map(async (schedule, i) => {
        try {
          scheduler.markFired(schedule.schedule_id);
          scheduler.updateNextFireAt(schedule.schedule_id, new Date(Date.now() + 3_600_000).toISOString());

          const agentId = `sched-agent-${i}`;
          const runId = store.startRun(agentId, "scheduled");
          store.transition(runId, agentId, "executing", "plan_built");

          const approvalId = requestApproval(db, {
            agent_id: agentId,
            run_id: runId,
            action: "email.send",
            severity: "critical",
            payload: "{}",
          });
          approvalIds.push(approvalId);
        } catch (e) { errors.push(`sched-${i}: ${String(e)}`); }
      }),
    );

    expect(errors).toHaveLength(0);
    expect(approvalIds).toHaveLength(50);

    // Resolve all approvals
    await Promise.all(
      approvalIds.map(async (approvalId, i) => {
        try {
          resolveApproval(db, approvalId, i % 2 === 0 ? "approved" : "rejected", "stress-bot");
        } catch (e) { errors.push(`resolve-${i}: ${String(e)}`); }
      }),
    );

    expect(errors).toHaveLength(0);
    expect(listApprovals(db, "pending")).toHaveLength(0);
    expect(listApprovals(db, "approved")).toHaveLength(25);
    expect(listApprovals(db, "rejected")).toHaveLength(25);
  });

  // ── Test 14: Peak concurrency — 200 Promise.all across 5 stores ──────

  it("peak concurrency: 200 Promise.all operations across 5 different stores", async () => {
    const scheduler = new DbSchedulerStore(db);
    const memory = new AgentMemoryStore();
    const email = new MockEmailAdapter();
    const crm = new MockCrmAdapter();

    const errors: string[] = [];

    await Promise.all([
      // 40 RunStore operations
      ...range(40).map(async (i) => {
        try { store.startRun(`peak-${i}`, "stress"); }
        catch (e) { errors.push(`run-${i}: ${String(e)}`); }
      }),
      // 40 approval operations
      ...range(40).map(async (i) => {
        try {
          const agentId = `peak-appr-${i}`;
          const runId = store.startRun(agentId, "peak");
          store.transition(runId, agentId, "executing", "plan_built");
          const aid = requestApproval(db, {
            agent_id: agentId, run_id: runId, action: "email.send",
            severity: "critical", payload: "{}",
          });
          resolveApproval(db, aid, "approved", "bot");
        } catch (e) { errors.push(`appr-${i}: ${String(e)}`); }
      }),
      // 40 memory operations
      ...range(40).map(async (i) => {
        try {
          memory.addShortTerm(`peak-mem-${i % 5}`, `run-${i}`, `obs-${i}`);
          memory.logDecision({
            agent_id: `peak-mem-${i % 5}`, run_id: `run-${i}`, step: i,
            action: "test", reasoning: "peak", outcome: "ok",
          });
        } catch (e) { errors.push(`mem-${i}: ${String(e)}`); }
      }),
      // 40 email operations
      ...range(40).map(async () => {
        try {
          await executeEmailJob(envelope("email.search", { query: "test" }), email);
        } catch (e) { errors.push(`email: ${String(e)}`); }
      }),
      // 40 CRM operations
      ...range(40).map(async () => {
        try {
          await executeCrmJob(envelope("crm.list_pipeline", {}), crm);
        } catch (e) { errors.push(`crm: ${String(e)}`); }
      }),
    ]);

    expect(errors).toHaveLength(0);
    expect(memory.getStats().short_term_count).toBe(40);
    expect(memory.getStats().decision_count).toBe(40);
  });

  // ── Test 15: Sequential consistency ───────────────────────────────────

  it("sequential consistency: write 100 runs, read back, verify order", () => {
    const runIds: string[] = [];

    for (let i = 0; i < 100; i++) {
      runIds.push(store.startRun(`seq-${i}`, "stress", undefined, `Goal ${i}`));
    }

    expect(runIds).toHaveLength(100);

    // All unique
    const unique = new Set(runIds);
    expect(unique.size).toBe(100);

    // Read back — getRecentRuns should return them in reverse order (most recent first)
    const allRuns = store.getRecentRuns(100);
    expect(allRuns).toHaveLength(100);

    // The last inserted run should appear first
    expect(allRuns[0].run_id).toBe(runIds[99]);

    // All should be in planning status
    for (const run of allRuns) {
      expect(run.status).toBe("planning");
    }
  });
});
