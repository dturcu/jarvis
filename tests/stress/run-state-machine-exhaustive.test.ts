/**
 * Stress: Exhaustive Run State Machine
 *
 * Tests every valid transition path, every invalid transition, event type
 * emission, field completeness, ordering, concurrency, and edge cases
 * across the RunStore state machine.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RunStore, type RunStatus, type RunEventType } from "@jarvis/runtime";
import { createStressDb, cleanupDb, range } from "./helpers.js";

// ── Constants ───────────────────────────────────────────────────────────────

const ALL_STATUSES: RunStatus[] = [
  "queued", "planning", "executing", "awaiting_approval",
  "completed", "failed", "cancelled",
];

const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["planning", "cancelled"],
  planning: ["executing", "failed", "cancelled"],
  executing: ["awaiting_approval", "completed", "failed", "cancelled"],
  awaiting_approval: ["executing", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

const ALL_EVENT_TYPES: RunEventType[] = [
  "run_started", "plan_built", "plan_critique", "plan_multi_viewpoint",
  "step_started", "step_completed", "step_failed",
  "approval_requested", "approval_resolved", "disagreement_resolved",
  "run_completed", "run_failed", "run_cancelled", "daemon_shutdown",
];

// Event types paired with transitions for valid paths
const EVENT_FOR_TRANSITION: Partial<Record<string, RunEventType>> = {
  "planning->executing": "plan_built",
  "planning->failed": "run_failed",
  "planning->cancelled": "run_cancelled",
  "executing->awaiting_approval": "approval_requested",
  "executing->completed": "run_completed",
  "executing->failed": "run_failed",
  "executing->cancelled": "run_cancelled",
  "awaiting_approval->executing": "approval_resolved",
  "awaiting_approval->cancelled": "run_cancelled",
  "awaiting_approval->failed": "run_failed",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Advance a run from planning to the given status via the shortest valid path. */
