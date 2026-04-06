/**
 * E2: Multi-channel approval resolution tests.
 *
 * Verifies that approvals can be resolved from different channels (dashboard,
 * telegram), that idempotent re-resolution is handled, and that listApprovals
 * correctly filters by status.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations } from "@jarvis/runtime";
import { requestApproval, resolveApproval, listApprovals } from "@jarvis/runtime";

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-approval-ch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

describe("Approval: Multi-channel resolution", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("dashboard resolves approval with resolved_by='dashboard'", () => {
    const approvalId = requestApproval(db, {
      agent_id: "bd-pipeline",
      run_id: "run-dash-1",
      action: "email.send",
      severity: "critical",
      payload: "Send outreach email",
    });

    const result = resolveApproval(db, approvalId, "approved", "dashboard", "Approved via dashboard");
    expect(result).toBe(true);

    // Verify resolved_by is dashboard
    const all = listApprovals(db);
    const approval = all.find(a => a.id === approvalId);
    expect(approval).toBeTruthy();
    expect(approval!.status).toBe("approved");
    expect(approval!.resolved_by).toBe("dashboard");

    // Verify audit_log entry exists
    const auditRow = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'approval.approved' AND target_id = ?",
    ).get(approvalId) as Record<string, unknown> | undefined;
    expect(auditRow).toBeTruthy();
    expect(auditRow!.actor_id).toBe("dashboard");
  });

  it("telegram resolves approval with resolved_by='telegram'", () => {
    const approvalId = requestApproval(db, {
      agent_id: "content-engine",
      run_id: "run-tg-1",
      action: "publish_post",
      severity: "critical",
      payload: "Publish LinkedIn post",
    });

    const result = resolveApproval(db, approvalId, "approved", "telegram", "Approved via /approve command");
    expect(result).toBe(true);

    const all = listApprovals(db);
    const approval = all.find(a => a.id === approvalId);
    expect(approval).toBeTruthy();
    expect(approval!.status).toBe("approved");
    expect(approval!.resolved_by).toBe("telegram");

    // Verify audit_log entry exists with telegram actor
    const auditRow = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'approval.approved' AND target_id = ?",
    ).get(approvalId) as Record<string, unknown> | undefined;
    expect(auditRow).toBeTruthy();
    expect(auditRow!.actor_id).toBe("telegram");
  });

  it("already-resolved approval cannot be re-resolved (idempotent)", () => {
    const approvalId = requestApproval(db, {
      agent_id: "test-agent",
      run_id: "run-idem-1",
      action: "email.send",
      severity: "critical",
      payload: "Test payload",
    });

    // First resolution succeeds
    const firstResult = resolveApproval(db, approvalId, "approved", "dashboard");
    expect(firstResult).toBe(true);

    // Second resolution returns false (already resolved, no longer pending)
    const secondResult = resolveApproval(db, approvalId, "rejected", "telegram");
    expect(secondResult).toBe(false);

    // Verify status is still 'approved' (first resolution wins)
    const all = listApprovals(db);
    const approval = all.find(a => a.id === approvalId);
    expect(approval!.status).toBe("approved");
    expect(approval!.resolved_by).toBe("dashboard");
  });

  it("listApprovals filters by status correctly", () => {
    // Create 3 approvals with different eventual statuses
    const id1 = requestApproval(db, {
      agent_id: "agent-a",
      run_id: "run-1",
      action: "email.send",
      severity: "critical",
      payload: "Pending approval",
    });

    const id2 = requestApproval(db, {
      agent_id: "agent-b",
      run_id: "run-2",
      action: "publish_post",
      severity: "critical",
      payload: "Will be approved",
    });

    const id3 = requestApproval(db, {
      agent_id: "agent-c",
      run_id: "run-3",
      action: "trade_execute",
      severity: "critical",
      payload: "Will be rejected",
    });

    // Resolve two of them
    resolveApproval(db, id2, "approved", "dashboard");
    resolveApproval(db, id3, "rejected", "telegram");

    // Filter by pending — should only get id1
    const pending = listApprovals(db, "pending");
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(id1);

    // Filter by approved — should only get id2
    const approved = listApprovals(db, "approved");
    expect(approved.length).toBe(1);
    expect(approved[0].id).toBe(id2);

    // Filter by rejected — should only get id3
    const rejected = listApprovals(db, "rejected");
    expect(rejected.length).toBe(1);
    expect(rejected[0].id).toBe(id3);

    // No filter — should get all 3
    const all = listApprovals(db);
    expect(all.length).toBe(3);
  });

  it("approval resolution appears in audit_log with correct actor", () => {
    const approvalId = requestApproval(db, {
      agent_id: "contract-reviewer",
      run_id: "run-audit-1",
      action: "email.send",
      severity: "warning",
      payload: "Send contract review",
    });

    resolveApproval(db, approvalId, "approved", "admin-user", "Reviewed and approved");

    // Query audit_log for approval.approved action
    const auditRows = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'approval.approved' AND target_id = ?",
    ).all(approvalId) as Array<Record<string, unknown>>;

    expect(auditRows.length).toBe(1);
    const entry = auditRows[0];
    expect(entry.actor_type).toBe("user");
    expect(entry.actor_id).toBe("admin-user");
    expect(entry.target_type).toBe("approval");
    expect(entry.target_id).toBe(approvalId);

    const payload = JSON.parse(entry.payload_json as string);
    expect(payload.note).toBe("Reviewed and approved");
  });

  it("rejection appears in audit_log as approval.rejected", () => {
    const approvalId = requestApproval(db, {
      agent_id: "portfolio-monitor",
      run_id: "run-reject-1",
      action: "trade_execute",
      severity: "critical",
      payload: "Execute rebalance trade",
    });

    resolveApproval(db, approvalId, "rejected", "risk-officer", "Too risky");

    const auditRows = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'approval.rejected' AND target_id = ?",
    ).all(approvalId) as Array<Record<string, unknown>>;

    expect(auditRows.length).toBe(1);
    const entry = auditRows[0];
    expect(entry.actor_id).toBe("risk-officer");

    const payload = JSON.parse(entry.payload_json as string);
    expect(payload.note).toBe("Too risky");
  });
});
