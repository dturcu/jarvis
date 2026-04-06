/**
 * Audit log helpers for the dashboard API.
 *
 * Writes to the audit_log table in runtime.db for all security-sensitive actions.
 */

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import { join } from "node:path";
import type { AuthenticatedRequest } from "./auth.js";

function getDb(): DatabaseSync {
  const db = new DatabaseSync(join(os.homedir(), ".jarvis", "runtime.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

/**
 * Write an audit log entry.
 *
 * @param actor - Who performed the action (e.g., "dashboard:admin", "webhook:github")
 * @param action - What was done (e.g., "approval.approved", "settings.updated")
 * @param target - What was affected (e.g., "approval:abc-123", "agent:bd-pipeline")
 * @param payload - Additional context
 */
export function writeAuditLog(
  actorType: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  payload?: Record<string, unknown>,
): void {
  let db: DatabaseSync | null = null;
  try {
    db = getDb();
    db.prepare(`
      INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      actorType,
      actorId,
      action,
      targetType,
      targetId,
      payload ? JSON.stringify(payload) : null,
      new Date().toISOString(),
    );
  } catch {
    // Non-fatal — audit should never block the operation
  } finally {
    try { db?.close(); } catch { /* best-effort */ }
  }
}

/**
 * Extract actor info from an authenticated request.
 */
export function getActor(req: AuthenticatedRequest): { type: string; id: string } {
  const user = (req as AuthenticatedRequest).user;
  if (user) {
    return { type: "dashboard", id: `${user.role}:${user.token_prefix}` };
  }
  return { type: "dashboard", id: "anonymous" };
}
