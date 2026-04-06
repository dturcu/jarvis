/**
 * End-to-end lifecycle tests for Jarvis V1 production readiness.
 *
 * Tests the full command → run → completion lifecycle, schedule durability,
 * evidence-backed model routing, action classification, and state machine
 * enforcement — all against temp SQLite databases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, RunStore, validateConfig, type JarvisRuntimeConfig } from "@jarvis/runtime";
import { requestApproval, resolveApproval, listApprovals } from "@jarvis/runtime";
import { DbSchedulerStore } from "@jarvis/runtime";
import { isReadOnlyAction } from "@jarvis/runtime";
import {
  selectByProfileWithEvidence, loadAllBenchmarks, syncModelRegistry, loadRegisteredModels,
  type ModelInfo, type ModelBenchmarkData,
} from "@jarvis/inference";

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return { db, path: dbPath };
}

function cleanup(db: DatabaseSync, dbPath: string) {
  try { db.close(); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
}

// ── Command → Run → Completion Lifecycle ──────────────────────────────────────

describe("E2E: Command → Run → Completion", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("links a command to a run and marks command terminal on run completion", () => {
    const now = new Date().toISOString();

    // 1. Insert a command (simulates dashboard/webhook trigger)
    db.prepare(
      "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by) VALUES (?, ?, ?, 'queued', 0, ?, ?)",
    ).run("cmd-001", "run_agent", "bd-pipeline", now, "dashboard");

    // 2. Claim the command (simulates daemon polling)
    const claimed = db.prepare(
      "UPDATE agent_commands SET status = 'claimed', claimed_at = ? WHERE command_id = ? AND status = 'queued'",
    ).run(now, "cmd-001");
    expect((claimed as { changes: number }).changes).toBe(1);

    // 3. Store pending command (simulates daemon linking)
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)",
    ).run("pending_command:bd-pipeline", JSON.stringify("cmd-001"), now);

    // 4. Start run with command_id (simulates orchestrator)
    const store = new RunStore(db);
    const runId = store.startRun("bd-pipeline", "manual", "cmd-001", "Process new leads");

    // Verify run is in planning state
    expect(store.getStatus(runId)).toBe("planning");

    // Verify run record has command_id linked
    const runRecord = store.getRun(runId);
    expect(runRecord).toBeTruthy();
    expect(runRecord!.command_id).toBe("cmd-001");

    // 5. Execute steps
    store.transition(runId, "bd-pipeline", "executing", "step_started", { step_no: 1, action: "web.search" });
    store.emitEvent(runId, "bd-pipeline", "step_completed", { step_no: 1, action: "web.search" });

    // 6. Complete run — marks command as completed
    store.transition(runId, "bd-pipeline", "completed", "run_completed");
    store.completeCommand(runId, "completed");

    // Verify command is now completed
    const cmd = db.prepare("SELECT status, completed_at FROM agent_commands WHERE command_id = ?").get("cmd-001") as { status: string; completed_at: string };
    expect(cmd.status).toBe("completed");
    expect(cmd.completed_at).toBeTruthy();
  });

  it("marks command as failed when run fails", () => {
    const now = new Date().toISOString();

    db.prepare(
      "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by) VALUES (?, ?, ?, 'queued', 0, ?, ?)",
    ).run("cmd-fail", "run_agent", "test-agent", now, "test");

    db.prepare(
      "UPDATE agent_commands SET status = 'claimed', claimed_at = ? WHERE command_id = ?",
    ).run(now, "cmd-fail");

    const store = new RunStore(db);
    const runId = store.startRun("test-agent", "manual", "cmd-fail", "Test goal");

    store.transition(runId, "test-agent", "executing", "step_started");
    store.transition(runId, "test-agent", "failed", "run_failed", {
      details: { error: "Test failure" },
    });
    store.completeCommand(runId, "failed");

    const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get("cmd-fail") as { status: string };
    expect(cmd.status).toBe("failed");
  });

  it("command without linked run stays claimed (no false completion)", () => {
    const now = new Date().toISOString();

    db.prepare(
      "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, claimed_at) VALUES (?, ?, ?, 'claimed', 0, ?, ?, ?)",
    ).run("cmd-orphan", "run_agent", "test-agent", now, "test", now);

    // Start a run WITHOUT linking this command
    const store = new RunStore(db);
    const runId = store.startRun("test-agent", "schedule");

    // Complete the run
    store.transition(runId, "test-agent", "executing", "step_started");
    store.transition(runId, "test-agent", "completed", "run_completed");

    // completeCommand looks up command_id from the run — this run has no command
    store.completeCommand(runId, "completed");

    // Orphaned command should still be 'claimed'
    const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get("cmd-orphan") as { status: string };
    expect(cmd.status).toBe("claimed");
  });
});

// ── Run State Machine ─────────────────────────────────────────────────────────

describe("E2E: Run State Machine Exhaustive", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("allows all valid transition paths", () => {
    const store = new RunStore(db);

    // Path 1: queued → planning → executing → completed
    const r1 = store.startRun("agent-a");
    store.transition(r1, "agent-a", "executing", "step_started");
    store.transition(r1, "agent-a", "completed", "run_completed");
    expect(store.getStatus(r1)).toBe("completed");

    // Path 2: queued → planning → failed
    const r2 = store.startRun("agent-b");
    store.transition(r2, "agent-b", "failed", "run_failed");
    expect(store.getStatus(r2)).toBe("failed");

    // Path 3: queued → planning → executing → awaiting_approval → executing → completed
    const r3 = store.startRun("agent-c");
    store.transition(r3, "agent-c", "executing", "step_started");
    store.transition(r3, "agent-c", "awaiting_approval", "approval_requested");
    store.transition(r3, "agent-c", "executing", "step_started");
    store.transition(r3, "agent-c", "completed", "run_completed");
    expect(store.getStatus(r3)).toBe("completed");

    // Path 4: queued → planning → cancelled
    const r4 = store.startRun("agent-d");
    store.transition(r4, "agent-d", "cancelled", "run_cancelled");
    expect(store.getStatus(r4)).toBe("cancelled");

    // Path 5: executing → cancelled
    const r5 = store.startRun("agent-e");
    store.transition(r5, "agent-e", "executing", "step_started");
    store.transition(r5, "agent-e", "cancelled", "run_cancelled");
    expect(store.getStatus(r5)).toBe("cancelled");

    // Path 6: awaiting_approval → cancelled
    const r6 = store.startRun("agent-f");
    store.transition(r6, "agent-f", "executing", "step_started");
    store.transition(r6, "agent-f", "awaiting_approval", "approval_requested");
    store.transition(r6, "agent-f", "cancelled", "run_cancelled");
    expect(store.getStatus(r6)).toBe("cancelled");
  });

  it("rejects all invalid transitions from terminal states", () => {
    const store = new RunStore(db);

    // completed → anything
    const r1 = store.startRun("a");
    store.transition(r1, "a", "executing", "step_started");
    store.transition(r1, "a", "completed", "run_completed");
    expect(() => store.transition(r1, "a", "executing", "step_started")).toThrow();
    expect(() => store.transition(r1, "a", "planning", "run_started")).toThrow();
    expect(() => store.transition(r1, "a", "failed", "run_failed")).toThrow();

    // failed → anything
    const r2 = store.startRun("b");
    store.transition(r2, "b", "failed", "run_failed");
    expect(() => store.transition(r2, "b", "executing", "step_started")).toThrow();
    expect(() => store.transition(r2, "b", "completed", "run_completed")).toThrow();

    // cancelled → anything
    const r3 = store.startRun("c");
    store.transition(r3, "c", "cancelled", "run_cancelled");
    expect(() => store.transition(r3, "c", "executing", "step_started")).toThrow();
  });

  it("rejects invalid non-terminal transitions", () => {
    const store = new RunStore(db);

    // planning → awaiting_approval (must go through executing first)
    const r1 = store.startRun("a");
    expect(() => store.transition(r1, "a", "awaiting_approval", "approval_requested")).toThrow();

    // queued → executing (must go through planning first — startRun auto-transitions to planning)
    // Since startRun transitions queued → planning, we can't test queued → executing directly
    // But we CAN test planning → awaiting_approval which is invalid
    const r2 = store.startRun("b");
    expect(() => store.transition(r2, "b", "awaiting_approval", "approval_requested")).toThrow();
  });

  it("records all events in chronological order", () => {
    const store = new RunStore(db);
    const runId = store.startRun("agent-a");

    store.emitEvent(runId, "agent-a", "step_started", { step_no: 1, action: "web.search" });
    store.emitEvent(runId, "agent-a", "step_completed", { step_no: 1, action: "web.search" });
    store.transition(runId, "agent-a", "executing", "step_started", { step_no: 2, action: "email.send" });
    store.emitEvent(runId, "agent-a", "step_completed", { step_no: 2, action: "email.send" });
    store.transition(runId, "agent-a", "completed", "run_completed");

    const events = store.getRunEvents(runId);
    expect(events.length).toBeGreaterThanOrEqual(6); // run_started + 4 manual + run_completed

    // Verify chronological order
    for (let i = 1; i < events.length; i++) {
      expect(events[i].created_at >= events[i - 1].created_at).toBe(true);
    }

    // Verify first event is run_started
    expect(events[0].event_type).toBe("run_started");

    // Verify last event is run_completed
    expect(events[events.length - 1].event_type).toBe("run_completed");
  });

  it("stores completed_at and error on terminal states", () => {
    const store = new RunStore(db);

    // Successful run
    const r1 = store.startRun("agent-a");
    store.transition(r1, "agent-a", "executing", "step_started");
    store.transition(r1, "agent-a", "completed", "run_completed");
    const run1 = store.getRun(r1);
    expect(run1!.completed_at).toBeTruthy();
    expect(run1!.error).toBeNull();

    // Failed run
    const r2 = store.startRun("agent-b");
    store.transition(r2, "agent-b", "failed", "run_failed", {
      details: { error: "Connection timeout" },
    });
    const run2 = store.getRun(r2);
    expect(run2!.completed_at).toBeTruthy();
    expect(run2!.error).toBe("Connection timeout");
  });
});

// ── Schedule Durability ───────────────────────────────────────────────────────

describe("E2E: Schedule Durability", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("persists schedules and retrieves them after re-instantiation", () => {
    const scheduler1 = new DbSchedulerStore(db);

    // Seed schedules (simulates daemon startup)
    const nextFire = new Date(Date.now() + 3600_000).toISOString(); // 1 hour from now
    scheduler1.seedSchedule({
      job_type: "agent.garden-calendar",
      input: { agent_id: "garden-calendar" },
      cron_expression: "0 7 * * 1",
      next_fire_at: nextFire,
      enabled: true,
      scope_group: "agents",
      label: "Garden Calendar",
    });

    scheduler1.seedSchedule({
      job_type: "agent.portfolio-monitor",
      input: { agent_id: "portfolio-monitor" },
      cron_expression: "0 9 * * 1-5",
      next_fire_at: nextFire,
      enabled: true,
      scope_group: "agents",
      label: "Portfolio Monitor",
    });

    expect(scheduler1.count()).toBe(2);

    // Re-instantiate (simulates daemon restart)
    const scheduler2 = new DbSchedulerStore(db);
    expect(scheduler2.count()).toBe(2);

    // Seed again (should be idempotent — no duplicates)
    const inserted = scheduler2.seedSchedule({
      job_type: "agent.garden-calendar",
      input: { agent_id: "garden-calendar" },
      cron_expression: "0 7 * * 1",
      next_fire_at: nextFire,
      enabled: true,
      scope_group: "agents",
      label: "Garden Calendar",
    });
    expect(inserted).toBe(false); // Already exists
    expect(scheduler2.count()).toBe(2);
  });

  it("finds due schedules and updates fire timestamps", () => {
    const scheduler = new DbSchedulerStore(db);

    const pastFire = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago (due)
    const futureFire = new Date(Date.now() + 3600_000).toISOString(); // 1 hour from now (not due)

    scheduler.seedSchedule({
      job_type: "agent.garden-calendar",
      input: { agent_id: "garden-calendar" },
      cron_expression: "0 7 * * 1",
      next_fire_at: pastFire,
      enabled: true,
      scope_group: "agents",
      label: "Garden Calendar",
    });

    scheduler.seedSchedule({
      job_type: "agent.portfolio-monitor",
      input: { agent_id: "portfolio-monitor" },
      cron_expression: "0 9 * * 1-5",
      next_fire_at: futureFire,
      enabled: true,
      scope_group: "agents",
      label: "Portfolio Monitor",
    });

    const due = scheduler.getDueSchedules(new Date());
    expect(due.length).toBe(1);
    expect(due[0].job_type).toBe("agent.garden-calendar");

    // Mark fired and update next fire
    const scheduleId = due[0].schedule_id;
    scheduler.markFired(scheduleId);
    scheduler.updateNextFireAt(scheduleId, new Date(Date.now() + 7 * 24 * 3600_000).toISOString());

    // Should no longer be due
    const dueAfter = scheduler.getDueSchedules(new Date());
    expect(dueAfter.length).toBe(0);
  });

  it("disabled schedules are not returned as due", () => {
    const scheduler = new DbSchedulerStore(db);
    const pastFire = new Date(Date.now() - 60_000).toISOString();

    scheduler.seedSchedule({
      job_type: "agent.disabled-agent",
      input: { agent_id: "disabled-agent" },
      cron_expression: "0 0 * * *",
      next_fire_at: pastFire,
      enabled: false,
      scope_group: "agents",
      label: "Disabled",
    });

    const due = scheduler.getDueSchedules(new Date());
    expect(due.length).toBe(0);
  });
});

// ── Evidence-Backed Model Routing ─────────────────────────────────────────────

describe("E2E: Evidence-Backed Model Routing", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("selectByProfileWithEvidence prefers benchmarked models", () => {
    const models: ModelInfo[] = [
      { id: "llama3:8b", runtime: "ollama", size_class: "medium", capabilities: ["chat"] },
      { id: "mistral:7b", runtime: "ollama", size_class: "medium", capabilities: ["chat"] },
    ];

    // mistral has lower latency in benchmarks
    const benchmarks: ModelBenchmarkData[] = [
      { model_id: "llama3:8b", latency_ms: 500, tokens_per_sec: 20, json_success: 0.8, tool_call_success: 0.7 },
      { model_id: "mistral:7b", latency_ms: 200, tokens_per_sec: 40, json_success: 0.9, tool_call_success: 0.6 },
    ];

    const fastest = selectByProfileWithEvidence(
      models,
      { objective: "classify", preferences: { prioritize_speed: true } },
      benchmarks,
    );

    // Should pick mistral (lower latency)
    expect(fastest).toBeTruthy();
    expect(fastest!.id).toBe("mistral:7b");
  });

  it("loadAllBenchmarks aggregates across benchmark types", () => {
    const now = new Date().toISOString();

    // Insert different benchmark types for two models
    const insertBench = db.prepare(`
      INSERT INTO model_benchmarks (benchmark_id, model_id, runtime, benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, notes_json, measured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
    `);

    insertBench.run(randomUUID(), "model-a", "ollama", "latency", 300, 25, null, null, now);
    insertBench.run(randomUUID(), "model-a", "ollama", "json_reliability", 400, null, 0.85, null, now);
    insertBench.run(randomUUID(), "model-a", "ollama", "tool_call", 350, null, null, 0.9, now);
    insertBench.run(randomUUID(), "model-b", "lmstudio", "latency", 200, 40, null, null, now);

    const results = loadAllBenchmarks(db);
    expect(results.length).toBe(2);

    const modelA = results.find(r => r.model_id === "model-a");
    expect(modelA).toBeTruthy();
    expect(modelA!.latency_ms).toBe(300);
    expect(modelA!.json_success).toBe(0.85);
    expect(modelA!.tool_call_success).toBe(0.9);

    const modelB = results.find(r => r.model_id === "model-b");
    expect(modelB).toBeTruthy();
    expect(modelB!.latency_ms).toBe(200);
    expect(modelB!.json_success).toBeNull();
  });

  it("loadAllBenchmarks filters by age", () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    const recentDate = new Date().toISOString();

    const insertBench = db.prepare(`
      INSERT INTO model_benchmarks (benchmark_id, model_id, runtime, benchmark_type, latency_ms, tokens_per_sec, json_success, tool_call_success, notes_json, measured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
    `);

    insertBench.run(randomUUID(), "old-model", "ollama", "latency", 500, 10, null, null, oldDate);
    insertBench.run(randomUUID(), "new-model", "ollama", "latency", 200, 40, null, null, recentDate);

    // Default maxAge is 24h — should only get new-model
    const results = loadAllBenchmarks(db);
    expect(results.length).toBe(1);
    expect(results[0].model_id).toBe("new-model");
  });

  it("model registry uses composite PK (runtime, model_id)", () => {
    const ollamaModels: ModelInfo[] = [
      { id: "llama3:8b", runtime: "ollama", size_class: "medium", capabilities: ["chat"] },
    ];

    const lmstudioModels: ModelInfo[] = [
      { id: "llama3:8b", runtime: "lmstudio", size_class: "medium", capabilities: ["chat"] },
    ];

    // Same model name, different runtimes — should not collide
    syncModelRegistry(db, ollamaModels);
    syncModelRegistry(db, lmstudioModels);

    const registered = loadRegisteredModels(db);
    const llama = registered.filter(m => m.id === "llama3:8b");
    expect(llama.length).toBe(2);
    expect(llama.map(m => m.runtime).sort()).toEqual(["lmstudio", "ollama"]);
  });
});

// ── Action Classifier ─────────────────────────────────────────────────────────

describe("E2E: Action Classifier", () => {
  it("classifies read-only actions correctly", () => {
    expect(isReadOnlyAction("web.search")).toBe(true);
    expect(isReadOnlyAction("crm.list")).toBe(true);
    expect(isReadOnlyAction("email.search")).toBe(true);
    expect(isReadOnlyAction("crm.get")).toBe(true);
    expect(isReadOnlyAction("system.stats")).toBe(true);
    expect(isReadOnlyAction("document.analyze")).toBe(true);
    expect(isReadOnlyAction("inference.classify")).toBe(true);
    expect(isReadOnlyAction("web.fetch")).toBe(true);
    expect(isReadOnlyAction("crm.query")).toBe(true);
  });

  it("classifies mutating actions correctly", () => {
    expect(isReadOnlyAction("email.send")).toBe(false);
    expect(isReadOnlyAction("crm.update")).toBe(false);
    expect(isReadOnlyAction("crm.create")).toBe(false);
    expect(isReadOnlyAction("document.generate")).toBe(false);
    expect(isReadOnlyAction("browser.navigate")).toBe(false);
    expect(isReadOnlyAction("social.post")).toBe(false);
    expect(isReadOnlyAction("trade.execute")).toBe(false);
  });

  it("defaults unknown actions to mutating (safe default)", () => {
    expect(isReadOnlyAction("unknown.action")).toBe(false);
    expect(isReadOnlyAction("custom.something")).toBe(false);
  });
});

// ── Approval Bridge with Run Integration ──────────────────────────────────────

describe("E2E: Approval Bridge + Run Integration", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("run transitions through approval gate correctly", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");

    // Start executing
    store.transition(runId, "test-agent", "executing", "step_started");

    // Hit approval gate
    store.transition(runId, "test-agent", "awaiting_approval", "approval_requested");
    expect(store.getStatus(runId)).toBe("awaiting_approval");

    // Create approval
    const approvalId = requestApproval(db, {
      agent_id: "test-agent",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: "Send email to client",
    });

    // Verify pending
    const pending = listApprovals(db, "pending");
    expect(pending.some(a => a.id === approvalId)).toBe(true);

    // Resolve approval
    resolveApproval(db, approvalId, "approved", "admin");

    // Resume execution
    store.transition(runId, "test-agent", "executing", "step_started");
    store.transition(runId, "test-agent", "completed", "run_completed");
    expect(store.getStatus(runId)).toBe("completed");

    // Verify approval resolved
    const all = listApprovals(db);
    const resolved = all.find(a => a.id === approvalId);
    expect(resolved!.status).toBe("approved");
  });

  it("run fails on approval timeout", () => {
    const store = new RunStore(db);
    const runId = store.startRun("test-agent");

    store.transition(runId, "test-agent", "executing", "step_started");
    store.transition(runId, "test-agent", "awaiting_approval", "approval_requested");

    // Simulate timeout by directly transitioning to failed
    store.transition(runId, "test-agent", "failed", "run_failed", {
      details: { reason: "approval_timeout" },
    });

    expect(store.getStatus(runId)).toBe("failed");
    const run = store.getRun(runId);
    expect(run!.error).toBe("approval_timeout");
  });
});

// ── Config Validation ─────────────────────────────────────────────────────────

describe("E2E: Config Validation", () => {
  it("validates production-ready config", () => {
    const config: JarvisRuntimeConfig = {
      lmstudio_url: "http://localhost:1234",
      default_model: "auto",
      adapter_mode: "real",
      poll_interval_ms: 60000,
      trigger_poll_ms: 10000,
      max_concurrent: 2,
      log_level: "info",
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects mock mode with very aggressive polling", () => {
    const config = {
      lmstudio_url: "http://localhost:1234",
      default_model: "auto",
      adapter_mode: "mock",
      poll_interval_ms: 50, // too aggressive
      trigger_poll_ms: 10000,
      max_concurrent: 2,
      log_level: "info",
    } as unknown as JarvisRuntimeConfig;

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
  });

  it("rejects negative max_concurrent", () => {
    const config = {
      lmstudio_url: "http://localhost:1234",
      default_model: "auto",
      adapter_mode: "mock",
      poll_interval_ms: 60000,
      trigger_poll_ms: 10000,
      max_concurrent: -1,
      log_level: "info",
    } as unknown as JarvisRuntimeConfig;

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
  });
});

// ── Multi-Run Concurrency ─────────────────────────────────────────────────────

describe("E2E: Multi-Run Concurrency", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("multiple runs can exist simultaneously in different states", () => {
    const store = new RunStore(db);

    const r1 = store.startRun("agent-a", "schedule");
    const r2 = store.startRun("agent-b", "manual");
    const r3 = store.startRun("agent-c", "schedule");

    // Put them in different states
    store.transition(r1, "agent-a", "executing", "step_started");
    store.transition(r2, "agent-b", "executing", "step_started");
    store.transition(r2, "agent-b", "completed", "run_completed");
    // r3 stays in planning

    expect(store.getStatus(r1)).toBe("executing");
    expect(store.getStatus(r2)).toBe("completed");
    expect(store.getStatus(r3)).toBe("planning");

    // Recent runs should show all 3
    const recent = store.getRecentRuns(10);
    expect(recent.length).toBe(3);
  });

  it("getRecentRuns returns most recent first", () => {
    const store = new RunStore(db);

    const r1 = store.startRun("agent-a");
    const r2 = store.startRun("agent-b");
    const r3 = store.startRun("agent-c");

    const recent = store.getRecentRuns(10);
    expect(recent.length).toBe(3);
    // Most recent (r3) should be first
    expect(recent[0].run_id).toBe(r3);
    expect(recent[2].run_id).toBe(r1);
  });
});
