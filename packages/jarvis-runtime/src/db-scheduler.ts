/**
 * DB-backed schedule store — wraps the `schedules` table in runtime.db.
 *
 * Replaces the in-memory SchedulerStore for schedule operations used by the daemon.
 * Schedules persist across restarts. Built-in agent schedules are seeded on
 * first boot only; subsequent boots read from DB.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ScheduleRecord } from "@jarvis/scheduler";

export class DbSchedulerStore {
  constructor(private db: DatabaseSync) {}

  /**
   * Seed a schedule from an agent definition.
   * Only inserts if no schedule exists for this job_type.
   * Returns true if inserted, false if already existed.
   */
  seedSchedule(
    params: Omit<ScheduleRecord, "schedule_id" | "created_at" | "updated_at">,
  ): boolean {
    const existing = this.db.prepare(
      "SELECT schedule_id FROM schedules WHERE job_type = ? LIMIT 1",
    ).get(params.job_type) as { schedule_id: string } | undefined;

    if (existing) return false;

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO schedules (schedule_id, job_type, input_json, cron_expression, next_fire_at, enabled, scope_group, label, created_at, last_fired_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      params.job_type,
      JSON.stringify(params.input),
      params.cron_expression ?? null,
      params.next_fire_at,
      params.enabled ? 1 : 0,
      params.scope_group ?? null,
      params.label ?? null,
      now,
      params.last_fired_at ?? null,
    );

    return true;
  }

  /** Get all enabled schedules whose next_fire_at has passed. */
  getDueSchedules(now: Date): ScheduleRecord[] {
    const rows = this.db.prepare(`
      SELECT schedule_id, job_type, input_json, cron_expression, next_fire_at,
             enabled, scope_group, label, created_at, last_fired_at
      FROM schedules
      WHERE enabled = 1 AND next_fire_at <= ?
      ORDER BY next_fire_at ASC
    `).all(now.toISOString()) as Array<Record<string, unknown>>;

    return rows.map(r => this.rowToRecord(r));
  }

  /** Mark a schedule as fired (update last_fired_at). */
  markFired(scheduleId: string): void {
    this.db.prepare(
      "UPDATE schedules SET last_fired_at = ? WHERE schedule_id = ?",
    ).run(new Date().toISOString(), scheduleId);
  }

  /** Update the next fire time for a schedule. */
  updateNextFireAt(scheduleId: string, nextFireAt: string): void {
    this.db.prepare(
      "UPDATE schedules SET next_fire_at = ? WHERE schedule_id = ?",
    ).run(nextFireAt, scheduleId);
  }

  /** Count total schedules (for logging). */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM schedules").get() as { n: number };
    return row.n;
  }

  private rowToRecord(row: Record<string, unknown>): ScheduleRecord {
    return {
      schedule_id: row.schedule_id as string,
      job_type: row.job_type as string,
      input: row.input_json ? (JSON.parse(row.input_json as string) as Record<string, unknown>) : {},
      cron_expression: (row.cron_expression as string) ?? undefined,
      next_fire_at: row.next_fire_at as string,
      enabled: row.enabled === 1,
      scope_group: (row.scope_group as string) ?? undefined,
      label: (row.label as string) ?? undefined,
      created_at: row.created_at as string,
      updated_at: row.created_at as string,
      last_fired_at: (row.last_fired_at as string) ?? undefined,
    };
  }
}
