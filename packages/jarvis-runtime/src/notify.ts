import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Queue a notification for delivery (e.g., Telegram).
 *
 * Writes to the `notifications` table in runtime.db. The telegram-bot process
 * polls this table and delivers pending messages.
 *
 * Falls back to a no-op if no database is provided (e.g., in test mode).
 */
export function writeTelegramQueue(agentId: string, message: string, db?: DatabaseSync): void {
  if (!db) return;

  try {
    db.prepare(`
      INSERT INTO notifications (notification_id, channel, kind, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(
      randomUUID(),
      "telegram",
      "agent_notification",
      JSON.stringify({ agent: agentId, message }),
      new Date().toISOString(),
    );
  } catch {
    // Best-effort: don't crash if notifications table is missing or DB is closed
  }
}
