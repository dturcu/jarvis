// Usage: node push.js <agent-id> <message>
// Or: tsx packages/jarvis-telegram/src/push.ts <agent-id> <message>
import fs from 'fs'
import { QUEUE_FILE } from './config.js'

type QueueEntry = { agent: string; message: string; ts: string; sent: boolean }

function main() {
  const [,, agentId, ...messageParts] = process.argv
  const message = messageParts.join(' ')

  if (!agentId || !message) {
    console.error('Usage: push.ts <agent-id> <message>')
    process.exit(1)
  }

  const queue: QueueEntry[] = fs.existsSync(QUEUE_FILE)
    ? JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) as QueueEntry[]
    : []

  queue.push({ agent: agentId, message, ts: new Date().toISOString(), sent: false })
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2))
  console.log(`Queued message for ${agentId}`)
}

// Only run when invoked directly
const isMainModule = process.argv[1]?.endsWith('push.ts') || process.argv[1]?.endsWith('push.js');
if (isMainModule) {
  main();
}

export { main as pushMessage };
