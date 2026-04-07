/**
 * Stress: Concurrent Agent Execution
 *
 * Tests RunStore under concurrent lifecycle operations and AgentQueue
 * burst behavior with resource locks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RunStore, type RunStatus } from "@jarvis/runtime";
import { createStressDb, cleanupDb, createMetrics, reportMetrics, range } from "./helpers.js";

describe("Concurrent Agent Stress", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("concurrent"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("50 concurrent full lifecycles complete without errors", async () => {
    const metrics = createMetrics("50-lifecycles");
    metrics.startTime = performance.now();

    const results = await Promise.all(
      range(50).map(async (i) => {
        try {
          const agentId = `agent-${i}`;
          const runId = store.startRun(agentId, "stress", undefined, `Goal ${i}`);

          // planning -> executing
          store.transition(runId, agentId, "executing", "plan_built", { step_no: 0 });

          // Emit step events
          for (let s = 1; s <= 3; s++) {
            store.emitEvent(runId, agentId, "step_completed", {
              step_no: s,
              action: `stress.action_${s}`,
              details: { result: "ok" },
            });
          }

          // executing -> completed
          store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });

          return { runId, status: store.getStatus(runId), error: null };
        } catch (e) {
          return { runId: null, status: null, error: String(e) };
        }
      }),
    );

    metrics.endTime = performance.now();

    const errors = results.filter((r) => r.error !== null);
    const completed = results.filter((r) => r.status === "completed");

    expect(errors).toHaveLength(0);
    expect(completed).toHaveLength(50);

    // Verify all run_ids are unique
    const runIds = new Set(results.map((r) => r.runId));
    expect(runIds.size).toBe(50);
  });

  it("100 concurrent startRun calls for the same agent succeed", async () => {
    const metrics = createMetrics("100-same-agent");
    metrics.startTime = performance.now();

    const results = await Promise.all(
      range(100).map(async (i) => {
        try {
          const runId = store.startRun("bd-pipeline", "stress", undefined, `Goal ${i}`);
          metrics.durations.push(1);
          metrics.totalOps++;
          return { runId, error: null };
        } catch (e) {
          metrics.errors++;
          return { runId: null, error: String(e) };
        }
      }),
    );

    metrics.endTime = performance.now();

    const errors = results.filter((r) => r.error !== null);
    expect(errors).toHaveLength(0);

    // All 100 should be in 'planning' status
    const runIds = results.map((r) => r.runId!).filter(Boolean);
    expect(runIds).toHaveLength(100);
    for (const runId of runIds) {
      expect(store.getStatus(runId)).toBe("planning");
    }

    const report = reportMetrics(metrics);
    expect(report.errors).toBe(0);
  });

  it("invalid transitions under concurrency all throw correctly", async () => {
    // Create 20 completed runs
    const runIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const agentId = `agent-${i}`;
      const runId = store.startRun(agentId, "stress");
      store.transition(runId, agentId, "executing", "plan_built");
      store.transition(runId, agentId, "completed", "run_completed");
      runIds.push(runId);
    }

    // Try invalid transition completed -> executing on all 20
    const results = await Promise.all(
      runIds.map(async (runId, i) => {
        try {
          store.transition(runId, `agent-${i}`, "executing", "plan_built");
          return { threw: false };
        } catch (e) {
          return { threw: true, message: String(e) };
        }
      }),
    );

    // All 20 must throw
    expect(results.every((r) => r.threw)).toBe(true);
    for (const r of results) {
      expect(r.message).toContain("Invalid run transition");
    }
  });

  it("rapid getRecentRuns during concurrent writes stays consistent", async () => {
    const writeErrors: string[] = [];
    const readErrors: string[] = [];

    // Fire 50 writes and 50 reads concurrently
    await Promise.all([
      ...range(50).map(async (i) => {
        try {
          store.startRun(`writer-${i}`, "stress");
        } catch (e) {
          writeErrors.push(String(e));
        }
      }),
      ...range(50).map(async () => {
        try {
          const runs = store.getRecentRuns(100);
          // Should always return an array
          expect(Array.isArray(runs)).toBe(true);
        } catch (e) {
          readErrors.push(String(e));
        }
      }),
    ]);

    expect(writeErrors).toHaveLength(0);
    expect(readErrors).toHaveLength(0);

    // Final count should be 50
    const finalRuns = store.getRecentRuns(100);
    expect(finalRuns).toHaveLength(50);
  });

  it("event emission throughput: 500 events in rapid succession", () => {
    const agentId = "throughput-agent";
    const runId = store.startRun(agentId, "stress");
    store.transition(runId, agentId, "executing", "plan_built");

    const start = performance.now();

    for (let i = 0; i < 500; i++) {
      store.emitEvent(runId, agentId, "step_completed", {
        step_no: i,
        action: `action.${i % 10}`,
        details: { iteration: i },
      });
    }

    const elapsed = performance.now() - start;

    const events = store.getRunEvents(runId);
    // 1 run_started + 1 plan_built + 500 step_completed
    expect(events.length).toBe(502);
    // Should complete under 5 seconds even on slow CI
    expect(elapsed).toBeLessThan(5000);
  });
});
