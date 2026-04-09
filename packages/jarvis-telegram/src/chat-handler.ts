/**
 * @deprecated Legacy free-text relay via HTTP loopback to /api/chat/telegram.
 * When JARVIS_TELEGRAM_MODE=session with sessionChat=true, free-text messages
 * route through the OpenClaw gateway session instead. This module is only
 * needed for the legacy Telegram bot path.
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type { ChannelStore } from '@jarvis/runtime'

// ─── Types ──────────────────────────────────────────────────────────────────

type ChatMessage = { role: string; content: string }

export type ChatContext = {
  channelStore?: ChannelStore
  threadId?: string
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

/**
 * Load recent conversation history from the channel store (thread-scoped,
 * durable). Falls back gracefully to empty history if the store is unavailable.
 */
function loadThreadHistory(ctx?: ChatContext, limit = 20, maxChars = 4000): ChatMessage[] {
  if (!ctx?.channelStore || !ctx?.threadId) return []

  try {
    const messages = ctx.channelStore.getThreadMessages(ctx.threadId, limit)
      .filter(m => m.content_preview && m.direction)
      .map(m => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.content_preview!,
      }))

    // Truncate from the oldest end to stay within maxChars budget
    let totalChars = 0
    const windowed: ChatMessage[] = []
    for (let i = messages.length - 1; i >= 0; i--) {
      const len = messages[i]!.content.length
      if (totalChars + len > maxChars) break
      totalChars += len
      windowed.unshift(messages[i]!)
    }
    return windowed
  } catch {
    return []
  }
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
    // Multi-tool queries (file_list → read_file → synthesize) can take 3+ LLM
    // rounds × 30s each through local models. 180s covers 6 tool iterations.
    req.setTimeout(180_000, () => {
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
 * Conversation history is loaded from the channel store (thread-scoped,
 * durable across restarts). No process-global in-memory state.
 * No action-tag parsing, no agent triggering from model output.
 * All agent triggers must come via explicit /slash commands.
 */
export async function handleFreeText(userMessage: string, ctx?: ChatContext): Promise<{ text: string }> {
  // Load prior turns from the durable channel store, not process memory
  const history = loadThreadHistory(ctx)

  const response = await callJarvisApi(userMessage, history)
  return { text: response }
}
