/**
 * Stress: Scheduler Saturation
 *
 * Tests DbSchedulerStore under burst load: many simultaneous due schedules,
 * rapid fire-reschedule cycles, and concurrent operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DbSchedulerStore, RunStore } from "@jarvis/runtime";
import { createStressDb, cleanupDb, range } from "./helpers.js";

describe("Scheduler Saturation Stress", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let scheduler: DbSchedulerStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("scheduler"));
    scheduler = new DbSchedulerStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("100 simultaneous due schedules all retrieved and fired", async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();

    // Seed 100 overdue schedules
    for (let i = 0; i < 100; i++) {
      scheduler.seedSchedule({
        job_type: `stress.job_${i}`,
        input: { index: i },
        cron_expression: "*/5 * * * *",
        next_fire_at: pastTime,
        enabled: true,
        label: `Stress schedule ${i}`,
      });
    }

    expect(scheduler.count()).toBe(100);

    // Get all due schedules
    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(100);

    // Fire all concurrently
    const errors: string[] = [];
    await Promise.all(
      due.map(async (schedule) => {
        try {
          scheduler.markFired(schedule.schedule_id);
          const nextFire = new Date(Date.now() + 300_000).toISOString();
          scheduler.updateNextFireAt(schedule.schedule_id, nextFire);
        } catch (e) {
          errors.push(String(e));
        }
      }),
    );

    expect(errors).toHaveLength(0);

    // After firing, none should be due
    const stillDue = scheduler.getDueSchedules(new Date());
    expect(stillDue).toHaveLength(0);
  });

  it("50 concurrent fire-command-claim cycles", async () => {
    const store = new RunStore(db);
    const pastTime = new Date(Date.now() - 60_000).toISOString();

    // Seed 50 schedules
    for (let i = 0; i < 50; i++) {
      scheduler.seedSchedule({
        job_type: `cycle.job_${i}`,
        input: { task: `task-${i}` },
        cron_expression: "0 * * * *",
        next_fire_at: pastTime,
        enabled: true,
      });
    }

    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(50);

    // Simulate daemon cycle: fire schedule -> insert command -> start run
    const errors: string[] = [];
    const runIds: string[] = [];

    await Promise.all(
      due.map(async (schedule, i) => {
        try {
          // 1. Mark schedule as fired
          scheduler.markFired(schedule.schedule_id);

          // 2. Insert agent command
          const commandId = randomUUID();
          db.prepare(`
            INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at)
            VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?)
          `).run(commandId, `agent-${i}`, JSON.stringify(schedule.input), new Date().toISOString());

          // 3. Claim: start run
          const runId = store.startRun(`agent-${i}`, "scheduled", commandId);
          runIds.push(runId);

          // 4. Reschedule
          scheduler.updateNextFireAt(schedule.schedule_id, new Date(Date.now() + 3_600_000).toISOString());
        } catch (e) {
          errors.push(`Schedule ${i}: ${String(e)}`);
        }
      }),
    );

    expect(errors).toHaveLength(0);
    expect(runIds).toHaveLength(50);

    // All runs should be in planning state
    for (const runId of runIds) {
      expect(store.getStatus(runId)).toBe("planning");
    }
  });

  it("200 rapid seed-fire-reschedule sequential cycles", () => {
    const errors: string[] = [];
    const start = performance.now();

    for (let i = 0; i < 200; i++) {
      try {
        // Seed
        const inserted = scheduler.seedSchedule({
          job_type: `rapid.${i}`,
          input: { cycle: i },
          cron_expression: "*/1 * * * *",
          next_fire_at: new Date(Date.now() - 1000).toISOString(),
          enabled: true,
        });
        expect(inserted).toBe(true);

        // Fire
        const due = scheduler.getDueSchedules(new Date());
        const thisSchedule = due.find((s) => s.job_type === `rapid.${i}`);
        if (thisSchedule) {
          scheduler.markFired(thisSchedule.schedule_id);
          scheduler.updateNextFireAt(thisSchedule.schedule_id, new Date(Date.now() + 60_000).toISOString());
        }
      } catch (e) {
        errors.push(`Cycle ${i}: ${String(e)}`);
      }
    }

    const elapsed = performance.now() - start;

    expect(errors).toHaveLength(0);
    expect(scheduler.count()).toBe(200);
    // Should complete in reasonable time
    expect(elapsed).toBeLessThan(10_000);
  });

  it("disabled schedules never appear in getDueSchedules", () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();

    // Seed 50 enabled + 50 disabled
    for (let i = 0; i < 100; i++) {
      scheduler.seedSchedule({
        job_type: `enabled-test.${i}`,
        input: {},
        cron_expression: "0 * * * *",
        next_fire_at: pastTime,
        enabled: i < 50, // First 50 enabled, rest disabled
      });
    }

    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(50);
    for (const s of due) {
      expect(s.enabled).toBe(true);
    }
  });
});
