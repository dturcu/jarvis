import { describe, expect, it, beforeEach } from "vitest";
import { SchedulerStore, type WorkflowRecord, type HabitRecord, type HabitEntry } from "@jarvis/scheduler";
import {
  parseCronExpression,
  getNextFireTime,
  computeNextFireAt,
  evaluateThreshold,
  extractMetricValue
} from "@jarvis/scheduler";

// ─── SchedulerStore CRUD Tests ────────────────────────────────────────────────

describe("SchedulerStore — schedule CRUD", () => {
  let store: SchedulerStore;

  beforeEach(() => {
    store = new SchedulerStore();
  });

  it("creates a schedule with generated ID and timestamps", () => {
    const now = new Date("2026-04-04T10:00:00.000Z");
    const record = store.createSchedule({
      job_type: "system.monitor_cpu",
      input: { sample_count: 3 },
      interval_seconds: 60,
      next_fire_at: new Date(now.getTime() + 60000).toISOString(),
      enabled: true
    });

    expect(record.schedule_id).toBeTruthy();
    expect(record.job_type).toBe("system.monitor_cpu");
    expect(record.interval_seconds).toBe(60);
    expect(record.enabled).toBe(true);
    expect(record.created_at).toBeTruthy();
    expect(record.updated_at).toBeTruthy();
  });

  it("lists all schedules when no filter is provided", () => {
    store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true });
    store.createSchedule({ job_type: "system.monitor_memory", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: false });

    const all = store.listSchedules();
    expect(all).toHaveLength(2);
  });

  it("filters schedules by enabledOnly", () => {
    store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true });
    store.createSchedule({ job_type: "system.monitor_memory", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: false });

    const enabled = store.listSchedules({ enabledOnly: true });
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.job_type).toBe("system.monitor_cpu");
  });

  it("filters schedules by scopeGroup", () => {
    store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true, scope_group: "monitoring" });
    store.createSchedule({ job_type: "files.inspect", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true, scope_group: "files" });

    const monitoring = store.listSchedules({ scopeGroup: "monitoring" });
    expect(monitoring).toHaveLength(1);
    expect(monitoring[0]!.scope_group).toBe("monitoring");
  });

  it("retrieves a schedule by ID", () => {
    const record = store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true });
    const found = store.getSchedule(record.schedule_id);
    expect(found).not.toBeNull();
    expect(found!.schedule_id).toBe(record.schedule_id);
  });

  it("returns null for a non-existent schedule ID", () => {
    const found = store.getSchedule("does-not-exist");
    expect(found).toBeNull();
  });

  it("deletes a schedule and returns true", () => {
    const record = store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true });
    const deleted = store.deleteSchedule(record.schedule_id);
    expect(deleted).toBe(true);
    expect(store.getSchedule(record.schedule_id)).toBeNull();
  });

  it("returns false when deleting a non-existent schedule", () => {
    const deleted = store.deleteSchedule("does-not-exist");
    expect(deleted).toBe(false);
  });

  it("updates next_fire_at via updateNextFireAt", () => {
    const record = store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true });
    const newFireAt = "2026-04-04T11:05:00.000Z";
    store.updateNextFireAt(record.schedule_id, newFireAt);

    const updated = store.getSchedule(record.schedule_id);
    expect(updated!.next_fire_at).toBe(newFireAt);
    expect(updated!.updated_at).toBeTruthy();
  });

  it("markFired sets last_fired_at", () => {
    const record = store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true });
    expect(record.last_fired_at).toBeUndefined();

    store.markFired(record.schedule_id);
    const updated = store.getSchedule(record.schedule_id);
    expect(updated!.last_fired_at).toBeTruthy();
  });

  it("getDueSchedules returns only enabled schedules with past next_fire_at", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00.000Z", enabled: true });
    store.createSchedule({ job_type: "system.monitor_memory", input: {}, next_fire_at: "2026-04-04T13:00:00.000Z", enabled: true });
    store.createSchedule({ job_type: "files.inspect", input: {}, next_fire_at: "2026-04-04T10:00:00.000Z", enabled: false });

    const due = store.getDueSchedules(now);
    expect(due).toHaveLength(1);
    expect(due[0]!.job_type).toBe("system.monitor_cpu");
  });
});

