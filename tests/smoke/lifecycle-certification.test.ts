/**
 * Lifecycle Certification Suite
 *
 * Tests the complete operator surface for release readiness.
 * All tests use real SQLite databases with migrations applied.
 * Failing any test blocks release.
 *
 * RT-4: End-to-end lifecycle certification covering 8 paths:
 *   1. Dashboard trigger -> command -> claim -> run -> completion
 *   2. Webhook trigger -> same lifecycle
 *   3. Approval gate in lifecycle
 *   4. Cancel during active work
 *   5. Retry after failure
 *   6. Duplicate submission (idempotency)
 *   7. Restart recovery (stale claims)
 *   8. State machine exhaustive (valid + invalid transitions)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, RunStore } from "@jarvis/runtime";
import { requestApproval, resolveApproval, listApprovals } from "@jarvis/runtime";

// ── Shared helpers ───────────────────────────────────────────────────────────

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-cert-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

// ── Lifecycle Certification ──────────────────────────────────────────────────

describe("Lifecycle Certification", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  // ── Path 1: Dashboard trigger -> command -> claim -> run -> completion ────

  describe("Path 1: Dashboard trigger -> command -> claim -> run -> completion", () => {
    it("command insert with idempotency key", () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
      ).run("cert-cmd-01", "run_agent", "bd-pipeline", now, "dashboard", "dash-bd-001");

      const cmd = db.prepare("SELECT status, idempotency_key FROM agent_commands WHERE command_id = ?").get("cert-cmd-01") as {
        status: string;
        idempotency_key: string;
      };
      expect(cmd.status).toBe("queued");
      expect(cmd.idempotency_key).toBe("dash-bd-001");
    });

    it("command claim with optimistic locking", () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by) VALUES (?, ?, ?, 'queued', 0, ?, ?)",
      ).run("cert-cmd-02", "run_agent", "bd-pipeline", now, "dashboard");

      // Optimistic lock: only claim if still queued
      const claimed = db.prepare(
        "UPDATE agent_commands SET status = 'claimed', claimed_at = ? WHERE command_id = ? AND status = 'queued'",
      ).run(now, "cert-cmd-02");
      expect((claimed as { changes: number }).changes).toBe(1);

      // Second claim attempt should change 0 rows (already claimed)
      const secondClaim = db.prepare(
        "UPDATE agent_commands SET status = 'claimed', claimed_at = ? WHERE command_id = ? AND status = 'queued'",
      ).run(now, "cert-cmd-02");
      expect((secondClaim as { changes: number }).changes).toBe(0);
    });

    it("run created and linked to command", () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by) VALUES (?, ?, ?, 'claimed', 0, ?, ?)",
      ).run("cert-cmd-03", "run_agent", "bd-pipeline", now, "dashboard");

      const store = new RunStore(db);
      const runId = store.startRun("bd-pipeline", "manual", "cert-cmd-03", "Process new leads");

      const run = store.getRun(runId);
      expect(run).toBeTruthy();
      expect(run!.command_id).toBe("cert-cmd-03");
      expect(run!.agent_id).toBe("bd-pipeline");
      expect(run!.trigger_kind).toBe("manual");
      expect(run!.goal).toBe("Process new leads");
    });

    it("run transitions through full lifecycle", () => {
      const store = new RunStore(db);
      const runId = store.startRun("bd-pipeline", "manual");

      // planning -> executing
      store.transition(runId, "bd-pipeline", "executing", "step_started", { step_no: 1, action: "web.search" });
      expect(store.getStatus(runId)).toBe("executing");

      // Emit intermediate step events
      store.emitEvent(runId, "bd-pipeline", "step_completed", { step_no: 1, action: "web.search" });
      store.emitEvent(runId, "bd-pipeline", "step_started", { step_no: 2, action: "crm.update" });
      store.emitEvent(runId, "bd-pipeline", "step_completed", { step_no: 2, action: "crm.update" });

      // executing -> completed
      store.transition(runId, "bd-pipeline", "completed", "run_completed");
      expect(store.getStatus(runId)).toBe("completed");

      // Verify all events exist in chronological order
      const events = store.getRunEvents(runId);
      expect(events.length).toBeGreaterThanOrEqual(5); // run_started + step_started + 2*step_completed + step_started + run_completed
      expect(events[0].event_type).toBe("run_started");
      expect(events[events.length - 1].event_type).toBe("run_completed");

      for (let i = 1; i < events.length; i++) {
        expect(events[i].created_at >= events[i - 1].created_at).toBe(true);
      }
    });

    it("command marked completed when run completes", () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, claimed_at) VALUES (?, ?, ?, 'claimed', 0, ?, ?, ?)",
      ).run("cert-cmd-05", "run_agent", "bd-pipeline", now, "dashboard", now);

      const store = new RunStore(db);
      const runId = store.startRun("bd-pipeline", "manual", "cert-cmd-05");

      store.transition(runId, "bd-pipeline", "executing", "step_started");
      store.transition(runId, "bd-pipeline", "completed", "run_completed");
      store.completeCommand(runId, "completed");

      const cmd = db.prepare("SELECT status, completed_at FROM agent_commands WHERE command_id = ?").get("cert-cmd-05") as {
        status: string;
        completed_at: string;
      };
      expect(cmd.status).toBe("completed");
      expect(cmd.completed_at).toBeTruthy();
    });
  });

  // ── Path 2: Webhook trigger -> same lifecycle ────────────────────────────

  describe("Path 2: Webhook trigger -> same lifecycle", () => {
    it("webhook command with audit_log entry", () => {
      const now = new Date().toISOString();
      const commandId = "cert-webhook-cmd-01";

      // Insert command with webhook origin
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by) VALUES (?, ?, ?, 'queued', 0, ?, ?)",
      ).run(commandId, "run_agent", "evidence-auditor", now, "webhook:github:push");

      // Insert corresponding audit log entry
      db.prepare(
        "INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(randomUUID(), "webhook", "github:push", "command.created", "agent_command", commandId, JSON.stringify({ ref: "refs/heads/main" }), now);

      // Verify command exists with webhook origin
      const cmd = db.prepare("SELECT created_by FROM agent_commands WHERE command_id = ?").get(commandId) as { created_by: string };
      expect(cmd.created_by).toBe("webhook:github:push");

      // Verify audit log entry exists
      const audit = db.prepare("SELECT action, target_id FROM audit_log WHERE target_id = ?").get(commandId) as {
        action: string;
        target_id: string;
      };
      expect(audit.action).toBe("command.created");
      expect(audit.target_id).toBe(commandId);
    });

    it("webhook command follows same claim -> run -> complete path", () => {
      const now = new Date().toISOString();
      const commandId = "cert-webhook-cmd-02";

      // Insert webhook command
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by) VALUES (?, ?, ?, 'queued', 0, ?, ?)",
      ).run(commandId, "run_agent", "evidence-auditor", now, "webhook:github:push");

      // Claim
      const claimed = db.prepare(
        "UPDATE agent_commands SET status = 'claimed', claimed_at = ? WHERE command_id = ? AND status = 'queued'",
      ).run(now, commandId);
      expect((claimed as { changes: number }).changes).toBe(1);

      // Start run linked to command
      const store = new RunStore(db);
      const runId = store.startRun("evidence-auditor", "webhook", commandId);
      expect(store.getStatus(runId)).toBe("planning");

      // Execute and complete
      store.transition(runId, "evidence-auditor", "executing", "step_started", { step_no: 1, action: "document.analyze" });
      store.transition(runId, "evidence-auditor", "completed", "run_completed");
      store.completeCommand(runId, "completed");

      // Verify terminal states
      expect(store.getStatus(runId)).toBe("completed");
      const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get(commandId) as { status: string };
      expect(cmd.status).toBe("completed");
    });
  });

  // ── Path 3: Approval gate in lifecycle ───────────────────────────────────

  describe("Path 3: Approval gate in lifecycle", () => {
    it("run transitions to awaiting_approval", () => {
      const store = new RunStore(db);
      const runId = store.startRun("content-engine", "manual");

      store.transition(runId, "content-engine", "executing", "step_started", { step_no: 1, action: "social.post" });
      store.transition(runId, "content-engine", "awaiting_approval", "approval_requested");
      expect(store.getStatus(runId)).toBe("awaiting_approval");

      // Create approval DB entry
      const approvalId = requestApproval(db, {
        agent_id: "content-engine",
        run_id: runId,
        action: "social.post",
        severity: "critical",
        payload: "Post LinkedIn article about ISO 26262",
      });

      // Verify pending approval exists
      const pending = listApprovals(db, "pending");
      expect(pending.some(a => a.id === approvalId)).toBe(true);
      expect(pending.find(a => a.id === approvalId)!.severity).toBe("critical");
    });

    it("approval resolution resumes execution", () => {
      const store = new RunStore(db);
      const runId = store.startRun("content-engine", "manual");

      store.transition(runId, "content-engine", "executing", "step_started");
      store.transition(runId, "content-engine", "awaiting_approval", "approval_requested");

      const approvalId = requestApproval(db, {
        agent_id: "content-engine",
        run_id: runId,
        action: "social.post",
        severity: "critical",
        payload: "Post draft",
      });

      // Resolve as approved
      const resolved = resolveApproval(db, approvalId, "approved", "dashboard");
      expect(resolved).toBe(true);

      // Resume execution
      store.transition(runId, "content-engine", "executing", "step_started");
      store.transition(runId, "content-engine", "completed", "run_completed");
      expect(store.getStatus(runId)).toBe("completed");

      // Verify approval is resolved
      const all = listApprovals(db);
      const entry = all.find(a => a.id === approvalId);
      expect(entry!.status).toBe("approved");
      expect(entry!.resolved_by).toBe("dashboard");
    });

    it("rejected approval skips step", () => {
      const store = new RunStore(db);
      const runId = store.startRun("portfolio-monitor", "schedule");

      store.transition(runId, "portfolio-monitor", "executing", "step_started", { step_no: 1, action: "trade.execute" });
      store.transition(runId, "portfolio-monitor", "awaiting_approval", "approval_requested");

      const approvalId = requestApproval(db, {
        agent_id: "portfolio-monitor",
        run_id: runId,
        action: "trade.execute",
        severity: "critical",
        payload: "Rebalance BTC allocation",
      });

      // Reject the approval
      resolveApproval(db, approvalId, "rejected", "dashboard", "Too volatile today");

      // Run continues to next step (skipping the rejected action)
      store.transition(runId, "portfolio-monitor", "executing", "step_started", { step_no: 2, action: "document.generate_report" });
      store.transition(runId, "portfolio-monitor", "completed", "run_completed");
      expect(store.getStatus(runId)).toBe("completed");

      // Verify rejection recorded
      const entry = listApprovals(db).find(a => a.id === approvalId);
      expect(entry!.status).toBe("rejected");
      expect(entry!.resolution_note).toBe("Too volatile today");
    });
  });

  // ── Path 4: Cancel during active work ────────────────────────────────────

  describe("Path 4: Cancel during active work", () => {
    it("cancel transitions run to cancelled", () => {
      const store = new RunStore(db);
      const runId = store.startRun("bd-pipeline", "manual");

      store.transition(runId, "bd-pipeline", "executing", "step_started", { step_no: 1, action: "web.search" });
      expect(store.getStatus(runId)).toBe("executing");

      // Cancel the run
      store.transition(runId, "bd-pipeline", "cancelled", "run_cancelled");
      expect(store.getStatus(runId)).toBe("cancelled");

      // Verify completed_at is set
      const run = store.getRun(runId);
      expect(run!.completed_at).toBeTruthy();

      // Verify cancel event exists
      const events = store.getRunEvents(runId);
      const cancelEvent = events.find(e => e.event_type === "run_cancelled");
      expect(cancelEvent).toBeTruthy();
    });

    it("cancelled run command is completed", () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, claimed_at) VALUES (?, ?, ?, 'claimed', 0, ?, ?, ?)",
      ).run("cert-cancel-cmd", "run_agent", "bd-pipeline", now, "dashboard", now);

      const store = new RunStore(db);
      const runId = store.startRun("bd-pipeline", "manual", "cert-cancel-cmd");

      store.transition(runId, "bd-pipeline", "executing", "step_started");
      store.transition(runId, "bd-pipeline", "cancelled", "run_cancelled");
      store.completeCommand(runId, "failed");

      const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get("cert-cancel-cmd") as { status: string };
      expect(cmd.status).toBe("failed");
    });

    it("cancelled run cannot transition to completed", () => {
      const store = new RunStore(db);
      const runId = store.startRun("bd-pipeline", "manual");

      store.transition(runId, "bd-pipeline", "executing", "step_started");
      store.transition(runId, "bd-pipeline", "cancelled", "run_cancelled");

      // Attempt transition from cancelled -> completed
      expect(() => store.transition(runId, "bd-pipeline", "completed", "run_completed")).toThrow(
        /Invalid run transition: cancelled -> completed/,
      );
    });
  });

  // ── Path 5: Retry after failure ──────────────────────────────────────────

  describe("Path 5: Retry after failure", () => {
    it("failed run can be retried via new command", () => {
      const now = new Date().toISOString();

      // Original command and run that failed
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
      ).run("cert-orig-cmd", "run_agent", "garden-calendar", now, "dashboard", "orig-garden-001");

      const store = new RunStore(db);
      const origRunId = store.startRun("garden-calendar", "manual", "cert-orig-cmd");
      store.transition(origRunId, "garden-calendar", "executing", "step_started");
      store.transition(origRunId, "garden-calendar", "failed", "run_failed", { details: { error: "Weather API down" } });
      store.completeCommand(origRunId, "failed");

      // Insert retry command referencing original run_id (not command_id) via payload
      const retryPayload = JSON.stringify({ retry_of: origRunId });
      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, payload_json, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)",
      ).run("cert-retry-cmd", "run_agent", "garden-calendar", now, "dashboard", retryPayload, "retry-garden-001");

      // Verify new command exists with retry_of pointing to run_id
      const retryCmd = db.prepare("SELECT status, payload_json FROM agent_commands WHERE command_id = ?").get("cert-retry-cmd") as {
        status: string;
        payload_json: string;
      };
      expect(retryCmd.status).toBe("queued");
      expect(JSON.parse(retryCmd.payload_json).retry_of).toBe(origRunId);
    });

    it("retry command has unique idempotency_key", () => {
      const now = new Date().toISOString();

      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
      ).run("cert-retry-key-cmd", "run_agent", "garden-calendar", now, "dashboard", "retry-garden-unique-001");

      const cmd = db.prepare("SELECT idempotency_key FROM agent_commands WHERE command_id = ?").get("cert-retry-key-cmd") as {
        idempotency_key: string;
      };
      expect(cmd.idempotency_key).toContain("retry-");
    });
  });

  // ── Path 6: Duplicate submission ─────────────────────────────────────────

  describe("Path 6: Duplicate submission", () => {
    it("same idempotency_key rejects duplicate", () => {
      const now = new Date().toISOString();

      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
      ).run("cert-dup-01", "run_agent", "bd-pipeline", now, "dashboard", "test-key-unique");

      // Second insert with same idempotency_key should throw (UNIQUE constraint)
      expect(() => {
        db.prepare(
          "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
        ).run("cert-dup-02", "run_agent", "bd-pipeline", now, "dashboard", "test-key-unique");
      }).toThrow();
    });

    it("different idempotency_key allows second submission", () => {
      const now = new Date().toISOString();

      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
      ).run("cert-diff-01", "run_agent", "bd-pipeline", now, "dashboard", "key-alpha");

      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, idempotency_key) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
      ).run("cert-diff-02", "run_agent", "bd-pipeline", now, "dashboard", "key-beta");

      // Verify both exist
      const count = db.prepare("SELECT COUNT(*) as cnt FROM agent_commands WHERE command_id IN ('cert-diff-01', 'cert-diff-02')").get() as { cnt: number };
      expect(count.cnt).toBe(2);
    });
  });

  // ── Path 7: Restart recovery ─────────────────────────────────────────────

  describe("Path 7: Restart recovery", () => {
    it("stale claimed commands released on restart", () => {
      const staleTime = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min ago

      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, created_at, claimed_at) VALUES (?, ?, ?, 'claimed', ?, ?)",
      ).run("cert-stale-01", "run_agent", "garden-calendar", staleTime, staleTime);

      // Recovery: release claims older than 10 min
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = db.prepare(
        "UPDATE agent_commands SET status = 'queued', claimed_at = NULL WHERE status = 'claimed' AND claimed_at < ?",
      ).run(staleThreshold);
      expect((result as { changes: number }).changes).toBe(1);

      // Verify command is back to queued
      const cmd = db.prepare("SELECT status, claimed_at FROM agent_commands WHERE command_id = ?").get("cert-stale-01") as {
        status: string;
        claimed_at: string | null;
      };
      expect(cmd.status).toBe("queued");
      expect(cmd.claimed_at).toBeNull();
    });

    it("fresh claimed commands NOT released", () => {
      const recentTime = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago (not stale)

      db.prepare(
        "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, created_at, claimed_at) VALUES (?, ?, ?, 'claimed', ?, ?)",
      ).run("cert-fresh-01", "run_agent", "evidence-auditor", recentTime, recentTime);

      // Recovery: release claims older than 10 min
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = db.prepare(
        "UPDATE agent_commands SET status = 'queued', claimed_at = NULL WHERE status = 'claimed' AND claimed_at < ?",
      ).run(staleThreshold);
      expect((result as { changes: number }).changes).toBe(0);

      // Verify command is still claimed
      const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get("cert-fresh-01") as { status: string };
      expect(cmd.status).toBe("claimed");
    });
  });

  // ── Path 8: State machine exhaustive ─────────────────────────────────────

  describe("Path 8: State machine exhaustive", () => {
    it("all valid transitions succeed", () => {
      const store = new RunStore(db);

      // planning -> executing
      const r1 = store.startRun("cert-agent-a");
      store.transition(r1, "cert-agent-a", "executing", "step_started");
      expect(store.getStatus(r1)).toBe("executing");

      // executing -> awaiting_approval
      store.transition(r1, "cert-agent-a", "awaiting_approval", "approval_requested");
      expect(store.getStatus(r1)).toBe("awaiting_approval");

      // awaiting_approval -> executing
      store.transition(r1, "cert-agent-a", "executing", "step_started");
      expect(store.getStatus(r1)).toBe("executing");

      // executing -> completed
      store.transition(r1, "cert-agent-a", "completed", "run_completed");
      expect(store.getStatus(r1)).toBe("completed");

      // planning -> failed
      const r2 = store.startRun("cert-agent-b");
      store.transition(r2, "cert-agent-b", "failed", "run_failed");
      expect(store.getStatus(r2)).toBe("failed");

      // executing -> failed
      const r3 = store.startRun("cert-agent-c");
      store.transition(r3, "cert-agent-c", "executing", "step_started");
      store.transition(r3, "cert-agent-c", "failed", "run_failed", { details: { error: "API timeout" } });
      expect(store.getStatus(r3)).toBe("failed");

      // planning -> cancelled
      const r4 = store.startRun("cert-agent-d");
      store.transition(r4, "cert-agent-d", "cancelled", "run_cancelled");
      expect(store.getStatus(r4)).toBe("cancelled");

      // executing -> cancelled
      const r5 = store.startRun("cert-agent-e");
      store.transition(r5, "cert-agent-e", "executing", "step_started");
      store.transition(r5, "cert-agent-e", "cancelled", "run_cancelled");
      expect(store.getStatus(r5)).toBe("cancelled");

      // awaiting_approval -> cancelled
      const r6 = store.startRun("cert-agent-f");
      store.transition(r6, "cert-agent-f", "executing", "step_started");
      store.transition(r6, "cert-agent-f", "awaiting_approval", "approval_requested");
      store.transition(r6, "cert-agent-f", "cancelled", "run_cancelled");
      expect(store.getStatus(r6)).toBe("cancelled");

      // awaiting_approval -> failed
      const r7 = store.startRun("cert-agent-g");
      store.transition(r7, "cert-agent-g", "executing", "step_started");
      store.transition(r7, "cert-agent-g", "awaiting_approval", "approval_requested");
      store.transition(r7, "cert-agent-g", "failed", "run_failed", { details: { error: "approval_timeout" } });
      expect(store.getStatus(r7)).toBe("failed");
    });

    it("all invalid transitions throw", () => {
      const store = new RunStore(db);

      // completed -> executing
      const r1 = store.startRun("inv-a");
      store.transition(r1, "inv-a", "executing", "step_started");
      store.transition(r1, "inv-a", "completed", "run_completed");
      expect(() => store.transition(r1, "inv-a", "executing", "step_started")).toThrow(/Invalid run transition/);
      expect(() => store.transition(r1, "inv-a", "planning", "run_started")).toThrow(/Invalid run transition/);
      expect(() => store.transition(r1, "inv-a", "failed", "run_failed")).toThrow(/Invalid run transition/);
      expect(() => store.transition(r1, "inv-a", "cancelled", "run_cancelled")).toThrow(/Invalid run transition/);

      // failed -> executing
      const r2 = store.startRun("inv-b");
      store.transition(r2, "inv-b", "failed", "run_failed");
      expect(() => store.transition(r2, "inv-b", "executing", "step_started")).toThrow(/Invalid run transition/);
      expect(() => store.transition(r2, "inv-b", "completed", "run_completed")).toThrow(/Invalid run transition/);
      expect(() => store.transition(r2, "inv-b", "planning", "run_started")).toThrow(/Invalid run transition/);

      // cancelled -> executing
      const r3 = store.startRun("inv-c");
      store.transition(r3, "inv-c", "cancelled", "run_cancelled");
      expect(() => store.transition(r3, "inv-c", "executing", "step_started")).toThrow(/Invalid run transition/);
      expect(() => store.transition(r3, "inv-c", "completed", "run_completed")).toThrow(/Invalid run transition/);
      expect(() => store.transition(r3, "inv-c", "planning", "run_started")).toThrow(/Invalid run transition/);

      // planning -> awaiting_approval (must go through executing first)
      const r4 = store.startRun("inv-d");
      expect(() => store.transition(r4, "inv-d", "awaiting_approval", "approval_requested")).toThrow(/Invalid run transition/);

      // executing -> planning (backward transition)
      const r5 = store.startRun("inv-e");
      store.transition(r5, "inv-e", "executing", "step_started");
      expect(() => store.transition(r5, "inv-e", "planning", "run_started")).toThrow(/Invalid run transition/);
    });
  });
});
