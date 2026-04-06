import type { ScheduleRecord, AlertRule } from "./store.js";

export type CronFields = {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
};

export function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: "${expr}". Expected 5 fields (minute hour dayOfMonth month dayOfWeek).`,
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string
  ];
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/**
 * Returns true if the given value matches the cron field spec.
 * Supports: *, specific numbers, ranges (e.g. 1-5), and lists (e.g. 1,3,5).
 */
function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;

  // Handle comma-separated lists
  if (field.includes(",")) {
    return field.split(",").some((part) => fieldMatches(part.trim(), value));
  }

  // Handle ranges (e.g. 1-5)
  if (field.includes("-")) {
    const [startStr, endStr] = field.split("-");
    const start = parseInt(startStr ?? "0", 10);
    const end = parseInt(endStr ?? "0", 10);
    return value >= start && value <= end;
  }

  // Handle step values (e.g. */5 or 0-30/5)
  if (field.includes("/")) {
    const [rangeStr, stepStr] = field.split("/");
    const step = parseInt(stepStr ?? "1", 10);
    if (rangeStr === "*") {
      return value % step === 0;
    }
    if (rangeStr?.includes("-")) {
      const [startStr, endStr] = rangeStr.split("-");
      const start = parseInt(startStr ?? "0", 10);
      const end = parseInt(endStr ?? "0", 10);
      if (value >= start && value <= end) {
        return (value - start) % step === 0;
      }
      return false;
    }
    const base = parseInt(rangeStr ?? "0", 10);
    return value >= base && (value - base) % step === 0;
  }

  // Exact match
  return parseInt(field, 10) === value;
}

/**
 * Computes the next time the cron schedule fires after the given `after` date.
 * Iterates minute by minute up to ~1 year into the future.
 *
 * Cron field matching uses local time (`getMinutes`, `getHours`, etc.)
 * so that schedules like "0 8 * * 1-5" fire at 8am in the machine's timezone.
 */
export function getNextFireTime(cron: CronFields, after: Date): Date {
  // Start from next minute after `after`
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(after.getTime() + 366 * 24 * 60 * 60 * 1000);

  while (candidate <= limit) {
    // Use local time — cron schedules on a local appliance mean local time
    const minute = candidate.getMinutes();
    const hour = candidate.getHours();
    const dayOfMonth = candidate.getDate();
    const month = candidate.getMonth() + 1; // 1-12
    const dayOfWeek = candidate.getDay(); // 0=Sun

    if (
      fieldMatches(cron.minute, minute) &&
      fieldMatches(cron.hour, hour) &&
      fieldMatches(cron.dayOfMonth, dayOfMonth) &&
      fieldMatches(cron.month, month) &&
      fieldMatches(cron.dayOfWeek, dayOfWeek)
    ) {
      return new Date(candidate);
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`No next fire time found within 1 year for cron: "${cron.minute} ${cron.hour} ${cron.dayOfMonth} ${cron.month} ${cron.dayOfWeek}"`);
}

/**
 * Computes the ISO string for the next fire time of a schedule record.
 */
export function computeNextFireAt(schedule: ScheduleRecord, now: Date): string {
  if (schedule.cron_expression) {
    const cron = parseCronExpression(schedule.cron_expression);
    return getNextFireTime(cron, now).toISOString();
  }

  if (schedule.interval_seconds && schedule.interval_seconds > 0) {
    return new Date(now.getTime() + schedule.interval_seconds * 1000).toISOString();
  }

  // Default: 1 hour from now
  return new Date(now.getTime() + 3600 * 1000).toISOString();
}

/**
 * Evaluates whether `value op threshold` is true.
 */
export function evaluateThreshold(
  value: number,
  operator: AlertRule["operator"],
  threshold: number,
): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "eq":
      return Math.abs(value - threshold) < 1e-9;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
    default:
      return false;
  }
}

/**
 * Extracts a numeric metric value from an output object using a dot-separated path.
 * Returns null if the path doesn't resolve or the value isn't a number.
 */
export function extractMetricValue(
  output: Record<string, unknown>,
  metricPath: string,
): number | null {
  const parts = metricPath.split(".");
  let current: unknown = output;

  for (const part of parts) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === "number") {
    return current;
  }

  if (typeof current === "string") {
    const parsed = parseFloat(current);
    return isNaN(parsed) ? null : parsed;
  }

  return null;
}
