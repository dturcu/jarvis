/**
 * Schedule trigger abstraction — decouples the daemon's polling loop
 * from the concrete schedule storage backend.
 *
 * Two built-in implementations:
 *
 *  1. **DbScheduleTrigger** — wraps DbSchedulerStore, used when the daemon
 *     itself is responsible for evaluating cron expressions and firing agents.
 *
 *  2. **ExternalTriggerSource** — a no-op source for when an external system
 *     (e.g. OpenClaw TaskFlow) owns the schedule evaluation and pushes
 *     agent runs directly via `enqueueAgent()`.  `getDueSchedules()` always
 *     returns an empty list because the external system handles timing.
 *
 * Select the active source via `JARVIS_SCHEDULE_SOURCE` env var:
 *   - `db`       — DbScheduleTrigger (default)
 *   - `external` — ExternalTriggerSource
 */

import type { DbSchedulerStore } from "./db-scheduler.js";
import type { ScheduleRecord } from "@jarvis/scheduler";

// ─── Public types ────────────────────────────────────────────────────────────

/** Minimal schedule payload returned by a trigger source. */
export type DueSchedule = {
  schedule_id: string;
  agent_id: string;
  cron_expression: string;
  label?: string;
};

/** Interface for schedule trigger sources. */
export interface ScheduleTriggerSource {
  /** The kind of source for logging / diagnostics. */
  readonly kind: "db" | "external";

  /** Get schedules that are due to fire now. */
  getDueSchedules(now: Date): DueSchedule[];

  /**
   * Mark a schedule as fired and compute next fire time.
   * No-op for external sources (the external system manages timing).
   */
  markFired(scheduleId: string, now: Date): void;
}

// ─── DbScheduleTrigger ──────────────────────────────────────────────────────

/**
 * Adapter wrapping DbSchedulerStore as a ScheduleTriggerSource.
 *
 * Translates ScheduleRecord rows into the leaner DueSchedule shape and
 * delegates markFired + next-fire-at computation to the underlying store.
 */
export function createDbScheduleTrigger(
  store: DbSchedulerStore,
  computeNextFireAt: (schedule: ScheduleRecord, now: Date) => string,
): ScheduleTriggerSource {
  return {
    kind: "db",

    getDueSchedules(now: Date): DueSchedule[] {
      const records = store.getDueSchedules(now);
      return records.map((r) => ({
        schedule_id: r.schedule_id,
        agent_id: (r.input as { agent_id: string }).agent_id,
        cron_expression: r.cron_expression!,
        label: r.label,
      }));
    },

    markFired(scheduleId: string, now: Date): void {
      store.markFired(scheduleId);

      // Recompute next fire time from the raw ScheduleRecord.
      // getDueSchedules already filtered to enabled + past-due, so we
      // reconstruct a minimal ScheduleRecord for the computation helper.
      // The store's own getDueSchedules won't return it again until the
      // new next_fire_at is reached.
      const dueRecords = store.getDueSchedules(new Date(0)); // all enabled
      const record = dueRecords.find((r) => r.schedule_id === scheduleId);
      if (record) {
        const nextFire = computeNextFireAt(record, now);
        store.updateNextFireAt(scheduleId, nextFire);
      }
    },
  };
}

// ─── ExternalTriggerSource ──────────────────────────────────────────────────

/**
 * Adapter for OpenClaw TaskFlow triggers.
 *
 * When OpenClaw fires a schedule, it calls enqueueAgent() directly on the
 * agent queue — the daemon never needs to poll for due schedules.
 * This source always returns empty from getDueSchedules() because OpenClaw
 * handles the timing externally.
 */
export function createExternalTriggerSource(): ScheduleTriggerSource {
  return {
    kind: "external",

    getDueSchedules(_now: Date): DueSchedule[] {
      // External system (OpenClaw TaskFlow) handles schedule evaluation.
      return [];
    },

    markFired(_scheduleId: string, _now: Date): void {
      // No-op — the external system manages fire tracking.
    },
  };
}
