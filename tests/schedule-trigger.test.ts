import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { DbSchedulerStore, createDbScheduleTrigger, runMigrations } from "@jarvis/runtime";
import { computeNextFireAt } from "@jarvis/scheduler";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}

describe("Db schedule trigger", () => {
  it("advances next_fire_at after a due schedule is marked fired", () => {
    const db = createDb();
    const store = new DbSchedulerStore(db);
    const trigger = createDbScheduleTrigger(store, computeNextFireAt);

    const inserted = store.seedSchedule({
      job_type: "agent.test-agent",
      input: { agent_id: "test-agent" },
      cron_expression: "*/5 * * * *",
      next_fire_at: "2026-04-12T06:00:00.000Z",
      enabled: true,
      scope_group: "agents",
      label: "Test Agent",
    });

    expect(inserted).toBe(true);

    const now = new Date("2026-04-12T06:01:00.000Z");
    const due = trigger.getDueSchedules(now);
    expect(due).toHaveLength(1);

    trigger.markFired(due[0]!.schedule_id, now);

    const updated = store.getSchedule(due[0]!.schedule_id);
    expect(updated?.last_fired_at).toBeTruthy();
    expect(updated?.next_fire_at).toBe("2026-04-12T06:05:00.000Z");

    const dueAfter = trigger.getDueSchedules(new Date("2026-04-12T06:01:30.000Z"));
    expect(dueAfter).toHaveLength(0);

    db.close();
  });
});
