/**
 * vision-handler.ts -- Telegram photo analysis via Ollama vision models
 *
 * Downloads photos from Telegram, detects a vision-capable Ollama model,
 * and returns a multimodal analysis. Caches the detected model to avoid
 * repeated probing across ESM reloads.
 */

import fs from 'fs'
import { join } from 'path'
import os from 'os'
import http from 'http'

const OLLAMA_URL = 'http://localhost:11434'
const CACHE_PATH = join(os.homedir(), '.jarvis', '.vision-model-cache')
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// ─── Telegram Photo Download ─────────────────────────────────────────────────

async function downloadTelegramPhoto(fileId: string, botToken: string): Promise<Buffer> {
  // Step 1: Get file path from Telegram
  const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
  if (!fileRes.ok) throw new Error(`Telegram getFile failed: ${fileRes.statusText}`)
  const fileData = await fileRes.json() as { ok: boolean; result?: { file_path?: string } }
  const filePath = fileData.result?.file_path
  if (!filePath) throw new Error('Telegram returned no file_path')

  // Step 2: Download from Telegram CDN
  const downloadRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
  if (!downloadRes.ok) throw new Error(`Telegram file download failed: ${downloadRes.statusText}`)
  const arrayBuf = await downloadRes.arrayBuffer()
  return Buffer.from(arrayBuf)
}

// ─── Vision Model Detection ─────────────────────────────────────────────────

type CacheEntry = { model: string; timestamp: number }

function readCache(): string | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8')
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.model
  } catch { /* cache miss */ }
  return null
}

function writeCache(model: string): void {
  try {
    const dir = join(os.homedir(), '.jarvis')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ model, timestamp: Date.now() }))
  } catch { /* best-effort */ }
}

function ollamaGet(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${OLLAMA_URL}${path}`)
    const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function ollamaPost(path: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${OLLAMA_URL}${path}`)
    const req = http.request({
      hostname: url.hostname, port: Number(url.port),
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body)
    req.end()
  })
}

/** Detect the best available vision model from Ollama. */
async function detectVisionModel(): Promise<string> {
  // Check cache first
  const cached = readCache()
  if (cached) return cached

  // Candidates in priority order
  const candidates = ['gemma3:12b', 'gemma3:4b', 'llava:13b', 'llava:7b', 'bakllava', 'moondream']

  // Get available models
  let available: string[]
  try {
    const resp = JSON.parse(await ollamaGet('/api/tags')) as { models?: Array<{ name: string }> }
    available = (resp.models ?? []).map(m => m.name)
  } catch {
    throw new Error('Ollama is not running or unreachable at localhost:11434')
  }

  // Find first candidate that is available and has vision capability
  for (const candidate of candidates) {
    const match = available.find(m => m.startsWith(candidate.split(':')[0]!))
    if (!match) continue

    // Verify vision capability via /api/show
    try {
      const showResp = JSON.parse(await ollamaPost('/api/show', JSON.stringify({ name: match }))) as {
        model_info?: Record<string, unknown>
        details?: { families?: string[] }
      }
      // Check for vision projector in model info or families
      const hasProjector = JSON.stringify(showResp.model_info ?? {}).includes('projector')
      const hasVisionFamily = (showResp.details?.families ?? []).some(f => f.includes('vision') || f.includes('clip'))
      if (hasProjector || hasVisionFamily) {
        writeCache(match)
        return match
      }
    } catch { /* skip, try next */ }
  }

  // Fallback: try any model with 'vision', 'llava', or 'gemma' in the name
  const fallback = available.find(m => /vision|llava|gemma3|gemma4/.test(m.toLowerCase()))
  if (fallback) {
    writeCache(fallback)
    return fallback
  }

  throw new Error(`No vision-capable model found in Ollama. Available: ${available.join(', ')}. Install one with: ollama pull gemma3:4b`)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Handle a vision message from Telegram.
 * Downloads the photo, detects a vision model, and returns the analysis.
 */
export async function handleVisionMessage(fileId: string, caption: string, botToken: string): Promise<string> {
  // Download photo
  const photoBuffer = await downloadTelegramPhoto(fileId, botToken)
  const base64 = photoBuffer.toString('base64')

  // Detect vision model
  const model = await detectVisionModel()

  // Call Ollama multimodal chat
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: caption, images: [base64] }],
    stream: false,
  })

  const resp = JSON.parse(await ollamaPost('/api/chat', body)) as {
    message?: { content?: string }
  }

  const content = resp.message?.content ?? 'No response from vision model'
  // Truncate to Telegram message limit
  return content.length > 4096 ? content.slice(0, 4093) + '...' : content
}
