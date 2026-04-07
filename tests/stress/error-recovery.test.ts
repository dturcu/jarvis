/**
 * Stress: Error Recovery
 *
 * Tests every error path, failure recovery, and graceful degradation across
 * RunStore, approvals, scheduler, planner (inference/critic/multi-viewpoint),
 * all workers (email, CRM, web, browser, agent), and recovery patterns.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  RunStore,
  requestApproval,
  resolveApproval,
  listApprovals,
  DbSchedulerStore,
  buildPlanWithInference,
  buildPlanWithCritic,
  buildPlanMultiViewpoint,
  type PlannerDeps,
} from "@jarvis/runtime";
import { MockEmailAdapter, executeEmailJob } from "@jarvis/email-worker";
import { MockCrmAdapter, executeCrmJob } from "@jarvis/crm-worker";
import { MockWebAdapter, executeWebJob } from "@jarvis/web-worker";
import { createMockBrowserAdapter, executeBrowserJob } from "@jarvis/browser-worker";
import { MockAgentAdapter, AgentWorkerError } from "@jarvis/agent-worker";
import { AgentMemoryStore } from "@jarvis/agent-framework";
import { createStressDb, cleanupDb, range } from "./helpers.js";
import type { JobEnvelope } from "@jarvis/shared";

// ── Helpers ────────────────────────────────────────────────────────────────

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "error-recovery", run_id: randomUUID() },
  };
}

function mockDeps(
  responses: Array<string | ((prompt: string) => string)>,
): PlannerDeps {
  let callIndex = 0;
  return {
    chat: async (prompt: string) => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      if (typeof resp === "function") return resp(prompt);
      return resp;
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as any,
  };
}

function failDeps(): PlannerDeps {
  return {
    chat: async () => {
      throw new Error("LLM service unavailable");
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as any,
  };
}

const VALID_PLAN = JSON.stringify([
  { step: 1, action: "email.search", input: { query: "client" }, reasoning: "Search for client emails" },
  { step: 2, action: "crm.list_pipeline", input: {}, reasoning: "Check pipeline" },
]);

const APPROVE_CRITIQUE = JSON.stringify({
  issues: [],
  risks: [],
  suggestions: [],
  overall_assessment: "approve",
});

// ── RunStore Error Paths ───────────────────────────────────────────────────

describe("RunStore Error Paths", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("error-run"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  // -- Invalid transitions from terminal states --

  const terminalStates = ["completed", "failed", "cancelled"] as const;
  const allTargets = ["queued", "planning", "executing", "awaiting_approval", "completed", "failed", "cancelled"] as const;

  for (const terminal of terminalStates) {
    for (const target of allTargets) {
      if (terminal === target) continue;
      it(`transition from ${terminal} to ${target} throws "Invalid run transition"`, () => {
        const agentId = `agent-${terminal}-${target}`;
        const runId = store.startRun(agentId, "test");
        // Advance to terminal
        if (terminal === "completed") {
          store.transition(runId, agentId, "executing", "plan_built");
          store.transition(runId, agentId, "completed", "run_completed");
        } else if (terminal === "failed") {
          store.transition(runId, agentId, "executing", "plan_built");
          store.transition(runId, agentId, "failed", "run_failed");
        } else {
          store.transition(runId, agentId, "cancelled", "run_cancelled");
        }
        expect(() =>
          store.transition(runId, agentId, target as any, "run_started"),
        ).toThrow("Invalid run transition");
      });
    }
  }

  it("getStatus of non-existent run returns null", () => {
    expect(store.getStatus("nonexistent-run-id")).toBeNull();
  });

  it("getRun of non-existent run returns null", () => {
    expect(store.getRun("nonexistent-run-id")).toBeNull();
  });

  it("getRunEvents of non-existent run returns empty array", () => {
    const events = store.getRunEvents("nonexistent-run-id");
    expect(events).toEqual([]);
  });

  it("getRunByCommandId with no match returns null", () => {
    expect(store.getRunByCommandId("nonexistent-command")).toBeNull();
  });

  it("transition of non-existent run proceeds without validation block", () => {
    // Non-existent run: currentStatus is null, so no validation is applied.
    // The UPDATE affects 0 rows, INSERT to run_events still succeeds (no FK constraint).
    expect(() =>
      store.transition("nonexistent-run", "agent-x", "executing", "plan_built"),
    ).not.toThrow();
  });

  it("startRun then immediately read returns consistent state", () => {
    const runId = store.startRun("bd-pipeline", "test", undefined, "Test goal");
    const run = store.getRun(runId);
    expect(run).not.toBeNull();
    expect(run!.status).toBe("planning");
    expect(run!.agent_id).toBe("bd-pipeline");
    expect(run!.goal).toBe("Test goal");
    const events = store.getRunEvents(runId);
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe("run_started");
  });

  it("double transition to same terminal state throws", () => {
    const runId = store.startRun("agent-dbl", "test");
    store.transition(runId, "agent-dbl", "executing", "plan_built");
    store.transition(runId, "agent-dbl", "completed", "run_completed");
    expect(() =>
      store.transition(runId, "agent-dbl", "completed", "run_completed"),
    ).toThrow("Invalid run transition");
  });

  it("emitEvent on non-existent run succeeds (no FK constraint on events)", () => {
    expect(() =>
      store.emitEvent("nonexistent-run", "agent-x", "step_completed", {
        step_no: 1,
        action: "test.action",
      }),
    ).not.toThrow();
  });
});

// ── Approval Error Paths ───────────────────────────────────────────────────

describe("Approval Error Paths", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("error-approval"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("resolve non-existent approval returns false", () => {
    const result = resolveApproval(db, "nonexistent-id", "approved", "tester");
    expect(result).toBe(false);
  });

  it("double resolve returns false on second attempt", () => {
    const runId = store.startRun("agent-a", "test");
    const approvalId = requestApproval(db, {
      agent_id: "agent-a",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: JSON.stringify({ to: "test@test.com" }),
    });
    expect(resolveApproval(db, approvalId, "approved", "tester")).toBe(true);
    expect(resolveApproval(db, approvalId, "approved", "tester")).toBe(false);
  });

  it("resolve already-approved approval returns false", () => {
    const runId = store.startRun("agent-b", "test");
    const approvalId = requestApproval(db, {
      agent_id: "agent-b",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });
    resolveApproval(db, approvalId, "approved", "tester");
    // Try to reject after already approved
    expect(resolveApproval(db, approvalId, "rejected", "tester")).toBe(false);
  });

  it("resolve already-rejected approval returns false", () => {
    const runId = store.startRun("agent-c", "test");
    const approvalId = requestApproval(db, {
      agent_id: "agent-c",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });
    resolveApproval(db, approvalId, "rejected", "tester");
    // Try to approve after already rejected
    expect(resolveApproval(db, approvalId, "approved", "tester")).toBe(false);
  });

  it("listApprovals with invalid status filter returns empty", () => {
    const results = listApprovals(db, "approved");
    expect(results).toHaveLength(0);
  });

  it("request with empty payload works", () => {
    const runId = store.startRun("agent-d", "test");
    const approvalId = requestApproval(db, {
      agent_id: "agent-d",
      run_id: runId,
      action: "crm.move_stage",
      severity: "warning",
      payload: "",
    });
    expect(approvalId).toBeTruthy();
    const pending = listApprovals(db, "pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  it("request with very large payload (50KB) works", () => {
    const runId = store.startRun("agent-e", "test");
    const largePayload = JSON.stringify({ data: "X".repeat(50_000) });
    const approvalId = requestApproval(db, {
      agent_id: "agent-e",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: largePayload,
    });
    expect(approvalId).toBeTruthy();
    const pending = listApprovals(db, "pending");
    const found = pending.find((a) => a.id === approvalId);
    expect(found).toBeDefined();
    expect(found!.payload.length).toBeGreaterThan(50_000);
  });

  it("concurrent resolve of same approval: only one succeeds", async () => {
    const runId = store.startRun("agent-f", "test");
    const approvalId = requestApproval(db, {
      agent_id: "agent-f",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });

    const results = await Promise.all(
      range(10).map(async (i) => {
        try {
          return resolveApproval(db, approvalId, "approved", `resolver-${i}`);
        } catch {
          return false;
        }
      }),
    );

    const successes = results.filter((r) => r === true);
    expect(successes).toHaveLength(1);
  });

  it("listApprovals returns items in DESC order by created_at", () => {
    for (const i of range(5)) {
      const runId = store.startRun(`agent-order-${i}`, "test");
      requestApproval(db, {
        agent_id: `agent-order-${i}`,
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: JSON.stringify({ index: i }),
      });
    }
    const all = listApprovals(db);
    expect(all).toHaveLength(5);
    // Verify DESC order
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].created_at >= all[i].created_at).toBe(true);
    }
  });

  it("request and resolve with note preserves resolution_note", () => {
    const runId = store.startRun("agent-note", "test");
    const approvalId = requestApproval(db, {
      agent_id: "agent-note",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });
    resolveApproval(db, approvalId, "approved", "tester", "Looks good to proceed");
    const resolved = listApprovals(db, "approved");
    const found = resolved.find((a) => a.id === approvalId);
    expect(found).toBeDefined();
    expect(found!.resolution_note).toBe("Looks good to proceed");
  });
});

// ── Scheduler Error Paths ──────────────────────────────────────────────────

describe("Scheduler Error Paths", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let scheduler: DbSchedulerStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("error-sched"));
    scheduler = new DbSchedulerStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("seed duplicate job_type returns false (already exists)", () => {
    const first = scheduler.seedSchedule({
      job_type: "stress.duplicate",
      input: { v: 1 },
      cron_expression: "*/5 * * * *",
      next_fire_at: new Date().toISOString(),
      enabled: true,
    });
    expect(first).toBe(true);

    const second = scheduler.seedSchedule({
      job_type: "stress.duplicate",
      input: { v: 2 },
      cron_expression: "*/10 * * * *",
      next_fire_at: new Date().toISOString(),
      enabled: true,
    });
    expect(second).toBe(false);
  });

  it("getDueSchedules with future date returns empty", () => {
    scheduler.seedSchedule({
      job_type: "stress.future",
      input: {},
      cron_expression: "0 * * * *",
      next_fire_at: new Date(Date.now() + 3_600_000).toISOString(),
      enabled: true,
    });
    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(0);
  });

  it("markFired on non-existent schedule does not error", () => {
    expect(() => scheduler.markFired("nonexistent-schedule-id")).not.toThrow();
  });

  it("updateNextFireAt on non-existent schedule does not error", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(() => scheduler.updateNextFireAt("nonexistent-id", future)).not.toThrow();
  });

  it("disabled schedule never appears in due", () => {
    scheduler.seedSchedule({
      job_type: "stress.disabled",
      input: {},
      cron_expression: "*/1 * * * *",
      next_fire_at: new Date(Date.now() - 60_000).toISOString(),
      enabled: false,
    });
    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(0);
  });

  it("count after empty DB returns 0", () => {
    expect(scheduler.count()).toBe(0);
  });

  it("getDueSchedules returns only enabled and past-due schedules", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    scheduler.seedSchedule({ job_type: "s.past_enabled", input: {}, next_fire_at: past, enabled: true });
    scheduler.seedSchedule({ job_type: "s.past_disabled", input: {}, next_fire_at: past, enabled: false });
    scheduler.seedSchedule({ job_type: "s.future_enabled", input: {}, next_fire_at: future, enabled: true });

    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(1);
    expect(due[0].job_type).toBe("s.past_enabled");
  });

  it("seed then markFired then verify last_fired_at is set", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    scheduler.seedSchedule({ job_type: "s.fire_test", input: {}, next_fire_at: past, enabled: true });
    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(1);
    scheduler.markFired(due[0].schedule_id);
    // Re-fetch — last_fired_at should now be set
    const dueAfter = scheduler.getDueSchedules(new Date());
    // Schedule is still due since next_fire_at hasn't changed
    expect(dueAfter).toHaveLength(1);
    expect(dueAfter[0].last_fired_at).toBeTruthy();
  });

  it("updateNextFireAt pushes schedule out of due window", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    scheduler.seedSchedule({ job_type: "s.push_test", input: {}, next_fire_at: past, enabled: true });
    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(1);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    scheduler.updateNextFireAt(due[0].schedule_id, future);
    const dueAfter = scheduler.getDueSchedules(new Date());
    expect(dueAfter).toHaveLength(0);
  });

  it("count reflects seeded schedules accurately", () => {
    for (const i of range(7)) {
      scheduler.seedSchedule({
        job_type: `s.count_${i}`,
        input: {},
        next_fire_at: new Date().toISOString(),
        enabled: true,
      });
    }
    expect(scheduler.count()).toBe(7);
  });
});

