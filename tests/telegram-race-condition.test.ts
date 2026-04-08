import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { claimUnnotifiedPending, getUnnotifiedPending, markNotified } from "../packages/jarvis-telegram/src/approvals.js";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      approval_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      requested_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      run_id TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'info',
      resolved_at TEXT,
      resolved_by TEXT,
      resolution_note TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      notification_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      delivered_at TEXT
    )
  `);

  return db;
}

function seedApproval(db: DatabaseSync, id?: string): string {
  const approvalId = id ?? randomUUID();
  db.prepare(`
    INSERT INTO approvals (approval_id, agent_id, action, payload_json, requested_at, status, run_id, severity)
    VALUES (?, 'test-agent', 'email.send', '{"to":"test@example.com"}', ?, 'pending', 'run-1', 'critical')
  `).run(approvalId, new Date().toISOString());
  return approvalId;
}

describe("Telegram approval race condition", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    try { db.close(); } catch {}
  });

  it("getUnnotifiedPending returns approvals without notifications", () => {
    const id = seedApproval(db);
    const results = getUnnotifiedPending(db);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(id);
  });

  it("getUnnotifiedPending excludes already-notified approvals", () => {
    const id = seedApproval(db);
    markNotified(db, id);
    const results = getUnnotifiedPending(db);
    expect(results).toHaveLength(0);
  });

  it("claimUnnotifiedPending atomically claims and marks entries", () => {
    const id1 = seedApproval(db);
    const id2 = seedApproval(db);

    const claimed = claimUnnotifiedPending(db);
    expect(claimed).toHaveLength(2);
    expect(claimed.map(c => c.id).sort()).toEqual([id1, id2].sort());

    // Second call should return nothing — already claimed
    const secondClaim = claimUnnotifiedPending(db);
    expect(secondClaim).toHaveLength(0);
  });

  it("claimUnnotifiedPending prevents double-claiming", () => {
    seedApproval(db);
    seedApproval(db);
    seedApproval(db);

    // Simulate two concurrent claims on the same DB
    const claim1 = claimUnnotifiedPending(db);
    const claim2 = claimUnnotifiedPending(db);

    // All entries should be claimed exactly once
    expect(claim1.length + claim2.length).toBe(3);
    // Second claim should get 0 since first already inserted notification rows
    expect(claim2).toHaveLength(0);
  });

  it("claimUnnotifiedPending does not affect already-notified approvals", () => {
    const id1 = seedApproval(db);
    const id2 = seedApproval(db);

    // Manually notify id1
    markNotified(db, id1);

    const claimed = claimUnnotifiedPending(db);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(id2);
  });

  it("claimUnnotifiedPending returns empty on DB error", () => {
    db.close();
    // Should not throw, just return empty
    const noopDb = createTestDb();
    // Close it to simulate error on next call
    noopDb.close();
    // claimUnnotifiedPending opens its own db via the function parameter,
    // so we test with a closed db — the BEGIN IMMEDIATE should fail gracefully
    const result = claimUnnotifiedPending(noopDb);
    expect(result).toEqual([]);
  });
});