function advanceTo(store: RunStore, runId: string, agentId: string, target: RunStatus): void {
  // startRun already puts us at "planning"
  if (target === "planning") return;

  if (target === "executing") {
    store.transition(runId, agentId, "executing", "plan_built");
    return;
  }

  if (target === "awaiting_approval") {
    store.transition(runId, agentId, "executing", "plan_built");
    store.transition(runId, agentId, "awaiting_approval", "approval_requested");
    return;
  }

  if (target === "completed") {
    store.transition(runId, agentId, "executing", "plan_built");
    store.transition(runId, agentId, "completed", "run_completed");
    return;
  }

  if (target === "failed") {
    store.transition(runId, agentId, "executing", "plan_built");
    store.transition(runId, agentId, "failed", "run_failed");
    return;
  }

  if (target === "cancelled") {
    store.transition(runId, agentId, "cancelled", "run_cancelled");
    return;
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Run State Machine — Exhaustive", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("run-sm"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  // ── 1. Every valid transition path ──────────────────────────────────────

  describe("valid transition paths", () => {
    const paths: { name: string; steps: Array<{ to: RunStatus; event: RunEventType }> }[] = [
      {
        name: "planning -> executing -> completed",
        steps: [
          { to: "executing", event: "plan_built" },
          { to: "completed", event: "run_completed" },
        ],
      },
      {
        name: "planning -> executing -> failed",
        steps: [
          { to: "executing", event: "plan_built" },
          { to: "failed", event: "run_failed" },
        ],
      },
      {
        name: "planning -> executing -> cancelled",
        steps: [
          { to: "executing", event: "plan_built" },
          { to: "cancelled", event: "run_cancelled" },
        ],
      },
      {
        name: "planning -> executing -> awaiting_approval -> executing -> completed",
        steps: [
          { to: "executing", event: "plan_built" },
          { to: "awaiting_approval", event: "approval_requested" },
          { to: "executing", event: "approval_resolved" },
          { to: "completed", event: "run_completed" },
        ],
      },
      {
        name: "planning -> executing -> awaiting_approval -> cancelled",
        steps: [
          { to: "executing", event: "plan_built" },
          { to: "awaiting_approval", event: "approval_requested" },
          { to: "cancelled", event: "run_cancelled" },
        ],
      },
      {
        name: "planning -> executing -> awaiting_approval -> failed",
        steps: [
          { to: "executing", event: "plan_built" },
          { to: "awaiting_approval", event: "approval_requested" },
          { to: "failed", event: "run_failed" },
        ],
      },
      {
        name: "planning -> failed",
        steps: [
          { to: "failed", event: "run_failed" },
        ],
      },
      {
        name: "planning -> cancelled",
        steps: [
          { to: "cancelled", event: "run_cancelled" },
        ],
      },
    ];

    for (const path of paths) {
      it(`path: ${path.name}`, () => {
        const agentId = "sm-agent";
        const runId = store.startRun(agentId, "test");
        expect(store.getStatus(runId)).toBe("planning");

        for (const step of path.steps) {
          store.transition(runId, agentId, step.to, step.event);
          expect(store.getStatus(runId)).toBe(step.to);
        }

        // Verify events recorded
        const events = store.getRunEvents(runId);
        // run_started + one event per step
        expect(events.length).toBe(1 + path.steps.length);
      });
    }

    it("all 8 valid paths succeed when run in sequence on different runs", () => {
      let successCount = 0;
      for (const path of paths) {
        const agentId = "seq-agent";
        const runId = store.startRun(agentId, "test");
        for (const step of path.steps) {
          store.transition(runId, agentId, step.to, step.event);
        }
        const finalStatus = store.getStatus(runId);
        expect(finalStatus).toBe(path.steps[path.steps.length - 1].to);
        successCount++;
      }
      expect(successCount).toBe(8);
    });
  });

  // ── 2. Every INVALID transition (matrix) ────────────────────────────────

  describe("invalid transition matrix", () => {
    // Terminal states: no outbound transitions allowed
    for (const terminalState of ["completed", "failed", "cancelled"] as RunStatus[]) {
      describe(`from ${terminalState}`, () => {
        for (const targetState of ALL_STATUSES) {
          if (targetState === terminalState) continue; // self-transition tested separately
          it(`${terminalState} -> ${targetState} must throw`, () => {
            const agentId = "invalid-agent";
            const runId = store.startRun(agentId, "test");
            advanceTo(store, runId, agentId, terminalState);
            expect(store.getStatus(runId)).toBe(terminalState);

            expect(() => {
              store.transition(runId, agentId, targetState, "run_started");
            }).toThrow("Invalid run transition");
          });
        }

        it(`${terminalState} -> ${terminalState} (self) must throw`, () => {
          const agentId = "self-trans-agent";
          const runId = store.startRun(agentId, "test");
          advanceTo(store, runId, agentId, terminalState);

          expect(() => {
            store.transition(runId, agentId, terminalState, "run_started");
          }).toThrow("Invalid run transition");
        });
      });
    }

    describe("from planning", () => {
      const invalidFromPlanning: RunStatus[] = ["completed", "awaiting_approval", "queued", "planning"];
      for (const target of invalidFromPlanning) {
        it(`planning -> ${target} must throw`, () => {
          const agentId = "plan-invalid";
          const runId = store.startRun(agentId, "test");
          expect(store.getStatus(runId)).toBe("planning");

          expect(() => {
            store.transition(runId, agentId, target, "run_started");
          }).toThrow("Invalid run transition");
        });
      }
    });

    describe("from executing", () => {
      const invalidFromExecuting: RunStatus[] = ["queued", "planning", "executing"];
      for (const target of invalidFromExecuting) {
        it(`executing -> ${target} must throw`, () => {
          const agentId = "exec-invalid";
          const runId = store.startRun(agentId, "test");
          store.transition(runId, agentId, "executing", "plan_built");
          expect(store.getStatus(runId)).toBe("executing");

          expect(() => {
            store.transition(runId, agentId, target, "run_started");
          }).toThrow("Invalid run transition");
        });
      }
    });

    describe("from awaiting_approval", () => {
      const invalidFromAwaiting: RunStatus[] = ["queued", "planning", "awaiting_approval", "completed"];
      for (const target of invalidFromAwaiting) {
        it(`awaiting_approval -> ${target} must throw`, () => {
          const agentId = "await-invalid";
          const runId = store.startRun(agentId, "test");
          store.transition(runId, agentId, "executing", "plan_built");
          store.transition(runId, agentId, "awaiting_approval", "approval_requested");
          expect(store.getStatus(runId)).toBe("awaiting_approval");

          expect(() => {
            store.transition(runId, agentId, target, "run_started");
          }).toThrow("Invalid run transition");
        });
      }
    });

    it("every source state rejects all non-allowed targets (full matrix)", () => {
      let checkedCount = 0;
      for (const source of ALL_STATUSES) {
        // Skip queued since startRun auto-transitions to planning
        if (source === "queued") continue;
        const allowed = VALID_TRANSITIONS[source];
        const disallowed = ALL_STATUSES.filter((s) => !allowed.includes(s));

        for (const target of disallowed) {
          const agentId = `matrix-${source}-${target}`;
          const runId = store.startRun(agentId, "test");
          advanceTo(store, runId, agentId, source);

          expect(() => {
            store.transition(runId, agentId, target, "run_started");
          }).toThrow("Invalid run transition");
          checkedCount++;
        }
      }
      // We should have checked a significant number of combinations
      expect(checkedCount).toBeGreaterThan(20);
    });
  });

  // ── 3. Every event type emission ────────────────────────────────────────

  describe("event type emission", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      it(`emits and stores "${eventType}" correctly`, () => {
        const agentId = "event-agent";
        const runId = store.startRun(agentId, "test");
        store.transition(runId, agentId, "executing", "plan_built");

        store.emitEvent(runId, agentId, eventType, {
          step_no: 1,
          action: `test.${eventType}`,
          details: { event_type_tested: eventType },
        });

        const events = store.getRunEvents(runId);
        const matching = events.filter((e) => e.event_type === eventType);
        expect(matching.length).toBeGreaterThanOrEqual(1);

        const last = matching[matching.length - 1];
        expect(last.agent_id).toBe(agentId);
        expect(last.run_id).toBe(runId);
        expect(last.step_no).toBe(1);
        expect(last.action).toBe(`test.${eventType}`);
        expect(last.payload_json).not.toBeNull();
        const payload = JSON.parse(last.payload_json!);
        expect(payload.event_type_tested).toBe(eventType);
      });
    }

    it("all 14 event types emitted on same run are retrievable", () => {
      const agentId = "all-events";
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");

      for (const eventType of ALL_EVENT_TYPES) {
        store.emitEvent(runId, agentId, eventType, {
          step_no: 0,
          details: { type: eventType },
        });
      }

      const events = store.getRunEvents(runId);
      // run_started + plan_built + 14 emitted
      expect(events.length).toBe(2 + ALL_EVENT_TYPES.length);

      const emittedTypes = events.map((e) => e.event_type);
      for (const et of ALL_EVENT_TYPES) {
        expect(emittedTypes).toContain(et);
      }
    });
  });

  // ── 4. getStatus for non-existent run ───────────────────────────────────

  describe("getStatus edge cases", () => {
    it("returns null for non-existent run_id", () => {
      expect(store.getStatus(randomUUID())).toBeNull();
    });

    it("returns null for empty string run_id", () => {
      expect(store.getStatus("")).toBeNull();
    });

    it("returns null for gibberish run_id", () => {
      expect(store.getStatus("not-a-valid-uuid-at-all")).toBeNull();
    });
  });

  // ── 5. getRun field completeness ────────────────────────────────────────

  describe("getRun field completeness", () => {
    it("completed run has all required fields", () => {
      const agentId = "field-check";
      const goal = "Test goal for completeness check";
      const runId = store.startRun(agentId, "manual", "cmd-123", goal);
      store.transition(runId, agentId, "executing", "plan_built", { step_no: 1 });
      store.updateRunMeta(runId, { total_steps: 3 });
      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

      const run = store.getRun(runId);
      expect(run).not.toBeNull();
      expect(run!.run_id).toBe(runId);
      expect(run!.agent_id).toBe(agentId);
      expect(run!.status).toBe("completed");
      expect(run!.trigger_kind).toBe("manual");
      expect(run!.command_id).toBe("cmd-123");
      expect(run!.goal).toBe(goal);
      expect(run!.total_steps).toBe(3);
      expect(run!.started_at).toBeTruthy();
      expect(run!.completed_at).toBeTruthy();
      expect(typeof run!.current_step).toBe("number");
    });

    it("planning run has null completed_at", () => {
      const runId = store.startRun("field-agent", "test");
      const run = store.getRun(runId);
      expect(run!.status).toBe("planning");
      expect(run!.completed_at).toBeNull();
    });

    it("getRun returns null for non-existent run", () => {
      expect(store.getRun(randomUUID())).toBeNull();
    });

    it("failed run has error field set when details include error", () => {
      const agentId = "fail-agent";
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "failed", "run_failed", {
        details: { error: "something went wrong" },
      });

      const run = store.getRun(runId);
      expect(run!.status).toBe("failed");
      expect(run!.error).toBe("something went wrong");
      expect(run!.completed_at).toBeTruthy();
    });
  });

  // ── 6. getRunEvents ordering ────────────────────────────────────────────

  describe("getRunEvents ordering", () => {
    it("events are in chronological order after rapid emissions", () => {
      const agentId = "order-agent";
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");

      for (let i = 0; i < 50; i++) {
        store.emitEvent(runId, agentId, "step_completed", {
          step_no: i,
          action: `action.${i}`,
          details: { seq: i },
        });
      }

      const events = store.getRunEvents(runId);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].created_at >= events[i - 1].created_at).toBe(true);
      }
    });

    it("step_no sequence is preserved in payload", () => {
      const agentId = "seq-agent";
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");

      for (let i = 0; i < 20; i++) {
        store.emitEvent(runId, agentId, "step_completed", {
          step_no: i,
          details: { index: i },
        });
      }

      const events = store.getRunEvents(runId).filter((e) => e.event_type === "step_completed");
      expect(events.length).toBe(20);
      for (let i = 0; i < events.length; i++) {
        expect(events[i].step_no).toBe(i);
      }
    });
  });

  // ── 7. getRecentRuns with various limits ────────────────────────────────

  describe("getRecentRuns limits", () => {
    beforeEach(() => {
      // Seed 25 runs
      for (let i = 0; i < 25; i++) {
        store.startRun(`limit-agent-${i}`, "test");
      }
    });

    for (const limit of [0, 1, 5, 20, 100, 1000]) {
      it(`limit ${limit} returns min(${limit}, 25) runs`, () => {
        const runs = store.getRecentRuns(limit);
        expect(runs.length).toBe(Math.min(limit, 25));
      });
    }

    it("default limit (no arg) returns up to 20", () => {
      const runs = store.getRecentRuns();
      expect(runs.length).toBe(20);
    });

    it("returned runs are ordered by started_at DESC", () => {
      const runs = store.getRecentRuns(25);
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i - 1].started_at >= runs[i].started_at).toBe(true);
      }
    });
  });

  // ── 8. getRunByCommandId ────────────────────────────────────────────────

  describe("getRunByCommandId", () => {
    it("finds run by command_id", () => {
      const cmdId = "cmd-" + randomUUID().slice(0, 8);
      const runId = store.startRun("cmd-agent", "manual", cmdId, "Command goal");

      const found = store.getRunByCommandId(cmdId);
      expect(found).not.toBeNull();
      expect(found!.run_id).toBe(runId);
      expect(found!.agent_id).toBe("cmd-agent");
      expect(found!.status).toBe("planning");
    });

    it("returns null for unknown command_id", () => {
      expect(store.getRunByCommandId("nonexistent-cmd")).toBeNull();
    });

    it("returns most recent run when multiple share a command_id", () => {
      const cmdId = "shared-cmd";
      store.startRun("agent-old", "manual", cmdId, "Old run");
      const newerRunId = store.startRun("agent-new", "manual", cmdId, "New run");

      const found = store.getRunByCommandId(cmdId);
      expect(found).not.toBeNull();
      expect(found!.run_id).toBe(newerRunId);
    });
  });

  // ── 9. completeCommand ──────────────────────────────────────────────────

  describe("completeCommand", () => {
    it("updates command status to completed", () => {
      // Insert a command row directly for this test
      const cmdId = "test-cmd-" + randomUUID().slice(0, 8);
      db.prepare(`
        INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, created_at)
        VALUES (?, 'test', 'cmd-agent', '{}', 'queued', ?)
      `).run(cmdId, new Date().toISOString());

      const runId = store.startRun("cmd-agent", "manual", cmdId);
      store.transition(runId, "cmd-agent", "executing", "plan_built");
      store.transition(runId, "cmd-agent", "completed", "run_completed");

      store.completeCommand(runId, "completed");

      const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get(cmdId) as { status: string };
      expect(cmd.status).toBe("completed");
    });

    it("updates command status to failed", () => {
      const cmdId = "fail-cmd-" + randomUUID().slice(0, 8);
      db.prepare(`
        INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, created_at)
        VALUES (?, 'test', 'fail-agent', '{}', 'queued', ?)
      `).run(cmdId, new Date().toISOString());

      const runId = store.startRun("fail-agent", "manual", cmdId);
      store.completeCommand(runId, "failed");

      const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get(cmdId) as { status: string };
      expect(cmd.status).toBe("failed");
    });

    it("updates command status to cancelled", () => {
      const cmdId = "cancel-cmd-" + randomUUID().slice(0, 8);
      db.prepare(`
        INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, created_at)
        VALUES (?, 'test', 'cancel-agent', '{}', 'queued', ?)
      `).run(cmdId, new Date().toISOString());

      const runId = store.startRun("cancel-agent", "manual", cmdId);
      store.completeCommand(runId, "cancelled");

      const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get(cmdId) as { status: string };
      expect(cmd.status).toBe("cancelled");
    });
  });

  // ── 10. updateRunMeta ───────────────────────────────────────────────────

  describe("updateRunMeta", () => {
    it("updates goal", () => {
      const runId = store.startRun("meta-agent", "test");
      store.updateRunMeta(runId, { goal: "Updated goal" });

      const run = store.getRun(runId);
      expect(run!.goal).toBe("Updated goal");
    });

    it("updates total_steps", () => {
      const runId = store.startRun("meta-agent", "test");
      store.updateRunMeta(runId, { total_steps: 42 });

      const run = store.getRun(runId);
      expect(run!.total_steps).toBe(42);
    });

    it("updates both goal and total_steps simultaneously", () => {
      const runId = store.startRun("meta-agent", "test");
      store.updateRunMeta(runId, { goal: "Dual update", total_steps: 7 });

      const run = store.getRun(runId);
      expect(run!.goal).toBe("Dual update");
      expect(run!.total_steps).toBe(7);
    });

    it("preserves existing goal when only updating total_steps", () => {
      const runId = store.startRun("meta-agent", "test", undefined, "Original goal");
      store.updateRunMeta(runId, { total_steps: 5 });

      const run = store.getRun(runId);
      expect(run!.goal).toBe("Original goal");
      expect(run!.total_steps).toBe(5);
    });

    it("overwrites previous goal", () => {
      const runId = store.startRun("meta-agent", "test", undefined, "First");
      store.updateRunMeta(runId, { goal: "Second" });
      store.updateRunMeta(runId, { goal: "Third" });

      const run = store.getRun(runId);
      expect(run!.goal).toBe("Third");
    });
  });

  // ── 11. Concurrent valid transitions on different runs ──────────────────

  describe("concurrent transitions", () => {
    it("50 parallel full lifecycles all complete without errors", async () => {
      const results = await Promise.all(
        range(50).map(async (i) => {
          try {
            const agentId = `par-agent-${i}`;
            const runId = store.startRun(agentId, "stress");
            store.transition(runId, agentId, "executing", "plan_built");
            store.emitEvent(runId, agentId, "step_completed", { step_no: 1 });
            store.transition(runId, agentId, "completed", "run_completed");
            return { runId, status: store.getStatus(runId), error: null };
          } catch (e) {
            return { runId: null, status: null, error: String(e) };
          }
        }),
      );

      const errors = results.filter((r) => r.error !== null);
      expect(errors).toHaveLength(0);

      const completed = results.filter((r) => r.status === "completed");
      expect(completed).toHaveLength(50);

      // All run_ids unique
      const ids = new Set(results.map((r) => r.runId));
      expect(ids.size).toBe(50);
    });

    it("50 parallel runs with mixed terminal states", async () => {
      const results = await Promise.all(
        range(50).map(async (i) => {
          try {
            const agentId = `mixed-${i}`;
            const runId = store.startRun(agentId, "stress");
            store.transition(runId, agentId, "executing", "plan_built");

            const terminal: RunStatus = i % 3 === 0 ? "completed" : i % 3 === 1 ? "failed" : "cancelled";
            const event: RunEventType = terminal === "completed" ? "run_completed" : terminal === "failed" ? "run_failed" : "run_cancelled";
            store.transition(runId, agentId, terminal, event);

            return { status: store.getStatus(runId), error: null };
          } catch (e) {
            return { status: null, error: String(e) };
          }
        }),
      );

      expect(results.filter((r) => r.error !== null)).toHaveLength(0);
      expect(results.filter((r) => r.status === "completed").length).toBeGreaterThan(0);
      expect(results.filter((r) => r.status === "failed").length).toBeGreaterThan(0);
      expect(results.filter((r) => r.status === "cancelled").length).toBeGreaterThan(0);
    });
  });

  // ── 12. Rapid state cycling ─────────────────────────────────────────────

  describe("rapid state cycling", () => {
    it("200 runs through full lifecycle without errors", () => {
      const errors: string[] = [];
      const runIds: string[] = [];

      for (let i = 0; i < 200; i++) {
        try {
          const agentId = `cycle-${i}`;
          const runId = store.startRun(agentId, "stress");
          store.transition(runId, agentId, "executing", "plan_built");
          store.emitEvent(runId, agentId, "step_completed", { step_no: 1 });
          store.transition(runId, agentId, "completed", "run_completed");
          runIds.push(runId);
        } catch (e) {
          errors.push(String(e));
        }
      }

      expect(errors).toHaveLength(0);
      expect(runIds).toHaveLength(200);

      // Spot-check a few
      for (const id of [runIds[0], runIds[99], runIds[199]]) {
        expect(store.getStatus(id)).toBe("completed");
      }
    });

    it("200 runs with approval loop complete correctly", () => {
      const errors: string[] = [];

      for (let i = 0; i < 200; i++) {
        try {
          const agentId = `approval-cycle-${i}`;
          const runId = store.startRun(agentId, "stress");
          store.transition(runId, agentId, "executing", "plan_built");
          store.transition(runId, agentId, "awaiting_approval", "approval_requested");
          store.transition(runId, agentId, "executing", "approval_resolved");
          store.transition(runId, agentId, "completed", "run_completed");
        } catch (e) {
          errors.push(String(e));
        }
      }

      expect(errors).toHaveLength(0);
    });
  });

  // ── 13. Error message content ───────────────────────────────────────────

  describe("error message content", () => {
    it("error includes source and target state names", () => {
      const runId = store.startRun("err-agent", "test");
      store.transition(runId, "err-agent", "executing", "plan_built");
      store.transition(runId, "err-agent", "completed", "run_completed");

      try {
        store.transition(runId, "err-agent", "executing", "plan_built");
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        expect(e.message).toContain("Invalid run transition");
        expect(e.message).toContain("completed");
        expect(e.message).toContain("executing");
        expect(e.message).toContain(runId);
      }
    });

    for (const [from, to] of [
      ["planning", "completed"],
      ["executing", "planning"],
      ["awaiting_approval", "completed"],
    ] as Array<[RunStatus, RunStatus]>) {
      it(`error for ${from} -> ${to} includes both state names`, () => {
        const agentId = "err-content-agent";
        const runId = store.startRun(agentId, "test");
        advanceTo(store, runId, agentId, from);

        try {
          store.transition(runId, agentId, to, "run_started");
          expect.unreachable("Should have thrown");
        } catch (e: any) {
          expect(e.message).toContain(from);
          expect(e.message).toContain(to);
        }
      });
    }
  });

  // ── 14. run_id uniqueness ───────────────────────────────────────────────

  describe("run_id uniqueness", () => {
    it("500 startRun calls produce 500 unique run_ids", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 500; i++) {
        const runId = store.startRun(`unique-${i % 10}`, "stress");
        ids.add(runId);
      }
      expect(ids.size).toBe(500);
    });

    it("concurrent 100 startRun calls produce unique ids", async () => {
      const results = await Promise.all(
        range(100).map(async (i) => {
          return store.startRun(`par-unique-${i}`, "test");
        }),
      );

      const ids = new Set(results);
      expect(ids.size).toBe(100);
    });
  });

  // ── 15. trigger_kind values ─────────────────────────────────────────────

  describe("trigger_kind values", () => {
    for (const kind of ["scheduled", "manual", "webhook", "dashboard"]) {
      it(`stores trigger_kind "${kind}" correctly`, () => {
        const runId = store.startRun("trigger-agent", kind);
        const run = store.getRun(runId);
        expect(run!.trigger_kind).toBe(kind);
      });
    }

    it("trigger_kind is null when omitted", () => {
      const runId = store.startRun("trigger-agent");
      const run = store.getRun(runId);
      expect(run!.trigger_kind).toBeNull();
    });

    it("trigger_kind is null when explicitly undefined", () => {
      const runId = store.startRun("trigger-agent", undefined);
      const run = store.getRun(runId);
      expect(run!.trigger_kind).toBeNull();
    });
  });

  // ── 16. Custom run_id ──────────────────────────────────────────────────

  describe("custom run_id", () => {
    it("startRun uses explicit runId when provided", () => {
      const customId = "custom-" + randomUUID();
      const returned = store.startRun("custom-agent", "test", undefined, "Custom run", customId);
      expect(returned).toBe(customId);
      expect(store.getStatus(customId)).toBe("planning");
    });

    it("custom run_id works through full lifecycle", () => {
      const customId = "lifecycle-" + randomUUID();
      store.startRun("custom-agent", "test", undefined, undefined, customId);
      store.transition(customId, "custom-agent", "executing", "plan_built");
      store.transition(customId, "custom-agent", "completed", "run_completed");
      expect(store.getStatus(customId)).toBe("completed");
    });

    it("duplicate custom run_id throws", () => {
      const customId = "dupe-" + randomUUID();
      store.startRun("agent-a", "test", undefined, undefined, customId);

      expect(() => {
        store.startRun("agent-b", "test", undefined, undefined, customId);
      }).toThrow();
    });
  });

  // ── 17. completed_at and error fields ──────────────────────────────────

  describe("completed_at and error fields", () => {
    it("completed run has completed_at set and error null", () => {
      const runId = store.startRun("term-agent", "test");
      store.transition(runId, "term-agent", "executing", "plan_built");
      store.transition(runId, "term-agent", "completed", "run_completed");

      const run = store.getRun(runId);
      expect(run!.completed_at).toBeTruthy();
      expect(run!.error).toBeNull();
    });

    it("failed run has completed_at and error set", () => {
      const runId = store.startRun("fail-agent", "test");
      store.transition(runId, "fail-agent", "executing", "plan_built");
      store.transition(runId, "fail-agent", "failed", "run_failed", {
        details: { error: "Timeout exceeded" },
      });

      const run = store.getRun(runId);
      expect(run!.completed_at).toBeTruthy();
      expect(run!.error).toBe("Timeout exceeded");
    });

    it("failed run captures reason from details", () => {
      const runId = store.startRun("reason-agent", "test");
      store.transition(runId, "reason-agent", "failed", "run_failed", {
        details: { reason: "Agent crashed" },
      });

      const run = store.getRun(runId);
      expect(run!.error).toBe("Agent crashed");
    });

    it("cancelled run has completed_at set", () => {
      const runId = store.startRun("cancel-agent", "test");
      store.transition(runId, "cancel-agent", "cancelled", "run_cancelled");

      const run = store.getRun(runId);
      expect(run!.completed_at).toBeTruthy();
    });

    it("planning run has null completed_at and null error", () => {
      const runId = store.startRun("active-agent", "test");

      const run = store.getRun(runId);
      expect(run!.completed_at).toBeNull();
      expect(run!.error).toBeNull();
    });

    it("executing run has null completed_at", () => {
      const runId = store.startRun("exec-agent", "test");
      store.transition(runId, "exec-agent", "executing", "plan_built");

      const run = store.getRun(runId);
      expect(run!.completed_at).toBeNull();
    });

    it("awaiting_approval run has null completed_at", () => {
      const runId = store.startRun("await-agent", "test");
      store.transition(runId, "await-agent", "executing", "plan_built");
      store.transition(runId, "await-agent", "awaiting_approval", "approval_requested");

      const run = store.getRun(runId);
      expect(run!.completed_at).toBeNull();
    });
  });

  // ── 18. startRun always begins at planning ─────────────────────────────

  describe("startRun initial state", () => {
    it("startRun returns a run in planning state", () => {
      const runId = store.startRun("init-agent", "test");
      expect(store.getStatus(runId)).toBe("planning");
    });

    it("startRun emits a run_started event", () => {
      const runId = store.startRun("init-agent", "test");
      const events = store.getRunEvents(runId);
      expect(events.length).toBe(1);
      expect(events[0].event_type).toBe("run_started");
    });

    it("startRun records agent_id in run_started event", () => {
      const runId = store.startRun("specific-agent", "webhook");
      const events = store.getRunEvents(runId);
      expect(events[0].agent_id).toBe("specific-agent");
    });
  });

  // ── 19. Payload preservation ───────────────────────────────────────────

  describe("payload preservation", () => {
    it("transition payload is stored in event", () => {
      const agentId = "payload-agent";
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built", {
        step_no: 0,
        action: "planner.build",
        details: { steps: ["a", "b", "c"], confidence: 0.95 },
      });

      const events = store.getRunEvents(runId);
      const planEvent = events.find((e) => e.event_type === "plan_built")!;
      expect(planEvent.step_no).toBe(0);
      expect(planEvent.action).toBe("planner.build");
      const payload = JSON.parse(planEvent.payload_json!);
      expect(payload.steps).toEqual(["a", "b", "c"]);
      expect(payload.confidence).toBe(0.95);
    });

    it("emitEvent with no payload stores nulls", () => {
      const runId = store.startRun("null-payload", "test");
      store.transition(runId, "null-payload", "executing", "plan_built");
      store.emitEvent(runId, "null-payload", "step_started");

      const events = store.getRunEvents(runId);
      const last = events[events.length - 1];
      expect(last.event_type).toBe("step_started");
      expect(last.step_no).toBeNull();
      expect(last.action).toBeNull();
      expect(last.payload_json).toBeNull();
    });
  });

  // ── 20. Edge: many agents on same run store ────────────────────────────

  describe("multi-agent stress", () => {
    it("100 distinct agents create runs on the same store without conflict", () => {
      const runIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        runIds.push(store.startRun(`agent-${i}`, "test"));
      }

      expect(new Set(runIds).size).toBe(100);

      // Each run is independent
      for (let i = 0; i < 100; i++) {
        const run = store.getRun(runIds[i]);
        expect(run!.agent_id).toBe(`agent-${i}`);
        expect(run!.status).toBe("planning");
      }
    });
  });
});
