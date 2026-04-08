import { openRuntimeDb } from './config.js'
import { ChannelStore } from '@jarvis/runtime'

/**
 * Process pending Telegram notifications from runtime.db.
 * Reads pending notifications, delivers them via sendFn, and marks as delivered.
 * Records outbound deliveries in the channel store if available.
 */
export async function processTelegramQueue(
  sendFn: (msg: string) => Promise<void>,
  channelStore?: ChannelStore,
  threadId?: string,
): Promise<number> {
  let db;
  try {
    db = openRuntimeDb()
  } catch {
    return 0
  }

  try {
    // Claim pending notifications inside a transaction to prevent
    // concurrent relay/bot calls from selecting the same rows.
    db.exec("BEGIN IMMEDIATE")
    let pending: Array<{ notification_id: string; payload_json: string }>
    try {
      pending = db.prepare(`
        SELECT notification_id, payload_json FROM notifications
        WHERE channel = 'telegram' AND status = 'pending' AND kind = 'agent_notification'
        ORDER BY created_at ASC LIMIT 20
      `).all() as Array<{ notification_id: string; payload_json: string }>

      // Mark all selected rows as 'sending' to prevent re-selection
      const claimStmt = db.prepare(
        "UPDATE notifications SET status = 'sending' WHERE notification_id = ?"
      )
      for (const entry of pending) {
        claimStmt.run(entry.notification_id)
      }
      db.exec("COMMIT")
    } catch (e) {
      try { db.exec("ROLLBACK") } catch {}
      return 0
    }

    // Deliver outside the transaction — network I/O shouldn't hold a lock
    let sent = 0
    for (const entry of pending) {
      try {
        const payload = JSON.parse(entry.payload_json) as { agent: string; message: string }
        await sendFn(`[${payload.agent.toUpperCase()}]\n\n${payload.message}`)

        db.prepare(
          "UPDATE notifications SET status = 'sent', delivered_at = ? WHERE notification_id = ?"
        ).run(new Date().toISOString(), entry.notification_id)

        if (channelStore && threadId) {
          try {
            channelStore.recordMessage({
              threadId,
              channel: 'telegram',
              direction: 'outbound',
              contentPreview: `[${payload.agent}] ${payload.message}`,
              sender: 'jarvis',
            })
          } catch { /* best-effort */ }
        }

        sent++
      } catch {
        // Revert to pending so it retries next cycle
        try {
          db.prepare(
            "UPDATE notifications SET status = 'pending' WHERE notification_id = ?"
          ).run(entry.notification_id)
        } catch { /* best-effort */ }
      }
    }
    return sent
  } finally {
    try { db.close() } catch {}
  }
}
