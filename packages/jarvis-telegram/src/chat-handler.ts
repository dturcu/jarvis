import http from 'node:http'

// ─── Types ──────────────────────────────────────────────────────────────────

type ChatMessage = { role: string; content: string }

// ─── Conversation Memory (last 10 exchanges) ───────────────────────────────

const conversationHistory: ChatMessage[] = []
const MAX_HISTORY = 20

function addToHistory(role: string, content: string) {
  conversationHistory.push({ role, content })
  while (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift()
  }
}

// ─── Jarvis API Relay ───────────────────────────────────────────────────────

const JARVIS_API = 'http://localhost:4242/api/chat/telegram'

function callJarvisApi(message: string, history: ChatMessage[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message, history })
    const url = new URL(JARVIS_API)
    const req = http.request({
      hostname: url.hostname,
      port: Number(url.port) || 4242,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => (data += chunk.toString()))
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as { reply?: string; error?: string }
          if (json.error) {
            resolve(`Jarvis error: ${json.error}`)
          } else {
            resolve(json.reply ?? 'No response from Jarvis.')
          }
        } catch {
          resolve('Failed to parse Jarvis response.')
        }
      })
      res.on('error', reject)
    })
    req.on('error', (err) => {
      resolve(`Jarvis API unreachable (${err.message}). Is the daemon running? Try: npm start`)
    })
    req.setTimeout(120_000, () => {
      req.destroy()
      resolve('Request timed out. The LLM may be loading — try again in a moment.')
    })
    req.write(body)
    req.end()
  })
}

// ─── Action Parsing (for agent triggers embedded in LLM response) ───────────

export type ParsedAction =
  | { type: 'trigger'; agentId: string }
  | { type: 'status' }
  | { type: 'crm' }

const VALID_AGENTS = new Set([
  'bd-pipeline', 'proposal-engine', 'evidence-auditor', 'contract-reviewer',
  'staffing-monitor', 'content-engine', 'portfolio-monitor', 'garden-calendar',
  'email-campaign', 'social-engagement', 'security-monitor', 'drive-watcher',
  'invoice-generator', 'meeting-transcriber'
])

export function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = []
  const regex = /\[ACTION:(trigger:([a-z-]+)|status|crm)\]/g
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match[2] && VALID_AGENTS.has(match[2])) {
      actions.push({ type: 'trigger', agentId: match[2] })
    } else if (match[1] === 'status') {
      actions.push({ type: 'status' })
    } else if (match[1] === 'crm') {
      actions.push({ type: 'crm' })
    }
  }
  return actions.slice(0, 1)
}

export function stripActionTags(text: string): string {
  return text.replace(/\s*\[ACTION:[^\]]+\]\s*/g, ' ').trim()
}

// ─── Main Chat Handler ──────────────────────────────────────────────────────

export async function handleFreeText(userMessage: string): Promise<{ text: string; actions: ParsedAction[] }> {
  addToHistory('user', userMessage)

  // Relay to Jarvis API — Jarvis handles LLM, tools, and context
  const response = await callJarvisApi(userMessage, conversationHistory.slice(0, -1))

  const actions = parseActions(response)
  const cleanText = stripActionTags(response)

  addToHistory('assistant', cleanText)

  return { text: cleanText, actions }
}
