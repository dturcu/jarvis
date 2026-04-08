/**
 * Convergence session path smoke tests.
 *
 * Proves that the Telegram command mapper and notification dispatcher
 * work end-to-end through the session convergence path.
 *
 * Direct source imports are used (not @jarvis/runtime barrel) to avoid
 * pulling in @opentelemetry transitive dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Direct source imports — avoids @jarvis/runtime barrel (@opentelemetry issue)
import { mapTelegramCommandToSession } from "../../packages/jarvis-telegram/src/session-adapter.js";
import {
  createNotificationDispatcher,
  writeTelegramQueue,
} from "../../packages/jarvis-runtime/src/notify.js";
import { runMigrations } from "../../packages/jarvis-runtime/src/migrations/runner.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(
    os.tmpdir(),
    `jarvis-convergence-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
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

// ─── Test 1: Telegram command mapping ──────────────────────────────────────

describe("Convergence: mapTelegramCommandToSession", () => {
  it("handles all known commands", () => {
    // Simple commands
    expect(mapTelegramCommandToSession("/status")).toEqual({ kind: "status" });
    expect(mapTelegramCommandToSession("/crm")).toEqual({ kind: "crm" });
    expect(mapTelegramCommandToSession("/help")).toEqual({ kind: "help" });

    // Approval commands with arguments
    expect(mapTelegramCommandToSession("/approve abc123")).toEqual({
      kind: "approve",
      shortId: "abc123",
    });
    expect(mapTelegramCommandToSession("/reject def456")).toEqual({
      kind: "reject",
      shortId: "def456",
    });

    // Agent trigger commands
    expect(mapTelegramCommandToSession("/proposal")).toEqual({
      kind: "agent_trigger",
      agentId: "proposal-engine",
      rawText: "/proposal",
    });
    expect(mapTelegramCommandToSession("/evidence")).toEqual({
      kind: "agent_trigger",
      agentId: "evidence-auditor",
      rawText: "/evidence",
    });
    expect(mapTelegramCommandToSession("/contract")).toEqual({
      kind: "agent_trigger",
      agentId: "contract-reviewer",
      rawText: "/contract",
    });
    expect(mapTelegramCommandToSession("/staffing")).toEqual({
      kind: "agent_trigger",
      agentId: "staffing-monitor",
      rawText: "/staffing",
    });
    expect(mapTelegramCommandToSession("/orchestrator")).toEqual({
      kind: "agent_trigger",
      agentId: "orchestrator",
      rawText: "/orchestrator",
    });
    expect(mapTelegramCommandToSession("/reflect")).toEqual({
      kind: "agent_trigger",
      agentId: "self-reflection",
      rawText: "/reflect",
    });
    expect(mapTelegramCommandToSession("/regulatory")).toEqual({
      kind: "agent_trigger",
      agentId: "regulatory-watch",
      rawText: "/regulatory",
    });
    expect(mapTelegramCommandToSession("/knowledge")).toEqual({
      kind: "agent_trigger",
      agentId: "knowledge-curator",
      rawText: "/knowledge",
    });

    // Free text (no leading slash)
    expect(mapTelegramCommandToSession("hello")).toEqual({
      kind: "free_text",
      text: "hello",
    });

    // Unknown command (slash prefix but not in the map)
    expect(mapTelegramCommandToSession("/unknown_cmd")).toEqual({
      kind: "unknown",
      command: "/unknown_cmd",
    });
  });
});

// ─── Test 2: Notification dispatcher — session mode ────────────────────────

describe("Convergence: Notification dispatcher", () => {
  it("session mode calls sessionSend", async () => {
    const sessionSend = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createNotificationDispatcher({
      channel: "session",
      sessionSend,
    });

    expect(dispatcher.channel).toBe("session");

    await dispatcher.notify("bd-pipeline", "New lead detected");

    expect(sessionSend).toHaveBeenCalledOnce();
    const sentText = sessionSend.mock.calls[0][0] as string;
    expect(sentText).toContain("BD-PIPELINE");
    expect(sentText).toContain("New lead detected");
  });

  // ─── Test 3: both mode writes DB and calls session ─────────────────────

  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("both mode writes DB and calls session", async () => {
    const sessionSend = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createNotificationDispatcher({
      channel: "both",
      sessionSend,
    });

    expect(dispatcher.channel).toBe("both");

    await dispatcher.notify("evidence-auditor", "Gap matrix ready", db);

    // Session callback should have fired
    expect(sessionSend).toHaveBeenCalledOnce();
    const sentText = sessionSend.mock.calls[0][0] as string;
    expect(sentText).toContain("EVIDENCE-AUDITOR");
    expect(sentText).toContain("Gap matrix ready");

    // DB row should also exist
    const rows = db.prepare(
      "SELECT * FROM notifications WHERE channel = 'telegram'",
    ).all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    const payload = JSON.parse(rows[0].payload_json as string);
    expect(payload.agent).toBe("evidence-auditor");
    expect(payload.message).toBe("Gap matrix ready");
  });

  // ─── Test 4: session fallback to DB on send failure ────────────────────

  it("session fallback to DB on send failure", async () => {
    const sessionSend = vi.fn().mockRejectedValue(new Error("network timeout"));
    const dispatcher = createNotificationDispatcher({
      channel: "session",
      sessionSend,
    });

    await dispatcher.notify("contract-reviewer", "Review complete", db);

    // sessionSend was called (and threw)
    expect(sessionSend).toHaveBeenCalledOnce();

    // Fallback: DB row should have been written
    const rows = db.prepare(
      "SELECT * FROM notifications WHERE channel = 'telegram'",
    ).all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    const payload = JSON.parse(rows[0].payload_json as string);
    expect(payload.agent).toBe("contract-reviewer");
    expect(payload.message).toBe("Review complete");
  });
});
