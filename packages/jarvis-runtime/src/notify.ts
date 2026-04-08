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

// ─── Convergence: Unified Notification Dispatch ──────────────────────────────
// See ADR-PLATFORM-KERNEL-BOUNDARY.md and CONVERGENCE-ROADMAP.md.
// When JARVIS_TELEGRAM_MODE=session, notifications route through OpenClaw
// sessions instead of the legacy DB-poll-then-send path.

export type NotificationChannel = "telegram" | "session" | "both";

export type NotificationDispatcher = {
  /** Send a notification through the configured channel(s). */
  notify(agentId: string, message: string, db?: DatabaseSync): Promise<void>;
  /** Which channel is active. */
  channel: NotificationChannel;
};

/**
 * Create a notification dispatcher that routes through the appropriate channel.
 *
 * - "telegram" (default): writes to the notifications table (legacy path)
 * - "session": sends via OpenClaw session (convergence path)
 * - "both": writes to DB AND sends via session (transition/dual-write mode)
 */
export function createNotificationDispatcher(opts: {
  channel?: NotificationChannel;
  sessionSend?: (text: string) => Promise<void>;
}): NotificationDispatcher {
  const channel = opts.channel ?? "telegram";

  return {
    channel,
    async notify(agentId: string, message: string, db?: DatabaseSync): Promise<void> {
      const formatted = `[${agentId.toUpperCase()}]\n\n${message}`;

      if (channel === "telegram" || channel === "both") {
        writeTelegramQueue(agentId, message, db);
      }

      if ((channel === "session" || channel === "both") && opts.sessionSend) {
        try {
          await opts.sessionSend(formatted);
        } catch {
          // Session delivery failed — fall back to DB queue if not already written
          if (channel === "session") {
            writeTelegramQueue(agentId, message, db);
          }
        }
      }
    },
  };
}
