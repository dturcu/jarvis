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
    const pending = db.prepare(`
      SELECT notification_id, payload_json FROM notifications
      WHERE channel = 'telegram' AND status = 'pending' AND kind = 'agent_notification'
      ORDER BY created_at ASC LIMIT 20
    `).all() as Array<{ notification_id: string; payload_json: string }>

    let sent = 0
    for (const entry of pending) {
      try {
        const payload = JSON.parse(entry.payload_json) as { agent: string; message: string }
        await sendFn(`[${payload.agent.toUpperCase()}]\n\n${payload.message}`)

        db.prepare(
          "UPDATE notifications SET status = 'sent', delivered_at = ? WHERE notification_id = ?"
        ).run(new Date().toISOString(), entry.notification_id)

        // Record outbound message in channel store (no delivery record —
        // notification_id is not a run_id, so delivery tracking belongs
        // in the orchestrator where real run_id is known)
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
        // Leave as pending, retry next cycle
      }
    }
    return sent
  } finally {
    try { db.close() } catch {}
  }
}
