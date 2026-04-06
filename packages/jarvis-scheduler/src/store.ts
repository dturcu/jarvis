import { randomUUID } from "node:crypto";

export type WorkflowStep = {
  job_type: string;
  input: Record<string, unknown>;
  delay_seconds?: number;
};

export type WorkflowRecord = {
  workflow_id: string;
  label: string;
  steps: WorkflowStep[];
  scope_group?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type HabitRecord = {
  habit_id: string;
  label: string;
  enabled: boolean;
  created_at: string;
  last_logged_at?: string;
};

export type HabitEntry = {
  entry_id: string;
  habit_id: string;
  value: number;
  logged_at: string;
};

export type ScheduleRecord = {
  schedule_id: string;
  job_type: string;
  input: Record<string, unknown>;
  cron_expression?: string;
  interval_seconds?: number;
  next_fire_at: string;
  enabled: boolean;
  scope_group?: string;
  label?: string;
  created_at: string;
  updated_at: string;
  last_fired_at?: string;
};

export type AlertRule = {
  alert_id: string;
  label: string;
  monitor_job_type: string;
  metric_path: string;
  operator: "gt" | "lt" | "eq" | "gte" | "lte";
  threshold: number;
  notify_severity: "info" | "warning" | "critical";
  cooldown_seconds: number;
  last_triggered_at?: string;
  enabled: boolean;
  created_at: string;
};

function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const pattern = /^(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/;
  return fields.every(f => pattern.test(f));
}

export class SchedulerStore {
  private schedules = new Map<string, ScheduleRecord>();
  private alerts = new Map<string, AlertRule>();
  private workflows = new Map<string, WorkflowRecord>();
  private habits = new Map<string, HabitRecord>();
  private habitEntries: HabitEntry[] = [];

  createSchedule(
    params: Omit<ScheduleRecord, "schedule_id" | "created_at" | "updated_at">,
  ): ScheduleRecord {
    if (params.cron_expression && !isValidCron(params.cron_expression)) {
      throw new Error(`Invalid cron expression: "${params.cron_expression}". Expected 5 space-separated fields with valid cron patterns.`);
    }
    const now = new Date().toISOString();
    const record: ScheduleRecord = {
      ...params,
      schedule_id: randomUUID(),
      created_at: now,
      updated_at: now
    };
    this.schedules.set(record.schedule_id, record);
    return record;
  }

  listSchedules(filter?: {
    scopeGroup?: string;
    enabledOnly?: boolean;
  }): ScheduleRecord[] {
    let records = Array.from(this.schedules.values());
    if (filter?.scopeGroup !== undefined) {
      records = records.filter((r) => r.scope_group === filter.scopeGroup);
    }
    if (filter?.enabledOnly) {
      records = records.filter((r) => r.enabled);
    }
    return records;
  }

  getSchedule(id: string): ScheduleRecord | null {
    return this.schedules.get(id) ?? null;
  }

  deleteSchedule(id: string): boolean {
    return this.schedules.delete(id);
  }

  updateNextFireAt(id: string, nextFireAt: string): void {
    const record = this.schedules.get(id);
    if (record) {
      record.next_fire_at = nextFireAt;
      record.updated_at = new Date().toISOString();
    }
  }

  markFired(id: string): void {
    const record = this.schedules.get(id);
    if (record) {
      const now = new Date().toISOString();
      record.last_fired_at = now;
      record.updated_at = now;
    }
  }

  createAlert(params: Omit<AlertRule, "alert_id" | "created_at">): AlertRule {
    const now = new Date().toISOString();
    const rule: AlertRule = {
      ...params,
      alert_id: randomUUID(),
      created_at: now
    };
    this.alerts.set(rule.alert_id, rule);
    return rule;
  }

  listAlerts(): AlertRule[] {
    return Array.from(this.alerts.values());
  }

  getAlert(id: string): AlertRule | null {
    return this.alerts.get(id) ?? null;
  }

  deleteAlert(id: string): boolean {
    return this.alerts.delete(id);
  }

  markAlertTriggered(id: string): void {
    const rule = this.alerts.get(id);
    if (rule) {
      rule.last_triggered_at = new Date().toISOString();
    }
  }

  getDueSchedules(now: Date): ScheduleRecord[] {
    const nowMs = now.getTime();
    return Array.from(this.schedules.values()).filter(
      (r) => r.enabled && r.next_fire_at && new Date(r.next_fire_at).getTime() <= nowMs,
    );
  }

  getStats(): {
    schedules: number;
    alerts: number;
    enabled_schedules: number;
    enabled_alerts: number;
  } {
    const scheduleList = Array.from(this.schedules.values());
    const alertList = Array.from(this.alerts.values());
    return {
      schedules: scheduleList.length,
      alerts: alertList.length,
      enabled_schedules: scheduleList.filter((s) => s.enabled).length,
      enabled_alerts: alertList.filter((a) => a.enabled).length
    };
  }

  // ─── Workflow CRUD ────────────────────────────────────────────────────────────

  createWorkflow(
    params: Omit<WorkflowRecord, "workflow_id" | "created_at" | "updated_at">,
  ): WorkflowRecord {
    const now = new Date().toISOString();
    const record: WorkflowRecord = {
      ...params,
      workflow_id: randomUUID(),
      created_at: now,
      updated_at: now
    };
    this.workflows.set(record.workflow_id, record);
    return record;
  }

  getWorkflow(id: string): WorkflowRecord | null {
    return this.workflows.get(id) ?? null;
  }

  listWorkflows(filter?: { scopeGroup?: string; enabledOnly?: boolean }): WorkflowRecord[] {
    let records = Array.from(this.workflows.values());
    if (filter?.scopeGroup !== undefined) {
      records = records.filter((r) => r.scope_group === filter.scopeGroup);
    }
    if (filter?.enabledOnly) {
      records = records.filter((r) => r.enabled);
    }
    return records;
  }

  deleteWorkflow(id: string): boolean {
    return this.workflows.delete(id);
  }

  // ─── Habit CRUD ───────────────────────────────────────────────────────────────

  createHabit(params: Omit<HabitRecord, "habit_id" | "created_at">): HabitRecord {
    const now = new Date().toISOString();
    const record: HabitRecord = {
      ...params,
      habit_id: randomUUID(),
      created_at: now
    };
    this.habits.set(record.habit_id, record);
    return record;
  }

  getHabit(id: string): HabitRecord | null {
    return this.habits.get(id) ?? null;
  }

  listHabits(): HabitRecord[] {
    return Array.from(this.habits.values());
  }

  deleteHabit(id: string): boolean {
    if (!this.habits.delete(id)) {
      return false;
    }
    this.habitEntries = this.habitEntries.filter((e) => e.habit_id !== id);
    return true;
  }

  logHabit(habitId: string, value: number): HabitEntry | null {
    const habit = this.habits.get(habitId);
    if (!habit) {
      return null;
    }
    const now = new Date().toISOString();
    const entry: HabitEntry = {
      entry_id: randomUUID(),
      habit_id: habitId,
      value,
      logged_at: now
    };
    this.habitEntries.push(entry);
    habit.last_logged_at = now;

    // Prune entries older than 90 days to prevent unbounded growth
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    this.habitEntries = this.habitEntries.filter(e => e.logged_at > cutoff);

    return entry;
  }

  getHabitEntries(habitId: string, sinceDate?: Date): HabitEntry[] {
    let entries = this.habitEntries.filter((e) => e.habit_id === habitId);
    if (sinceDate) {
      const sinceIso = sinceDate.toISOString();
      entries = entries.filter((e) => e.logged_at >= sinceIso);
    }
    return entries;
  }

  getHabitStatus(
    habitId?: string,
    daysBack = 7,
  ): Array<{
    habit: HabitRecord;
    entries: HabitEntry[];
    log_count: number;
    total_value: number;
    average_value: number;
  }> {
    const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
    const habitsToCheck = habitId
      ? this.habits.has(habitId)
        ? [this.habits.get(habitId)!]
        : []
      : Array.from(this.habits.values());

    return habitsToCheck.map((habit) => {
      const entries = this.getHabitEntries(habit.habit_id, since);
      const totalValue = entries.reduce((sum, e) => sum + e.value, 0);
      return {
        habit,
        entries,
        log_count: entries.length,
        total_value: totalValue,
        average_value: entries.length > 0 ? totalValue / entries.length : 0
      };
    });
  }
}
