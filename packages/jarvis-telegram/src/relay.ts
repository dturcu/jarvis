import fs from 'fs'
import { QUEUE_FILE } from './config.js'

type QueueEntry = {
  agent: string
  message: string
  ts: string
  sent: boolean
}

export async function processTelegramQueue(sendFn: (msg: string) => Promise<void>): Promise<number> {
  if (!fs.existsSync(QUEUE_FILE)) return 0
  let queue: QueueEntry[] = []
  try {
    queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) as QueueEntry[]
  } catch { return 0 }

  const unsent = queue.filter(e => !e.sent)
  let sent = 0
  for (const entry of unsent) {
    try {
      await sendFn(`[${entry.agent.toUpperCase()}]\n\n${entry.message}`)
      entry.sent = true
      sent++
    } catch {
      // leave as unsent, retry next cycle
    }
  }

  if (sent > 0) {
    // Prune sent entries to prevent unbounded file growth
    const pruned = queue.filter(e => !e.sent);
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(pruned, null, 2))
  }
  return sent
}
