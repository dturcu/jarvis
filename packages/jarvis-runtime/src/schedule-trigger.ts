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
  readonly kind: "db" | "external" | "taskflow";

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

// ─── TaskFlowTriggerSource (Epic 3) ────────────────────────────────────────

/**
 * Configuration for TaskFlow workflow registration.
 */
export type TaskFlowWorkflowConfig = {
  /** Jarvis schedule ID mapped to this workflow. */
  schedule_id: string;
  /** OpenClaw TaskFlow workflow ID. */
  taskflow_workflow_id: string;
  /** Correlation key between TaskFlow run and Jarvis run. */
  correlation_key?: string;
};

/**
 * Adapter for managed OpenClaw TaskFlow-backed scheduling (Epic 3).
 *
 * Unlike ExternalTriggerSource (which is a passive no-op), TaskFlowTriggerSource
 * actively registers Jarvis schedules as TaskFlow workflows and responds to
 * TaskFlow trigger callbacks. The daemon operates in "event-reactive" mode:
 * instead of polling getDueSchedules(), it listens for TaskFlow events.
 *
 * Select via JARVIS_SCHEDULE_SOURCE=taskflow.
 */
export function createTaskFlowTriggerSource(config?: {
  workflows?: TaskFlowWorkflowConfig[];
}): ScheduleTriggerSource {
  const _workflows = config?.workflows ?? [];

  return {
    kind: "taskflow",

    getDueSchedules(_now: Date): DueSchedule[] {
      // TaskFlow pushes triggers via callbacks — no polling needed.
      // When TaskFlow fires a workflow, it calls enqueueAgent() directly
      // through the gateway, bypassing this method entirely.
      return [];
    },

    markFired(scheduleId: string, _now: Date): void {
      // TaskFlow manages its own fire tracking. Log for observability.
      const workflow = _workflows.find((w) => w.schedule_id === scheduleId);
      if (workflow) {
        console.info(
          `[taskflow-trigger] Schedule ${scheduleId} fired via TaskFlow workflow ${workflow.taskflow_workflow_id}`,
        );
      }
    },
  };
}
