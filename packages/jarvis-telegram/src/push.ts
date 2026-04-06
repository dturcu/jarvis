// Usage: node push.js <agent-id> <message>
// Or: tsx packages/jarvis-telegram/src/push.ts <agent-id> <message>
import { randomUUID } from 'node:crypto'
import { openRuntimeDb } from './config.js'

function main() {
  const [,, agentId, ...messageParts] = process.argv
  const message = messageParts.join(' ')

  if (!agentId || !message) {
    console.error('Usage: push.ts <agent-id> <message>')
    process.exit(1)
  }

  const db = openRuntimeDb()
  try {
    db.prepare(`
      INSERT INTO notifications (notification_id, channel, kind, payload_json, status, created_at)
      VALUES (?, 'telegram', 'agent_notification', ?, 'pending', ?)
    `).run(
      randomUUID(),
      JSON.stringify({ agent: agentId, message }),
      new Date().toISOString(),
    )
    console.log(`Queued message for ${agentId}`)
  } finally {
    try { db.close() } catch {}
  }
}

// Only run when invoked directly
const isMainModule = process.argv[1]?.endsWith('push.ts') || process.argv[1]?.endsWith('push.js');
if (isMainModule) {
  main();
}

export { main as pushMessage };
