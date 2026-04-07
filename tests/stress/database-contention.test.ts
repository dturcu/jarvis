/**
 * Stress: Database Contention
 *
 * Tests SQLite WAL mode behavior under heavy concurrent read/write
 * load across RunStore, approvals, and audit log.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RunStore, requestApproval, resolveApproval, listApprovals } from "@jarvis/runtime";
import { createStressDb, cleanupDb, createMetrics, reportMetrics, percentile, range } from "./helpers.js";

describe("Database Contention Stress", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("contention"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("200 concurrent write operations complete without errors", async () => {
    const metrics = createMetrics("200-writes");
    metrics.startTime = performance.now();

    const results = await Promise.all(
      range(200).map(async (i) => {
        try {
          const runId = store.startRun(`agent-${i}`, "stress", undefined, `Goal ${i}`);
          metrics.totalOps++;
          return { runId, error: null };
        } catch (e) {
          metrics.errors++;
          return { runId: null, error: String(e) };
        }
      }),
    );

    metrics.endTime = performance.now();
    const report = reportMetrics(metrics);

    expect(report.errors).toBe(0);
    expect(results.filter((r) => r.runId !== null)).toHaveLength(200);
  });

  it("500 mixed 80/20 read/write operations", async () => {
    // Seed 100 runs first
    const seededIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      seededIds.push(store.startRun(`seed-${i}`, "stress"));
    }

    const readMetrics = createMetrics("reads");
    const writeMetrics = createMetrics("writes");
    const overallStart = performance.now();

    const results = await Promise.all(
      range(500).map(async (i) => {
        const isRead = i % 5 !== 0; // 80% reads, 20% writes
        try {
          if (isRead) {
            const runs = store.getRecentRuns(50);
            readMetrics.totalOps++;
            readMetrics.durations.push(performance.now() - overallStart);
            return { type: "read", count: runs.length, error: null };
          } else {
            const runId = store.startRun(`write-${i}`, "stress");
            writeMetrics.totalOps++;
            writeMetrics.durations.push(performance.now() - overallStart);
            return { type: "write", runId, error: null };
          }
        } catch (e) {
          if (isRead) readMetrics.errors++;
          else writeMetrics.errors++;
          return { type: isRead ? "read" : "write", error: String(e) };
        }
      }),
    );

    const errors = results.filter((r) => r.error !== null);
    expect(errors).toHaveLength(0);
    expect(readMetrics.errors).toBe(0);
    expect(writeMetrics.errors).toBe(0);
  });

  it("100 multi-table transaction chains (run + approval + resolve)", async () => {
    const errors: string[] = [];

    await Promise.all(
      range(100).map(async (i) => {
        try {
          // 1. Start run
          const agentId = `chain-${i}`;
          const runId = store.startRun(agentId, "stress");

          // 2. Transition to executing
          store.transition(runId, agentId, "executing", "plan_built");

          // 3. Request approval
          const approvalId = requestApproval(db, {
            agent_id: agentId,
            run_id: runId,
            action: "email.send",
            severity: "critical",
            payload: JSON.stringify({ to: `user-${i}@test.com` }),
          });

          // 4. Resolve approval
          resolveApproval(db, approvalId, "approved", "stress-test", `Chain ${i}`);

          // 5. Complete run
          store.transition(runId, agentId, "completed", "run_completed");
        } catch (e) {
          errors.push(`Chain ${i}: ${String(e)}`);
        }
      }),
    );

    expect(errors).toHaveLength(0);

    // Verify all approvals are resolved
    const pending = listApprovals(db, "pending");
    expect(pending).toHaveLength(0);
    const approved = listApprovals(db, "approved");
    expect(approved).toHaveLength(100);
  });

  it("WAL checkpoint during heavy writes", () => {
    const errors: string[] = [];
    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      try {
        store.startRun(`wal-${i}`, "stress");

        // Checkpoint every 200 writes
        if (i > 0 && i % 200 === 0) {
          db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        }
      } catch (e) {
        errors.push(String(e));
      }
    }

    const elapsed = performance.now() - start;

    expect(errors).toHaveLength(0);
    // All 1000 runs should exist
    const allRuns = store.getRecentRuns(1100);
    expect(allRuns.length).toBe(1000);
    // Should complete in reasonable time
    expect(elapsed).toBeLessThan(10_000);
  });

  it("concurrent approval request and resolve race", async () => {
    // Create 50 runs with approval requests
    const runIds: Array<{ runId: string; agentId: string; approvalId: string }> = [];
    for (let i = 0; i < 50; i++) {
      const agentId = `race-${i}`;
      const runId = store.startRun(agentId, "stress");
      store.transition(runId, agentId, "executing", "plan_built");
      const approvalId = requestApproval(db, {
        agent_id: agentId,
        run_id: runId,
        action: "trade_execute",
        severity: "critical",
        payload: "{}",
      });
      runIds.push({ runId, agentId, approvalId });
    }

    // Resolve all 50 concurrently
    const results = await Promise.all(
      runIds.map(async ({ approvalId }, i) => {
        try {
          const resolved = resolveApproval(
            db, approvalId,
            i % 2 === 0 ? "approved" : "rejected",
            "stress-bot",
          );
          return { resolved, error: null };
        } catch (e) {
          return { resolved: false, error: String(e) };
        }
      }),
    );

    const errors = results.filter((r) => r.error !== null);
    expect(errors).toHaveLength(0);

    // All should have been resolved
    const allResolved = results.every((r) => r.resolved);
    expect(allResolved).toBe(true);
    expect(listApprovals(db, "pending")).toHaveLength(0);
  });
});
