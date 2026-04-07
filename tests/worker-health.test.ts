import { describe, it, expect, beforeEach } from "vitest";
import { WorkerHealthMonitor } from "@jarvis/runtime";

const KNOWN_PREFIXES: Record<string, { isolation: string }> = {
  email: { isolation: "in_process" },
  web: { isolation: "in_process" },
  browser: { isolation: "child_process" },
};

describe("WorkerHealthMonitor", () => {
  let monitor: WorkerHealthMonitor;

  beforeEach(() => {
    monitor = new WorkerHealthMonitor(KNOWN_PREFIXES);
  });

  // ─── Initial state ─────────────────────────────────────────────────────

  it("starts all known workers as healthy", () => {
    const report = monitor.getHealthReport();
    expect(report).toHaveLength(3);
    for (const entry of report) {
      expect(entry.status).toBe("healthy");
      expect(entry.total_executions).toBe(0);
      expect(entry.total_failures).toBe(0);
      expect(entry.total_timeouts).toBe(0);
      expect(entry.failure_rate).toBe(0);
      expect(entry.last_execution_at).toBeNull();
      expect(entry.last_failure_at).toBeNull();
    }
  });

  // ─── recordExecution ──────────────────────────────────────────────────

  it("recordExecution(success) keeps worker healthy", () => {
    monitor.recordExecution("email", 50, true);
    monitor.recordExecution("email", 45, true);
    monitor.recordExecution("email", 60, true);

    const entry = monitor.getWorkerHealth("email")!;
    expect(entry.status).toBe("healthy");
    expect(entry.total_executions).toBe(3);
    expect(entry.total_failures).toBe(0);
    expect(entry.failure_rate).toBe(0);
    expect(entry.last_execution_at).not.toBeNull();
    expect(entry.last_failure_at).toBeNull();
  });

  // ─── Failure rate thresholds ──────────────────────────────────────────

  it(">50% failure rate = unhealthy", () => {
    // 6 failures out of 10 = 60% failure rate
    for (let i = 0; i < 4; i++) monitor.recordExecution("web", 10, true);
    for (let i = 0; i < 6; i++) monitor.recordExecution("web", 10, false);

    const entry = monitor.getWorkerHealth("web")!;
    expect(entry.status).toBe("unhealthy");
    expect(entry.failure_rate).toBeGreaterThan(0.5);
  });

  it("10-50% failure rate = degraded", () => {
    // 3 failures out of 10 = 30% failure rate
    for (let i = 0; i < 7; i++) monitor.recordExecution("web", 10, true);
    for (let i = 0; i < 3; i++) monitor.recordExecution("web", 10, false);

    const entry = monitor.getWorkerHealth("web")!;
    expect(entry.status).toBe("degraded");
    expect(entry.failure_rate).toBeGreaterThan(0.1);
    expect(entry.failure_rate).toBeLessThanOrEqual(0.5);
  });

  it("<10% failure rate = healthy", () => {
    // 1 failure out of 20 = 5% failure rate
    for (let i = 0; i < 19; i++) monitor.recordExecution("web", 10, true);
    monitor.recordExecution("web", 10, false);

    const entry = monitor.getWorkerHealth("web")!;
    expect(entry.status).toBe("healthy");
    expect(entry.failure_rate).toBeLessThanOrEqual(0.1);
  });

  it("multiple failures degrade worker from healthy to degraded/unhealthy", () => {
    // Start healthy
    monitor.recordExecution("browser", 100, true);
    expect(monitor.getWorkerHealth("browser")!.status).toBe("healthy");

    // Add enough failures to degrade
    monitor.recordExecution("browser", 100, false);
    // 1 success + 1 failure = 50% -- exactly at boundary, not > 0.5
    expect(monitor.getWorkerHealth("browser")!.status).toBe("degraded");

    // Add more failures to go unhealthy
    monitor.recordExecution("browser", 100, false);
    monitor.recordExecution("browser", 100, false);
    // 1 success + 3 failures = 75%
    expect(monitor.getWorkerHealth("browser")!.status).toBe("unhealthy");
  });

  // ─── recordTimeout ───────────────────────────────────────────────────

  it("recordTimeout increments timeout counter", () => {
    monitor.recordTimeout("email");
    monitor.recordTimeout("email");

    const entry = monitor.getWorkerHealth("email")!;
    expect(entry.total_timeouts).toBe(2);
    expect(entry.total_failures).toBe(2);
    expect(entry.total_executions).toBe(2);
    expect(entry.last_failure_at).not.toBeNull();
  });

  // ─── Ring buffer ─────────────────────────────────────────────────────

  it("ring buffer caps at 50 entries", () => {
    // Record 60 executions -- the ring buffer should hold only the last 50
    for (let i = 0; i < 60; i++) {
      monitor.recordExecution("email", 10, true);
    }

    const entry = monitor.getWorkerHealth("email")!;
    // Total executions count every call, regardless of ring buffer
    expect(entry.total_executions).toBe(60);
    // Failure rate is computed from ring buffer contents (all successes)
    expect(entry.failure_rate).toBe(0);
    expect(entry.status).toBe("healthy");

    // Now add failures -- they should eventually dominate the ring buffer
    // because old successes get evicted
    for (let i = 0; i < 50; i++) {
      monitor.recordExecution("email", 10, false);
    }
    // Ring buffer now holds 50 failures (the 50 successes were evicted)
    const afterFailures = monitor.getWorkerHealth("email")!;
    expect(afterFailures.failure_rate).toBe(1);
    expect(afterFailures.status).toBe("unhealthy");
  });

  // ─── reset ───────────────────────────────────────────────────────────

  it("reset() clears all state", () => {
    monitor.recordExecution("email", 50, true);
    monitor.recordExecution("web", 30, false);
    monitor.recordTimeout("browser");

    monitor.reset();

    const report = monitor.getHealthReport();
    expect(report).toHaveLength(3);
    for (const entry of report) {
      expect(entry.total_executions).toBe(0);
      expect(entry.total_failures).toBe(0);
      expect(entry.total_timeouts).toBe(0);
      expect(entry.failure_rate).toBe(0);
      expect(entry.status).toBe("healthy");
      expect(entry.last_execution_at).toBeNull();
      expect(entry.last_failure_at).toBeNull();
    }
  });

  // ─── getWorkerHealth / getHealthReport ──────────────────────────────

  it("getWorkerHealth returns entry for known prefix", () => {
    const entry = monitor.getWorkerHealth("email");
    expect(entry).toBeDefined();
    expect(entry!.prefix).toBe("email");
    expect(entry!.isolation).toBe("in_process");
  });

  it("getWorkerHealth returns undefined for unknown prefix when not auto-created", () => {
    // "unknown" was never recorded and not in known prefixes
    const entry = monitor.getWorkerHealth("unknown");
    expect(entry).toBeUndefined();
  });

  it("getHealthReport returns array of all tracked workers", () => {
    const report = monitor.getHealthReport();
    expect(Array.isArray(report)).toBe(true);
    expect(report).toHaveLength(3);

    const prefixes = report.map((e) => e.prefix).sort();
    expect(prefixes).toEqual(["browser", "email", "web"]);
  });

  // ─── Auto-creation on record ────────────────────────────────────────

  it("auto-creates entries for unknown prefixes on recordExecution", () => {
    const fresh = new WorkerHealthMonitor();
    fresh.recordExecution("custom", 100, true);

    const entry = fresh.getWorkerHealth("custom");
    expect(entry).toBeDefined();
    expect(entry!.prefix).toBe("custom");
    expect(entry!.total_executions).toBe(1);
  });
});
