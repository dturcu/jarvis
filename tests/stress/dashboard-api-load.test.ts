/**
 * Stress: Dashboard API Load
 *
 * Tests store-level operations that back dashboard API routes:
 * concurrent reads, command inserts, mixed queries, and memory stability.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RunStore, listApprovals, requestApproval } from "@jarvis/runtime";
import { createStressDb, cleanupDb, createMetrics, reportMetrics, range } from "./helpers.js";

describe("Dashboard API Load Stress", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("dashboard"));
    store = new RunStore(db);

    // Seed 200 runs for read tests
    for (let i = 0; i < 200; i++) {
      const runId = store.startRun(`agent-${i % 14}`, "dashboard", undefined, `Dashboard goal ${i}`);
      if (i % 3 === 0) {
        store.transition(runId, `agent-${i % 14}`, "executing", "plan_built");
        store.transition(runId, `agent-${i % 14}`, "completed", "run_completed");
      }
    }
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("100 concurrent reads (getRecentRuns)", async () => {
    const metrics = createMetrics("100-reads");
    metrics.startTime = performance.now();

    const results = await Promise.all(
      range(100).map(async () => {
        const start = performance.now();
        try {
          const runs = store.getRecentRuns(50);
          metrics.durations.push(performance.now() - start);
          metrics.totalOps++;
          return { count: runs.length, error: null };
        } catch (e) {
          metrics.durations.push(performance.now() - start);
          metrics.errors++;
          return { count: 0, error: String(e) };
        }
      }),
    );

    metrics.endTime = performance.now();
    const report = reportMetrics(metrics);

    expect(report.errors).toBe(0);
    // All reads should return data
    for (const r of results) {
      expect(r.count).toBeGreaterThan(0);
    }
    // P95 read should be fast
    expect(report.p95).toBeLessThan(100);
  });

  it("50 concurrent command inserts (simulates POST /api/agents/:id/run)", async () => {
    const metrics = createMetrics("50-commands");
    metrics.startTime = performance.now();

    const results = await Promise.all(
      range(50).map(async (i) => {
        const start = performance.now();
        try {
          const commandId = randomUUID();
          db.prepare(`
            INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at)
            VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?)
          `).run(commandId, `agent-${i % 14}`, JSON.stringify({ goal: `API goal ${i}` }), new Date().toISOString());

          metrics.durations.push(performance.now() - start);
          metrics.totalOps++;
          return { commandId, error: null };
        } catch (e) {
          metrics.durations.push(performance.now() - start);
          metrics.errors++;
          return { commandId: null, error: String(e) };
        }
      }),
    );

    metrics.endTime = performance.now();
    const report = reportMetrics(metrics);

    expect(report.errors).toBe(0);
    expect(results.filter((r) => r.commandId)).toHaveLength(50);
  });

  it("300 mixed queries (runs + approvals + events)", async () => {
    // Seed some approvals
    for (let i = 0; i < 20; i++) {
      const runId = store.startRun(`approval-agent-${i}`, "stress");
      store.transition(runId, `approval-agent-${i}`, "executing", "plan_built");
      requestApproval(db, {
        agent_id: `approval-agent-${i}`,
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });
    }

    const errors: string[] = [];

    await Promise.all(
      range(300).map(async (i) => {
        try {
          const op = i % 3;
          if (op === 0) {
            // Read runs
            store.getRecentRuns(20);
          } else if (op === 1) {
            // List approvals
            listApprovals(db, "pending");
          } else {
            // Write new run + event
            const agentId = `mixed-${i}`;
            const runId = store.startRun(agentId, "stress");
            store.emitEvent(runId, agentId, "step_started", { step_no: 1 });
          }
        } catch (e) {
          errors.push(`Op ${i}: ${String(e)}`);
        }
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it("memory stability: 1000 sequential operations", () => {
    const baseHeap = process.memoryUsage().heapUsed;
    const errors: string[] = [];

    for (let i = 0; i < 1000; i++) {
      try {
        if (i % 3 === 0) {
          store.getRecentRuns(20);
        } else if (i % 3 === 1) {
          store.startRun(`mem-${i}`, "stress");
        } else {
          listApprovals(db);
        }
      } catch (e) {
        errors.push(String(e));
      }
    }

    const heapGrowth = process.memoryUsage().heapUsed - baseHeap;
    const heapGrowthMB = heapGrowth / (1024 * 1024);

    expect(errors).toHaveLength(0);
    // Heap growth should be under 50MB
    expect(heapGrowthMB).toBeLessThan(50);
  });

  it("concurrent getRun + getRunEvents on same runs", async () => {
    // Pick some seeded runs
    const recentRuns = store.getRecentRuns(20);
    expect(recentRuns.length).toBeGreaterThan(0);

    const errors: string[] = [];

    await Promise.all(
      range(100).map(async (i) => {
        const run = recentRuns[i % recentRuns.length];
        try {
          if (i % 2 === 0) {
            const detail = store.getRun(run.run_id);
            expect(detail).not.toBeNull();
          } else {
            const events = store.getRunEvents(run.run_id);
            expect(Array.isArray(events)).toBe(true);
          }
        } catch (e) {
          errors.push(`Op ${i}: ${String(e)}`);
        }
      }),
    );

    expect(errors).toHaveLength(0);
  });
});