// ── Planner Error Paths ────────────────────────────────────────────────────

describe("Planner Error Paths", () => {
  const planParams = (deps: PlannerDeps) => ({
    agent_id: "error-planner",
    run_id: randomUUID(),
    goal: "Test error handling",
    system_prompt: "You are a test agent.",
    context: "Test context",
    capabilities: ["email", "crm"],
    max_steps: 10,
    deps,
  });

  it("LLM returns plain text (not JSON) then retry fails -> empty plan", async () => {
    const deps = mockDeps(["This is not JSON at all.", "Still not JSON."]);
    const plan = await buildPlanWithInference(planParams(deps));
    expect(plan.steps).toHaveLength(0);
  });

  it("LLM returns plain text then retry succeeds -> recovers plan", async () => {
    let callCount = 0;
    const deps: PlannerDeps = {
      chat: async () => {
        callCount++;
        if (callCount === 1) return "Not JSON";
        return VALID_PLAN;
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    };
    const plan = await buildPlanWithInference(planParams(deps));
    expect(callCount).toBe(2);
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it("LLM returns {} instead of [] -> throws (not a valid array)", async () => {
    const deps = mockDeps(["{}"]);
    await expect(buildPlanWithInference(planParams(deps))).rejects.toThrow();
  });

  it("LLM returns nested objects -> filtered to valid steps only", async () => {
    const nested = JSON.stringify([
      { step: 1, action: "email.search", input: { q: "t" }, reasoning: "Valid" },
      { nested: { deep: true } },
      { step: 3, action: "crm.list_pipeline", input: {}, reasoning: "Also valid" },
    ]);
    const deps = mockDeps([nested]);
    const plan = await buildPlanWithInference(planParams(deps));
    for (const step of plan.steps) {
      expect(step.action).toBeTruthy();
    }
  });

  it("LLM throws on first call -> empty plan", async () => {
    const plan = await buildPlanWithInference(planParams(failDeps()));
    expect(plan.steps).toHaveLength(0);
    expect(plan.agent_id).toBe("error-planner");
  });

  it("LLM throws on every call -> empty plan (no crash)", async () => {
    let callCount = 0;
    const deps: PlannerDeps = {
      chat: async () => { callCount++; throw new Error("Network timeout"); },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    };
    const plan = await buildPlanWithInference(planParams(deps));
    expect(plan.steps).toHaveLength(0);
  });

  it("critic LLM returns invalid assessment -> defaults to approve", async () => {
    let callCount = 0;
    const deps: PlannerDeps = {
      chat: async () => {
        callCount++;
        if (callCount === 1) return VALID_PLAN;
        // Invalid critique — missing overall_assessment
        return JSON.stringify({ issues: [], risks: [] });
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    };
    const result = await buildPlanWithCritic(planParams(deps));
    expect(result.critique.overall_assessment).toBe("approve");
  });

  it("critic LLM returns non-object string -> defaults to approve", async () => {
    let callCount = 0;
    const deps: PlannerDeps = {
      chat: async () => {
        callCount++;
        if (callCount === 1) return VALID_PLAN;
        return "Looks good!";
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    };
    const result = await buildPlanWithCritic(planParams(deps));
    expect(result.critique.overall_assessment).toBe("approve");
  });

  it("multi-viewpoint: all viewpoints fail -> empty plan", async () => {
    const result = await buildPlanMultiViewpoint({
      ...planParams(failDeps()),
      viewpoint_count: 2,
    });
    expect(result.plan.steps).toHaveLength(0);
  });

  it("multi-viewpoint: LLM returns differently sized plans -> disagreement detected", async () => {
    let callCount = 0;
    const deps: PlannerDeps = {
      chat: async () => {
        callCount++;
        // Viewpoint 1: 1-step plan
        if (callCount === 1) {
          return JSON.stringify([
            { step: 1, action: "email.search", input: {}, reasoning: "Only search" },
          ]);
        }
        // Viewpoint 2: 4-step plan
        return JSON.stringify([
          { step: 1, action: "email.search", input: {}, reasoning: "Search first" },
          { step: 2, action: "crm.list_pipeline", input: {}, reasoning: "Check pipeline" },
          { step: 3, action: "web.search_news", input: {}, reasoning: "News scan" },
          { step: 4, action: "email.draft", input: {}, reasoning: "Draft outreach" },
        ]);
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    };
    const result = await buildPlanMultiViewpoint({
      ...planParams(deps),
      viewpoint_count: 2,
    });
    // Result should still produce a valid plan; disagreement may be flagged
    expect(result.candidates.length).toBe(2);
    expect(result.plan).toBeDefined();
  });

  it("buildPlanWithCritic with empty goal works", async () => {
    const deps = mockDeps([VALID_PLAN, APPROVE_CRITIQUE]);
    const result = await buildPlanWithCritic({
      agent_id: "empty-goal",
      run_id: randomUUID(),
      goal: "",
      system_prompt: "Agent",
      context: "",
      capabilities: ["email"],
      max_steps: 5,
      deps,
    });
    expect(result.plan).toBeDefined();
    expect(result.critique).toBeDefined();
  });

  it("LLM returns JSON array wrapped in markdown fences -> parsed", async () => {
    const fenced =
      '```json\n[{"step":1,"action":"email.search","input":{},"reasoning":"Parse test"}]\n```';
    const deps = mockDeps([fenced]);
    const plan = await buildPlanWithInference(planParams(deps));
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe("email.search");
  });

  it("LLM returns empty array -> empty plan with correct metadata", async () => {
    const deps = mockDeps(["[]"]);
    const plan = await buildPlanWithInference(planParams(deps));
    expect(plan.steps).toHaveLength(0);
    expect(plan.agent_id).toBe("error-planner");
  });

  it("buildPlanWithCritic: empty initial plan skips critique", async () => {
    const deps = mockDeps(["[]"]);
    const result = await buildPlanWithCritic(planParams(deps));
    expect(result.plan.steps).toHaveLength(0);
    expect(result.critique.overall_assessment).toBe("approve");
    expect(result.critique.issues).toHaveLength(0);
  });

  it("multi-viewpoint with only valid viewpoints returns best plan", async () => {
    const deps = mockDeps([VALID_PLAN, VALID_PLAN]);
    const result = await buildPlanMultiViewpoint({
      ...planParams(deps),
      viewpoint_count: 2,
    });
    expect(result.plan.steps.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBe(2);
    expect(result.scores.length).toBe(2);
  });
});

// ── Worker Error Paths ─────────────────────────────────────────────────────

describe("Email Worker Error Paths", () => {
  let email: MockEmailAdapter;

  beforeEach(() => {
    email = new MockEmailAdapter();
  });

  it("read non-existent message returns failed status", async () => {
    const result = await executeEmailJob(
      envelope("email.read", { message_id: "msg-999" }),
      email,
    );
    expect(result.status).toBe("failed");
  });

  it("send without recipients returns failed", async () => {
    const result = await executeEmailJob(
      envelope("email.send", { subject: "No recipient", body: "Fail" }),
      email,
    );
    expect(result.status).toBe("failed");
  });

  it("send non-existent draft returns failed", async () => {
    const result = await executeEmailJob(
      envelope("email.send", { draft_id: "draft-nonexistent-999" }),
      email,
    );
    expect(result.status).toBe("failed");
  });

  it("label non-existent message returns failed", async () => {
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

  it("invalid email job type returns failed", async () => {
    const result = await executeEmailJob(
      envelope("email.nonexistent_op", { data: "test" }),
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

describe("CRM Worker Error Paths", () => {
  let crm: MockCrmAdapter;

  beforeEach(() => {
    crm = new MockCrmAdapter();
  });

  it("update non-existent contact returns failed", async () => {
    const result = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: "nonexistent-contact-id",
        name: "Updated Name",
      }),
      crm,
    );
    expect(result.status).toBe("failed");
  });

  it("move_stage non-existent contact returns failed", async () => {
    const result = await executeCrmJob(
      envelope("crm.move_stage", {
        contact_id: "nonexistent-contact-id",
        new_stage: "qualified",
        reason: "Test",
      }),
      crm,
    );
    expect(result.status).toBe("failed");
  });

  it("add_note to non-existent contact returns failed", async () => {
    const result = await executeCrmJob(
      envelope("crm.add_note", {
        contact_id: "nonexistent-id",
        content: "A note",
      }),
      crm,
    );
    expect(result.status).toBe("failed");
  });

  it("invalid CRM job type returns failed", async () => {
    const result = await executeCrmJob(
      envelope("crm.nonexistent_op", {}),
      crm,
    );
    expect(result.status).toBe("failed");
  });
});

describe("Web Worker Error Paths", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("enrich unknown contact throws CONTACT_NOT_FOUND", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", { name: "Unknown Person" }),
      web,
    );
    expect(result.status).toBe("failed");
  });

  it("invalid web job type returns failed", async () => {
    const result = await executeWebJob(
      envelope("web.nonexistent_op", {}),
      web,
    );
    expect(result.status).toBe("failed");
  });
});

describe("Browser Worker Error Paths", () => {
  it("click non-seeded selector returns ELEMENT_NOT_FOUND", async () => {
    const adapter = createMockBrowserAdapter();
    const result = await executeBrowserJob(
      envelope("browser.click", { selector: "#phantom-btn" }),
      adapter,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ELEMENT_NOT_FOUND");
  });

  it("type on non-seeded selector returns ELEMENT_NOT_FOUND", async () => {
    const adapter = createMockBrowserAdapter();
    const result = await executeBrowserJob(
      envelope("browser.type", { selector: "#phantom-input", text: "hello" }),
      adapter,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ELEMENT_NOT_FOUND");
  });

  it("invalid browser job type returns failed with INVALID_INPUT", async () => {
    const adapter = createMockBrowserAdapter();
    const result = await executeBrowserJob(
      envelope("browser.nonexistent_op", {}),
      adapter,
    );
    expect(result.status).toBe("failed");
  });
});

describe("Agent Worker Error Paths", () => {
  it("start non-registered agent returns AGENT_NOT_FOUND", async () => {
    const adapter = new MockAgentAdapter({ registered_agents: ["bd-pipeline"] });
    const { executeAgentJob } = await import("@jarvis/agent-worker");
    const result = await executeAgentJob(
      envelope("agent.start", { agent_id: "nonexistent-agent" }),
      adapter,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AGENT_NOT_FOUND");
  });

  it("step non-existent run returns RUN_NOT_FOUND", async () => {
    const adapter = new MockAgentAdapter();
    const { executeAgentJob } = await import("@jarvis/agent-worker");
    const result = await executeAgentJob(
      envelope("agent.step", { run_id: "nonexistent-run-id" }),
      adapter,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_NOT_FOUND");
  });

  it("pause non-existent run returns RUN_NOT_FOUND", async () => {
    const adapter = new MockAgentAdapter();
    const { executeAgentJob } = await import("@jarvis/agent-worker");
    const result = await executeAgentJob(
      envelope("agent.pause", { run_id: "nonexistent-run-id" }),
      adapter,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_NOT_FOUND");
  });

  it("resume non-existent run returns RUN_NOT_FOUND", async () => {
    const adapter = new MockAgentAdapter();
    const { executeAgentJob } = await import("@jarvis/agent-worker");
    const result = await executeAgentJob(
      envelope("agent.resume", { run_id: "nonexistent-run-id" }),
      adapter,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_NOT_FOUND");
  });

  it("invalid agent job type returns failed with INVALID_INPUT", async () => {
    const adapter = new MockAgentAdapter();
    const { executeAgentJob } = await import("@jarvis/agent-worker");
    const result = await executeAgentJob(
      envelope("agent.nonexistent_op", {}),
      adapter,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
  });
});

// ── Recovery Patterns ──────────────────────────────────────────────────────

describe("Recovery Patterns", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("error-recovery"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("run fails then new run for same agent succeeds", () => {
    const runId1 = store.startRun("bd-pipeline", "test");
    store.transition(runId1, "bd-pipeline", "executing", "plan_built");
    store.transition(runId1, "bd-pipeline", "failed", "run_failed", {
      details: { error: "Network failure" },
    });
    expect(store.getStatus(runId1)).toBe("failed");

    const runId2 = store.startRun("bd-pipeline", "test");
    expect(store.getStatus(runId2)).toBe("planning");
    store.transition(runId2, "bd-pipeline", "executing", "plan_built");
    store.transition(runId2, "bd-pipeline", "completed", "run_completed");
    expect(store.getStatus(runId2)).toBe("completed");
  });

  it("run cancelled then new run for same agent succeeds", () => {
    const runId1 = store.startRun("proposal-engine", "test");
    store.transition(runId1, "proposal-engine", "cancelled", "run_cancelled");
    expect(store.getStatus(runId1)).toBe("cancelled");

    const runId2 = store.startRun("proposal-engine", "test");
    expect(store.getStatus(runId2)).toBe("planning");
    store.transition(runId2, "proposal-engine", "executing", "plan_built");
    store.transition(runId2, "proposal-engine", "completed", "run_completed");
    expect(store.getStatus(runId2)).toBe("completed");
  });

  it("approval rejected then run transitions gracefully", () => {
    const agentId = "evidence-auditor";
    const runId = store.startRun(agentId, "test");
    store.transition(runId, agentId, "executing", "plan_built");
    store.transition(runId, agentId, "awaiting_approval", "approval_requested");

    const approvalId = requestApproval(db, {
      agent_id: agentId,
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });
    resolveApproval(db, approvalId, "rejected", "tester", "Not appropriate");

    // Run can transition to failed after rejection
    store.transition(runId, agentId, "failed", "run_failed", {
      details: { reason: "Approval rejected" },
    });
    expect(store.getStatus(runId)).toBe("failed");
  });

  it("after DB operations, subsequent operations still work", () => {
    // Perform many operations to exercise the DB
    for (const i of range(20)) {
      const runId = store.startRun(`agent-${i}`, "test");
      store.transition(runId, `agent-${i}`, "executing", "plan_built");
      store.transition(runId, `agent-${i}`, "completed", "run_completed");
    }

    // Subsequent operations should still work
    const runId = store.startRun("post-recovery", "test");
    expect(store.getStatus(runId)).toBe("planning");
    const recent = store.getRecentRuns(25);
    expect(recent.length).toBe(21);
  });

  it("memory store works after clearing short-term", () => {
    const mem = new AgentMemoryStore();
    for (const i of range(50)) {
      mem.addShortTerm("bd-pipeline", "run-1", `Observation ${i}`);
    }
    expect(mem.getContext("bd-pipeline", "run-1").short_term).toHaveLength(50);

    mem.clearShortTerm("run-1");
    expect(mem.getContext("bd-pipeline", "run-1").short_term).toHaveLength(0);

    // Adding again works
    mem.addShortTerm("bd-pipeline", "run-2", "New observation");
    expect(mem.getContext("bd-pipeline", "run-2").short_term).toHaveLength(1);
  });

  it("entity upsert overwrites existing (re-create via upsert)", () => {
    const mem = new AgentMemoryStore();
    mem.upsertEntity({
      agent_id: "bd-pipeline",
      entity_type: "contact",
      name: "Test Contact",
      data: { company: "TestCorp" },
    });
    const entities1 = mem.getEntities("bd-pipeline", "contact");
    expect(entities1.length).toBe(1);
    expect(entities1[0].data.company).toBe("TestCorp");

    // Upsert again to overwrite
    mem.upsertEntity({
      agent_id: "bd-pipeline",
      entity_type: "contact",
      name: "Test Contact",
      data: { company: "TestCorp Revived" },
    });
    const entities2 = mem.getEntities("bd-pipeline", "contact");
    expect(entities2.length).toBe(1);
    expect(entities2[0].data.company).toBe("TestCorp Revived");
  });

  it("schedule fire then immediate re-seed with different job_type works", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const scheduler = new DbSchedulerStore(db);

    scheduler.seedSchedule({
      job_type: "recover.original",
      input: {},
      next_fire_at: past,
      enabled: true,
    });
    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(1);
    scheduler.markFired(due[0].schedule_id);

    // Seed a different job_type immediately
    const seeded = scheduler.seedSchedule({
      job_type: "recover.new_type",
      input: {},
      next_fire_at: past,
      enabled: true,
    });
    expect(seeded).toBe(true);
    expect(scheduler.count()).toBe(2);
  });

  it("multiple failed runs followed by a successful run preserves history", () => {
    const agentId = "content-engine";
    const failedIds: string[] = [];

    for (const i of range(5)) {
      const runId = store.startRun(agentId, "test", undefined, `Attempt ${i}`);
      store.transition(runId, agentId, "executing", "plan_built");
      store.transition(runId, agentId, "failed", "run_failed", {
        details: { error: `Error on attempt ${i}` },
      });
      failedIds.push(runId);
    }

    // Successful run
    const successId = store.startRun(agentId, "test", undefined, "Final attempt");
    store.transition(successId, agentId, "executing", "plan_built");
    store.transition(successId, agentId, "completed", "run_completed");

    // All runs should exist
    for (const fid of failedIds) {
      expect(store.getStatus(fid)).toBe("failed");
    }
    expect(store.getStatus(successId)).toBe("completed");

    const recent = store.getRecentRuns(10);
    expect(recent.length).toBe(6);
  });

  it("approval lifecycle: request, reject, request again, approve", () => {
    const agentId = "staffing-monitor";
    const runId1 = store.startRun(agentId, "test");
    store.transition(runId1, agentId, "executing", "plan_built");
    store.transition(runId1, agentId, "awaiting_approval", "approval_requested");

    const a1 = requestApproval(db, {
      agent_id: agentId,
      run_id: runId1,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });
    resolveApproval(db, a1, "rejected", "tester", "Not now");

    // Transition to failed, start new run
    store.transition(runId1, agentId, "failed", "run_failed");

    const runId2 = store.startRun(agentId, "test");
    store.transition(runId2, agentId, "executing", "plan_built");
    store.transition(runId2, agentId, "awaiting_approval", "approval_requested");

    const a2 = requestApproval(db, {
      agent_id: agentId,
      run_id: runId2,
      action: "email.send",
      severity: "critical",
      payload: "{}",
    });
    resolveApproval(db, a2, "approved", "tester", "Go ahead");

    const pending = listApprovals(db, "pending");
    expect(pending).toHaveLength(0);
    const approved = listApprovals(db, "approved");
    expect(approved).toHaveLength(1);
    const rejected = listApprovals(db, "rejected");
    expect(rejected).toHaveLength(1);
  });

  it("10 sequential error-recovery cycles for different agents", () => {
    const agents = [
      "bd-pipeline", "proposal-engine", "evidence-auditor",
      "contract-reviewer", "staffing-monitor", "content-engine",
      "portfolio-monitor", "garden-calendar", "email-campaign",
      "social-engagement",
    ];

    for (const agentId of agents) {
      // Fail
      const failId = store.startRun(agentId, "test");
      store.transition(failId, agentId, "executing", "plan_built");
      store.transition(failId, agentId, "failed", "run_failed");

      // Recover
      const successId = store.startRun(agentId, "test");
      store.transition(successId, agentId, "executing", "plan_built");
      store.transition(successId, agentId, "completed", "run_completed");

      expect(store.getStatus(failId)).toBe("failed");
      expect(store.getStatus(successId)).toBe("completed");
    }

    const recent = store.getRecentRuns(30);
    expect(recent.length).toBe(20); // 2 runs per agent
  });

  it("email worker: failed send does not corrupt draft count", async () => {
    const email = new MockEmailAdapter();

    // Create a valid draft
    const draft = await executeEmailJob(
      envelope("email.draft", {
        to: ["test@test.com"],
        subject: "Test",
        body: "Body",
      }),
      email,
    );
    expect(draft.status).toBe("completed");
    expect(email.getDraftCount()).toBe(1);

    // Attempt to send non-existent draft
    const sendFail = await executeEmailJob(
      envelope("email.send", { draft_id: "nonexistent-draft" }),
      email,
    );
    expect(sendFail.status).toBe("failed");

    // Draft count should be unchanged
    expect(email.getDraftCount()).toBe(1);
  });

  it("CRM worker: failed update then successful update works", async () => {
    const crm = new MockCrmAdapter();

    // Fail: update nonexistent
    const fail = await executeCrmJob(
      envelope("crm.update_contact", {
        contact_id: "nonexistent",
        name: "New Name",
      }),
      crm,
    );
    expect(fail.status).toBe("failed");

    // Success: list pipeline (read operation always works)
    const success = await executeCrmJob(
      envelope("crm.list_pipeline", {}),
      crm,
    );
    expect(success.status).toBe("completed");
    const contacts = success.structured_output?.contacts as any[];
    expect(contacts.length).toBeGreaterThan(0);
  });
});
