import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

// ─── Types ──────────────────────────────────────────────────────────────────

type ChatMessage = { role: string; content: string }

// ─── Jarvis API Relay ───────────────────────────────────────────────────────

const JARVIS_PORT = Number(process.env.PORT ?? 4242)
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
      // Prefer operator-level token for Telegram
      return map.operator ?? map.admin ?? null
    }
  } catch { /* no config */ }
  return null
}

function callJarvisApi(message: string, history: ChatMessage[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message, history })
    const token = loadApiToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    }
    // Always include auth header when token is available
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const req = http.request({
      hostname: JARVIS_HOST,
      port: JARVIS_PORT,
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

// ─── Main Chat Handler ──────────────────────────────────────────────────────

/**
 * Handle free-text messages from Telegram.
 *
 * This is now a pure relay — it sends the message to the dashboard API and
 * returns the response. No action-tag parsing, no agent triggering from
 * model output. All agent triggers must come via explicit /slash commands.
 *
 * Conversation history is NOT managed here — the dashboard API manages
 * its own context per session. Telegram is a thin ingress layer.
 */
export async function handleFreeText(userMessage: string): Promise<{ text: string }> {
  const response = await callJarvisApi(userMessage, [])
  return { text: response }
}
