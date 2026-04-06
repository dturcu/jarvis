import { openRuntimeDb } from './config.js'

/**
 * Process pending Telegram notifications from runtime.db.
 * Reads pending notifications, delivers them via sendFn, and marks as delivered.
 */
export async function processTelegramQueue(sendFn: (msg: string) => Promise<void>): Promise<number> {
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
          "UPDATE notifications SET status = 'delivered', delivered_at = ? WHERE notification_id = ?"
        ).run(new Date().toISOString(), entry.notification_id)

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