describe("SchedulerStore — alert CRUD", () => {
  let store: SchedulerStore;

  beforeEach(() => {
    store = new SchedulerStore();
  });

  it("creates an alert with generated ID and timestamp", () => {
    const rule = store.createAlert({
      label: "High CPU",
      monitor_job_type: "system.monitor_cpu",
      metric_path: "cpu_percent",
      operator: "gt",
      threshold: 90,
      notify_severity: "critical",
      cooldown_seconds: 300,
      enabled: true
    });

    expect(rule.alert_id).toBeTruthy();
    expect(rule.label).toBe("High CPU");
    expect(rule.operator).toBe("gt");
    expect(rule.threshold).toBe(90);
    expect(rule.created_at).toBeTruthy();
  });

  it("lists all alerts", () => {
    store.createAlert({ label: "A", monitor_job_type: "t", metric_path: "p", operator: "gt", threshold: 1, notify_severity: "info", cooldown_seconds: 60, enabled: true });
    store.createAlert({ label: "B", monitor_job_type: "t", metric_path: "p", operator: "lt", threshold: 5, notify_severity: "warning", cooldown_seconds: 60, enabled: true });

    const all = store.listAlerts();
    expect(all).toHaveLength(2);
  });

  it("deletes an alert and returns true", () => {
    const rule = store.createAlert({ label: "A", monitor_job_type: "t", metric_path: "p", operator: "gt", threshold: 1, notify_severity: "info", cooldown_seconds: 60, enabled: true });
    expect(store.deleteAlert(rule.alert_id)).toBe(true);
    expect(store.getAlert(rule.alert_id)).toBeNull();
  });

  it("returns false when deleting non-existent alert", () => {
    expect(store.deleteAlert("missing")).toBe(false);
  });

  it("markAlertTriggered sets last_triggered_at", () => {
    const rule = store.createAlert({ label: "A", monitor_job_type: "t", metric_path: "p", operator: "gt", threshold: 1, notify_severity: "info", cooldown_seconds: 60, enabled: true });
    expect(rule.last_triggered_at).toBeUndefined();

    store.markAlertTriggered(rule.alert_id);
    const updated = store.getAlert(rule.alert_id);
    expect(updated!.last_triggered_at).toBeTruthy();
  });

  it("getStats returns correct counts", () => {
    store.createSchedule({ job_type: "system.monitor_cpu", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: true });
    store.createSchedule({ job_type: "system.monitor_memory", input: {}, next_fire_at: "2026-04-04T11:00:00Z", enabled: false });
    store.createAlert({ label: "A", monitor_job_type: "t", metric_path: "p", operator: "gt", threshold: 1, notify_severity: "info", cooldown_seconds: 60, enabled: true });

    const stats = store.getStats();
    expect(stats.schedules).toBe(2);
    expect(stats.enabled_schedules).toBe(1);
    expect(stats.alerts).toBe(1);
    expect(stats.enabled_alerts).toBe(1);
  });
});

// ─── Evaluator Tests ──────────────────────────────────────────────────────────

describe("parseCronExpression", () => {
  it("parses a standard 5-field cron expression", () => {
    const parsed = parseCronExpression("*/5 * * * *");
    expect(parsed.minute).toBe("*/5");
    expect(parsed.hour).toBe("*");
    expect(parsed.dayOfMonth).toBe("*");
    expect(parsed.month).toBe("*");
    expect(parsed.dayOfWeek).toBe("*");
  });

  it("parses a specific hourly cron", () => {
    const parsed = parseCronExpression("0 9 * * 1-5");
    expect(parsed.minute).toBe("0");
    expect(parsed.hour).toBe("9");
    expect(parsed.dayOfWeek).toBe("1-5");
  });

  it("throws for invalid field count", () => {
    expect(() => parseCronExpression("* * * *")).toThrow();
    expect(() => parseCronExpression("* * * * * *")).toThrow();
  });
});

