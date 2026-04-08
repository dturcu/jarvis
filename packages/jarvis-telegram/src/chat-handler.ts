import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

// ─── Types ──────────────────────────────────────────────────────────────────

type ChatMessage = { role: string; content: string }

// ─── Conversation History (per-session, thin layer) ─────────────────────────

const conversationHistory: ChatMessage[] = []
const MAX_HISTORY = 20

function addToHistory(role: string, content: string) {
  conversationHistory.push({ role, content })
  while (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift()
  }
}

// ─── Jarvis API Relay ───────────────────────────────────────────────────────

// Use a Jarvis-specific env var so hosting platforms that set PORT for the
// *current* service (the Telegram bot) don't accidentally redirect the relay.
const JARVIS_API_PORT = Number(process.env.JARVIS_API_PORT ?? process.env.JARVIS_DASHBOARD_PORT ?? 4242)
const JARVIS_HOST = '127.0.0.1'

/**
 * Load API token for authenticated relay.
 * Telegram bot must authenticate against the dashboard API like any other client.
 */
function loadApiToken(): string | null {
  const envToken = process.env.JARVIS_API_TOKEN
  if (envToken) return envToken

  try {
    const configPath = join(os.homedir(), '.jarvis', 'config.json')
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    if (typeof raw.api_token === 'string') return raw.api_token
    if (raw.api_tokens && typeof raw.api_tokens === 'object') {
      const map = raw.api_tokens as Record<string, string>
      return map.operator ?? map.admin ?? null
    }
  } catch { /* no config */ }
  return null
}

function callJarvisApi(message: string, history: ChatMessage[]): Promise<string> {
  const token = loadApiToken()
  if (!token) {
    return Promise.resolve(
      'Telegram relay has no API token configured. ' +
      'Set JARVIS_API_TOKEN or add api_token to ~/.jarvis/config.json.'
    )
  }

  return new Promise((resolve) => {
    const body = JSON.stringify({ message, history })
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      'Authorization': `Bearer ${token}`,
    }

    const req = http.request({
      hostname: JARVIS_HOST,
      port: JARVIS_API_PORT,
      path: '/api/chat/telegram',
      method: 'POST',
      headers,
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
      res.on('error', () => resolve('Jarvis API connection error.'))
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

// ─── Main Chat Handler ──────────────────────────────────────────────────────

/**
 * Handle free-text messages from Telegram.
 *
 * This is a relay layer — it sends the message plus recent conversation
 * history to the dashboard API and returns the response. No action-tag
 * parsing, no agent triggering from model output. All agent triggers
 * must come via explicit /slash commands.
 */
export async function handleFreeText(userMessage: string): Promise<{ text: string }> {
  addToHistory('user', userMessage)

  // Pass prior turns so the LLM has multi-turn context
  const response = await callJarvisApi(userMessage, conversationHistory.slice(0, -1))

  addToHistory('assistant', response)
  return { text: response }
}
