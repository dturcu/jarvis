// Usage: node push.js <agent-id> <message>
// Or: tsx packages/jarvis-telegram/src/push.ts <agent-id> <message>
import fs from 'fs'
import { QUEUE_FILE } from './config.js'

const [,, agentId, ...messageParts] = process.argv
const message = messageParts.join(' ')

if (!agentId || !message) {
  console.error('Usage: push.ts <agent-id> <message>')
  process.exit(1)
}

type QueueEntry = { agent: string; message: string; ts: string; sent: boolean }
const queue: QueueEntry[] = fs.existsSync(QUEUE_FILE)
  ? JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) as QueueEntry[]
  : []

queue.push({ agent: agentId, message, ts: new Date().toISOString(), sent: false })
fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2))
console.log(`Queued message for ${agentId}`)