describe("getNextFireTime", () => {
  it("returns the next minute for wildcard cron", () => {
    const after = new Date("2026-04-04T10:00:30.000Z");
    const cron = parseCronExpression("* * * * *");
    const next = getNextFireTime(cron, after);
    // Should be exactly 1 minute after the start of the current minute
    const expected = new Date(after);
    expected.setSeconds(0, 0);
    expected.setMinutes(expected.getMinutes() + 1);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it("computes next fire for */5 minute schedule", () => {
    const after = new Date("2026-04-04T10:00:00.000Z");
    const cron = parseCronExpression("*/5 * * * *");
    const next = getNextFireTime(cron, after);
    // Cron evaluates in local time — assert local getters
    expect(next.getMinutes() % 5).toBe(0);
    expect(next > after).toBe(true);
  });

  it("computes next fire for specific hour", () => {
    // Use a local time well before 9am to ensure next fire is 9:00 local today
    const after = new Date();
    after.setHours(7, 0, 0, 0);
    const cron = parseCronExpression("0 9 * * *");
    const next = getNextFireTime(cron, after);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it("wraps to the next day when time has passed for today", () => {
    // Set local time to 9:30am — cron "0 9" already passed today
    const after = new Date();
    after.setHours(9, 30, 0, 0);
    const cron = parseCronExpression("0 9 * * *");
    const next = getNextFireTime(cron, after);
    expect(next.getDate()).toBe(after.getDate() + 1); // Next day
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it("respects day-of-week constraint (weekdays only)", () => {
    // Find next Saturday for a reliable test
    const after = new Date();
    while (after.getDay() !== 6) after.setDate(after.getDate() + 1); // advance to Saturday
    after.setHours(9, 0, 0, 0);
    const cron = parseCronExpression("0 9 * * 1-5");
    const next = getNextFireTime(cron, after);
    // Should land on a weekday (1-5)
    expect(next.getDay()).toBeGreaterThanOrEqual(1);
    expect(next.getDay()).toBeLessThanOrEqual(5);
  });
});

describe("computeNextFireAt", () => {
  it("uses cron expression when provided", () => {
    const store = new SchedulerStore();
    const record = store.createSchedule({
      job_type: "system.monitor_cpu",
      input: {},
      cron_expression: "0 * * * *",
      next_fire_at: "2026-04-04T10:00:00.000Z",
      enabled: true
    });
    const now = new Date("2026-04-04T10:00:00.000Z");
    const next = computeNextFireAt(record, now);
    expect(next).toBeTruthy();
    const nextDate = new Date(next);
    expect(nextDate.getMinutes()).toBe(0);
    expect(nextDate > now).toBe(true);
  });

  it("uses interval_seconds when no cron is provided", () => {
    const store = new SchedulerStore();
    const record = store.createSchedule({
      job_type: "system.monitor_cpu",
      input: {},
      interval_seconds: 120,
      next_fire_at: "2026-04-04T10:00:00.000Z",
      enabled: true
    });
    const now = new Date("2026-04-04T10:00:00.000Z");
    const next = computeNextFireAt(record, now);
    const nextDate = new Date(next);
    expect(nextDate.getTime() - now.getTime()).toBe(120 * 1000);
  });

  it("defaults to 1 hour when neither cron nor interval provided", () => {
    const store = new SchedulerStore();
    const record = store.createSchedule({
      job_type: "system.monitor_cpu",
      input: {},
      next_fire_at: "2026-04-04T10:00:00.000Z",
      enabled: true
    });
    const now = new Date("2026-04-04T10:00:00.000Z");
    const next = computeNextFireAt(record, now);
    const nextDate = new Date(next);
    expect(nextDate.getTime() - now.getTime()).toBe(3600 * 1000);
  });
});

describe("evaluateThreshold", () => {
  it("evaluates gt correctly", () => {
    expect(evaluateThreshold(95, "gt", 90)).toBe(true);
    expect(evaluateThreshold(90, "gt", 90)).toBe(false);
    expect(evaluateThreshold(85, "gt", 90)).toBe(false);
  });

  it("evaluates lt correctly", () => {
    expect(evaluateThreshold(5, "lt", 10)).toBe(true);
    expect(evaluateThreshold(10, "lt", 10)).toBe(false);
    expect(evaluateThreshold(15, "lt", 10)).toBe(false);
  });

  it("evaluates eq correctly", () => {
    expect(evaluateThreshold(42, "eq", 42)).toBe(true);
    expect(evaluateThreshold(41, "eq", 42)).toBe(false);
  });

  it("evaluates gte correctly", () => {
    expect(evaluateThreshold(90, "gte", 90)).toBe(true);
    expect(evaluateThreshold(91, "gte", 90)).toBe(true);
    expect(evaluateThreshold(89, "gte", 90)).toBe(false);
  });

  it("evaluates lte correctly", () => {
    expect(evaluateThreshold(10, "lte", 10)).toBe(true);
    expect(evaluateThreshold(9, "lte", 10)).toBe(true);
    expect(evaluateThreshold(11, "lte", 10)).toBe(false);
  });
});

describe("extractMetricValue", () => {
  it("extracts a top-level numeric value", () => {
    const output = { cpu_percent: 87.5 };
    expect(extractMetricValue(output, "cpu_percent")).toBe(87.5);
  });

  it("extracts a nested numeric value via dot path", () => {
    const output = { usage: { memory_mb: 1024 } };
    expect(extractMetricValue(output, "usage.memory_mb")).toBe(1024);
  });

  it("extracts a deeply nested value", () => {
    const output = { a: { b: { c: 3.14 } } };
    expect(extractMetricValue(output, "a.b.c")).toBe(3.14);
  });

  it("returns null when path does not exist", () => {
    const output = { cpu_percent: 50 };
    expect(extractMetricValue(output, "nonexistent")).toBeNull();
  });

  it("returns null when intermediate path segment is missing", () => {
    const output = { usage: {} };
    expect(extractMetricValue(output, "usage.memory_mb")).toBeNull();
  });

  it("returns null when value is not a number", () => {
    const output = { status: "ok" };
    expect(extractMetricValue(output, "status")).toBeNull();
  });

  it("parses numeric strings to float", () => {
    const output = { cpu: "72.3" };
    expect(extractMetricValue(output, "cpu")).toBe(72.3);
  });

  it("returns null for non-numeric strings", () => {
    const output = { label: "high" };
    expect(extractMetricValue(output, "label")).toBeNull();
  });

  it("returns null when intermediate is null", () => {
    const output = { a: null };
    expect(extractMetricValue(output as Record<string, unknown>, "a.b")).toBeNull();
  });

  it("handles integer 0 as a valid metric value", () => {
    const output = { count: 0 };
    expect(extractMetricValue(output, "count")).toBe(0);
  });
});

// ─── Workflow Store Tests ─────────────────────────────────────────────────────

describe("SchedulerStore — workflow CRUD", () => {
  let store: SchedulerStore;

  beforeEach(() => {
    store = new SchedulerStore();
  });

  it("creates a workflow with generated ID and timestamps", () => {
    const record = store.createWorkflow({
      label: "Morning Routine",
      steps: [
        { job_type: "system.monitor_cpu", input: {} },
        { job_type: "device.notify", input: { title: "Done", body: "Morning checks complete." }, delay_seconds: 5 }
      ],
      enabled: true
    });

    expect(record.workflow_id).toBeTruthy();
    expect(record.label).toBe("Morning Routine");
    expect(record.steps).toHaveLength(2);
    expect(record.enabled).toBe(true);
    expect(record.created_at).toBeTruthy();
    expect(record.updated_at).toBeTruthy();
  });

  it("retrieves a workflow by ID", () => {
    const record = store.createWorkflow({
      label: "Test Workflow",
      steps: [{ job_type: "system.monitor_cpu", input: {} }],
      enabled: true
    });
    const found = store.getWorkflow(record.workflow_id);
    expect(found).not.toBeNull();
    expect(found!.workflow_id).toBe(record.workflow_id);
  });

  it("returns null for a non-existent workflow ID", () => {
    expect(store.getWorkflow("does-not-exist")).toBeNull();
  });

  it("lists all workflows", () => {
    store.createWorkflow({ label: "A", steps: [{ job_type: "system.monitor_cpu", input: {} }], enabled: true });
    store.createWorkflow({ label: "B", steps: [{ job_type: "system.monitor_memory", input: {} }], enabled: false });

    const all = store.listWorkflows();
    expect(all).toHaveLength(2);
  });

  it("filters workflows by enabledOnly", () => {
    store.createWorkflow({ label: "Active", steps: [{ job_type: "system.monitor_cpu", input: {} }], enabled: true });
    store.createWorkflow({ label: "Inactive", steps: [{ job_type: "system.monitor_memory", input: {} }], enabled: false });

    const active = store.listWorkflows({ enabledOnly: true });
    expect(active).toHaveLength(1);
    expect(active[0]!.label).toBe("Active");
  });

  it("filters workflows by scopeGroup", () => {
    store.createWorkflow({ label: "Ops", steps: [{ job_type: "system.monitor_cpu", input: {} }], enabled: true, scope_group: "ops" });
    store.createWorkflow({ label: "Dev", steps: [{ job_type: "files.inspect", input: {} }], enabled: true, scope_group: "dev" });

    const ops = store.listWorkflows({ scopeGroup: "ops" });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.scope_group).toBe("ops");
  });

  it("deletes a workflow and returns true", () => {
    const record = store.createWorkflow({ label: "Temp", steps: [{ job_type: "system.monitor_cpu", input: {} }], enabled: true });
    expect(store.deleteWorkflow(record.workflow_id)).toBe(true);
    expect(store.getWorkflow(record.workflow_id)).toBeNull();
  });

  it("returns false when deleting a non-existent workflow", () => {
    expect(store.deleteWorkflow("does-not-exist")).toBe(false);
  });

  it("stores optional step delay_seconds", () => {
    const record = store.createWorkflow({
      label: "Delayed",
      steps: [
        { job_type: "system.monitor_cpu", input: {} },
        { job_type: "device.notify", input: {}, delay_seconds: 10 }
      ],
      enabled: true
    });
    expect(record.steps[1]!.delay_seconds).toBe(10);
    expect(record.steps[0]!.delay_seconds).toBeUndefined();
  });
});

// ─── Habit Store Tests ────────────────────────────────────────────────────────

describe("SchedulerStore — habit CRUD", () => {
  let store: SchedulerStore;

  beforeEach(() => {
    store = new SchedulerStore();
  });

  it("creates a habit with generated ID and timestamp", () => {
    const habit = store.createHabit({ label: "Daily Exercise", enabled: true });

    expect(habit.habit_id).toBeTruthy();
    expect(habit.label).toBe("Daily Exercise");
    expect(habit.enabled).toBe(true);
    expect(habit.created_at).toBeTruthy();
    expect(habit.last_logged_at).toBeUndefined();
  });

  it("retrieves a habit by ID", () => {
    const habit = store.createHabit({ label: "Meditation", enabled: true });
    const found = store.getHabit(habit.habit_id);
    expect(found).not.toBeNull();
    expect(found!.habit_id).toBe(habit.habit_id);
  });

  it("returns null for a non-existent habit ID", () => {
    expect(store.getHabit("does-not-exist")).toBeNull();
  });

  it("lists all habits", () => {
    store.createHabit({ label: "Exercise", enabled: true });
    store.createHabit({ label: "Meditation", enabled: true });

    expect(store.listHabits()).toHaveLength(2);
  });

  it("deletes a habit and returns true", () => {
    const habit = store.createHabit({ label: "Reading", enabled: true });
    expect(store.deleteHabit(habit.habit_id)).toBe(true);
    expect(store.getHabit(habit.habit_id)).toBeNull();
  });

  it("returns false when deleting a non-existent habit", () => {
    expect(store.deleteHabit("does-not-exist")).toBe(false);
  });

  it("logs a value for a habit and returns the entry", () => {
    const habit = store.createHabit({ label: "Water Intake", enabled: true });
    const entry = store.logHabit(habit.habit_id, 8);

    expect(entry).not.toBeNull();
    expect(entry!.habit_id).toBe(habit.habit_id);
    expect(entry!.value).toBe(8);
    expect(entry!.entry_id).toBeTruthy();
    expect(entry!.logged_at).toBeTruthy();
  });

  it("updates last_logged_at on the habit record after logging", () => {
    const habit = store.createHabit({ label: "Steps", enabled: true });
    expect(habit.last_logged_at).toBeUndefined();

    store.logHabit(habit.habit_id, 10000);
    const updated = store.getHabit(habit.habit_id);
    expect(updated!.last_logged_at).toBeTruthy();
  });

  it("returns null when logging for a non-existent habit", () => {
    expect(store.logHabit("does-not-exist", 1)).toBeNull();
  });

  it("accumulates multiple log entries for a habit", () => {
    const habit = store.createHabit({ label: "Exercise", enabled: true });
    store.logHabit(habit.habit_id, 1);
    store.logHabit(habit.habit_id, 1);
    store.logHabit(habit.habit_id, 1);

    const entries = store.getHabitEntries(habit.habit_id);
    expect(entries).toHaveLength(3);
  });

  it("deletes all entries when habit is deleted", () => {
    const habit = store.createHabit({ label: "Reading", enabled: true });
    store.logHabit(habit.habit_id, 30);
    store.logHabit(habit.habit_id, 45);

    store.deleteHabit(habit.habit_id);
    const entries = store.getHabitEntries(habit.habit_id);
    expect(entries).toHaveLength(0);
  });

  it("filters entries by sinceDate", () => {
    const habit = store.createHabit({ label: "Steps", enabled: true });
    const pastEntry = store.logHabit(habit.habit_id, 5000);
    // Manually backdate the entry to simulate an old log
    if (pastEntry) {
      (pastEntry as any).logged_at = "2026-01-01T00:00:00.000Z";
    }
    store.logHabit(habit.habit_id, 8000);

    const since = new Date("2026-03-01T00:00:00.000Z");
    const recent = store.getHabitEntries(habit.habit_id, since);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.value).toBe(8000);
  });

  it("getHabitStatus returns correct totals and averages", () => {
    const habit = store.createHabit({ label: "Pushups", enabled: true });
    store.logHabit(habit.habit_id, 20);
    store.logHabit(habit.habit_id, 30);
    store.logHabit(habit.habit_id, 25);

    const status = store.getHabitStatus(habit.habit_id, 7);
    expect(status).toHaveLength(1);
    expect(status[0]!.log_count).toBe(3);
    expect(status[0]!.total_value).toBe(75);
    expect(status[0]!.average_value).toBeCloseTo(25);
  });

  it("getHabitStatus returns all habits when no habitId provided", () => {
    store.createHabit({ label: "Exercise", enabled: true });
    store.createHabit({ label: "Meditation", enabled: true });

    const status = store.getHabitStatus(undefined, 7);
    expect(status).toHaveLength(2);
  });

  it("getHabitStatus returns empty array for unknown habit", () => {
    const status = store.getHabitStatus("does-not-exist", 7);
    expect(status).toHaveLength(0);
  });

  it("getHabitStatus returns zero values for habit with no entries", () => {
    const habit = store.createHabit({ label: "Empty", enabled: true });
    const status = store.getHabitStatus(habit.habit_id, 7);
    expect(status[0]!.log_count).toBe(0);
    expect(status[0]!.total_value).toBe(0);
    expect(status[0]!.average_value).toBe(0);
  });
});
