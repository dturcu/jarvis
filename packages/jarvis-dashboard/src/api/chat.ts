import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import http from 'http'
import https from 'https'
import os from 'os'
import fs from 'fs'
import { join } from 'path'
import {
  fetchUrl,
  executeTool,
  extractToolCalls,
  buildContext,
  loadGmailConfig,
  getGmailAccessToken,
  httpsPost,
  httpsGet,
  type FetchUrlOptions,
} from './tool-infra.js'

const LMS_URL = process.env.LMS_URL ?? 'http://localhost:1234'
const DEFAULT_MODEL = process.env.LMS_MODEL ?? 'qwen/qwen3.5-35b-a3b'

/** Fetch options for chat.ts -- browser-like User-Agent */
const CHAT_FETCH_OPTS: FetchUrlOptions = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

/** Google News RSS search handler used by chat surface */
async function googleNewsSearch(query: string, fetchFn: typeof fetchUrl): Promise<string> {
  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    const xml = await fetchFn(rssUrl, CHAT_FETCH_OPTS)

    const results: string[] = []
    const itemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?(?:<pubDate>([\s\S]*?)<\/pubDate>)?[\s\S]*?(?:<source[^>]*>([\s\S]*?)<\/source>)?[\s\S]*?<\/item>/gi
    let match: RegExpExecArray | null
    let count = 0
    while ((match = itemRegex.exec(xml)) !== null && count < 10) {
      const title = (match[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()
      const link = (match[2] ?? '').trim()
      const date = match[3] ? new Date(match[3].trim()).toLocaleDateString() : ''
      const source = (match[4] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()
      if (title) {
        results.push(`${count + 1}. ${title}${source ? ` — ${source}` : ''}${date ? ` (${date})` : ''}\n   ${link}`)
        count++
      }
    }
    if (results.length > 0) {
      return `News results for "${query}":\n\n${results.join('\n\n')}`
    }
    return `No news results found for "${query}". Try broader search terms.`
  } catch (e) {
    return `Search failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** Execute a read-only tool with chat.ts overrides (Google News, browser UA, decisions) */
function chatExecuteTool(name: string, params: Record<string, unknown>): Promise<string> {
  return executeTool(name, params, {
    fetch: CHAT_FETCH_OPTS,
    webSearch: { handler: googleNewsSearch },
  })
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOL_DESCRIPTIONS = `
You have these tools available. To use one, output EXACTLY this format on its own line:
[TOOL:tool_name]({"param":"value"})

After you output a tool call, STOP and wait. The system will execute it and give you the result. Then continue your response.

Available tools:

1. [TOOL:web_search]({"query":"search terms"})
   Search the web for current information. Returns top results with titles and snippets.

2. [TOOL:web_fetch]({"url":"https://example.com"})
   Fetch and read the content of a specific URL. Returns the page text.

3. [TOOL:crm_search]({"query":"company or person name"})
   Search the CRM pipeline for contacts matching the query.

4. [TOOL:knowledge_search]({"query":"topic", "collection":"lessons|playbooks|iso26262|contracts|proposals"})
   Search the Jarvis knowledge base for documents, playbooks, or lessons.

5. [TOOL:system_info]({})
   Get current system info: CPU, memory, disk usage.

6. [TOOL:list_files]({"path":"C:/Users/DanielV2/Desktop"})
   List files and folders at the given path. Use this when asked about files on the desktop, in a folder, etc.

Rules:
- Use tools when you need live/current data (web search, URL content)
- Use tools when asked to look something up, browse, or check something online
- You can chain multiple tool calls in one response
- After receiving tool results, synthesize them into a clear answer
- If a tool fails, tell the user and suggest alternatives
`.trim()

// ─── Non-streaming LLM call (for tool-use follow-up) ──────────────────────────

function llmChat(messages: Array<{ role: string; content: string }>, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lmsUrl = new URL(`${LMS_URL}/v1/chat/completions`)
    const body = JSON.stringify({ model, messages, stream: false, temperature: 0.3, max_tokens: 2048 })
    const req = http.request({
      hostname: lmsUrl.hostname, port: Number(lmsUrl.port) || 1234,
      path: lmsUrl.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ message?: { content?: string } }> }
          resolve(parsed.choices?.[0]?.message?.content ?? '')
        } catch { resolve('') }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('LLM request timeout')) })
    req.write(body)
    req.end()
  })
}

/** LLM chat with dynamic base URL (supports both Ollama and LM Studio) */
function llmChatDynamic(messages: Array<{ role: string; content: string }>, model: string, baseUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/v1/chat/completions`)
    const body = JSON.stringify({ model, messages, stream: false, temperature: 0.3, max_tokens: 2048 })
    const req = http.request({
      hostname: url.hostname, port: Number(url.port) || 11434,
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ message?: { content?: string } }> }
          resolve(parsed.choices?.[0]?.message?.content ?? '')
        } catch { resolve('') }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('LLM request timeout')) })
    req.write(body)
    req.end()
  })
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const chatRouter = Router()

chatRouter.post('/', async (req, res) => {
  const { message, model, history = [] } = req.body as {
    message: string
    model?: string
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return }

  const context = buildContext({ includeDecisions: true })
  const systemPrompt = `You are Jarvis, an autonomous AI agent assistant for Thinking in Code — Daniel Turcu's automotive safety consulting firm (ISO 26262, ASPICE, AUTOSAR, cybersecurity).

You are a powerful agent with access to live tools. You CAN browse the web, search online, read URLs, query the CRM, and search the knowledge base.

${TOOL_DESCRIPTIONS}

LIVE DATA (from Jarvis databases):

${context}

Be direct and specific. Use your tools actively when the user asks you to look something up, check the web, find information, or do anything requiring live data. Today is ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`

  const msgs = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10),
    { role: 'user', content: message }
  ]

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  const socket = res.socket as (NodeJS.Socket & { setNoDelay?: (v: boolean) => void }) | null
  socket?.setNoDelay?.(true)

  const chosenModel = model ?? DEFAULT_MODEL

  // First pass: stream the LLM response, collecting the full text
  let fullResponse = ''
  try {
    fullResponse = await streamToClient(res, msgs, chosenModel)
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e instanceof Error ? e.message : String(e) })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  // Check for tool calls in the response
  const toolCalls = extractToolCalls(fullResponse)

  if (toolCalls.length > 0) {
    // Execute tools and feed results back
    for (const call of toolCalls) {
      res.write(`data: ${JSON.stringify({ token: `\n\n🔧 Running ${call.name}...\n\n` })}\n\n`)
      const result = await chatExecuteTool(call.name, call.params)

      // Add tool result to conversation and get follow-up
      msgs.push({ role: 'assistant', content: fullResponse })
      msgs.push({ role: 'user', content: `[Tool Result for ${call.name}]:\n${result}\n\nNow use this information to answer the original question. Do NOT output any more tool calls.` })

      try {
        await streamToClient(res, msgs, chosenModel)
      } catch { /* best effort */ }
    }
  }

  res.write('data: [DONE]\n\n')
  res.end()
})

// Stream LLM response to SSE client, return full collected text
function streamToClient(res: import('express').Response, messages: Array<{ role: string; content: string }>, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lmsUrl = new URL(`${LMS_URL}/v1/chat/completions`)
    const body = JSON.stringify({ model, messages, stream: true, temperature: 0.3, max_tokens: 2048 })

    const lmsReq = http.request({
      hostname: lmsUrl.hostname, port: Number(lmsUrl.port) || 1234,
      path: lmsUrl.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (lmsRes) => {
      if ((lmsRes.statusCode ?? 500) >= 400) {
        let errBody = ''
        lmsRes.on('data', (c: Buffer) => errBody += c.toString())
        lmsRes.on('end', () => reject(new Error(`LM Studio ${lmsRes.statusCode}: ${errBody.slice(0, 200)}`)))
        return
      }

      let buffer = ''
      let fullText = ''

      lmsRes.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }
            const delta = parsed.choices?.[0]?.delta
            if (delta?.reasoning_content) {
              res.write(`data: ${JSON.stringify({ thinking: delta.reasoning_content })}\n\n`)
            }
            if (delta?.content) {
              fullText += delta.content
              res.write(`data: ${JSON.stringify({ token: delta.content })}\n\n`)
            }
          } catch { /* skip */ }
        }
      })

      lmsRes.on('end', () => resolve(fullText))
      lmsRes.on('error', (e: Error) => reject(e))
    })

    lmsReq.on('error', (e: Error) => reject(e))
    lmsReq.setTimeout(30000, () => { lmsReq.destroy(); reject(new Error('LLM stream request timeout')) })
    lmsReq.write(body)
    lmsReq.end()
  })
}

// ─── Tool Definitions for Function Calling ───────────────────────────────────
// Tool list must be a subset of READONLY_TOOL_NAMES from tool-infra.ts

const AGENT_TOOLS = [
  {
    type: 'function' as const, function: {
      name: 'web_search', description: 'Search the web for current information, news, or any topic',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'web_fetch', description: 'Fetch and read content from a specific URL',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to fetch' } }, required: ['url'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'list_files', description: 'List files and folders at a path on Daniel\'s PC',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path. Use C:/Users/DanielV2/Desktop for desktop, C:/Users/DanielV2/Documents for documents' } }, required: ['path'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'read_file', description: 'Read the contents of a text file',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Full file path' }, max_chars: { type: 'number', description: 'Max characters to read (default 2000)' } }, required: ['path'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'system_info', description: 'Get CPU, memory, disk usage, hostname, uptime',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'crm_search', description: 'Search CRM for contacts, clients, leads by name or company',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Name, company, or keyword to search' } }, required: ['query'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'knowledge_search', description: 'Search the knowledge base for documents, playbooks, lessons, ISO 26262 info',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search topic' }, collection: { type: 'string', description: 'Optional: lessons, playbooks, iso26262, contracts, proposals' } }, required: ['query'] }
    }
  },
  // trigger_agent REMOVED from the chat surface. It inserts into agent_commands
  // (a mutation) but chat POST is viewer-level for tokenless dev mode. Agent
  // triggering must go through explicit Telegram /slash commands or the
  // dashboard agents API (which requires operator role).
  {
    type: 'function' as const, function: {
      name: 'agent_status', description: 'Get status of all Jarvis agents (last run, pending approvals). Read-only.',
      parameters: { type: 'object', properties: {} }
    }
  },
  // write_file and run_command REMOVED — direct privileged execution from chat
  // violates the runtime kernel trust model. All mutations must flow through
  // the command → run → approval → job → worker path.
  {
    type: 'function' as const, function: {
      name: 'gmail_search', description: 'Search Gmail emails. Use Gmail search syntax: "is:unread", "from:user@example.com", "after:2026/04/07", "subject:meeting", "newer_than:1d"',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query. Examples: "is:unread", "newer_than:1d", "from:boss@company.com"' }, max_results: { type: 'number', description: 'Max emails to return (default 5)' } }, required: ['query'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'gmail_read', description: 'Read a specific email by its message ID (from gmail_search results)',
      parameters: { type: 'object', properties: { message_id: { type: 'string', description: 'Gmail message ID' } }, required: ['message_id'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'browse_page', description: 'Open a URL in Chrome and extract the full page content. Better than web_fetch for JavaScript-heavy sites.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to navigate to' } }, required: ['url'] }
    }
  },
  // gmail_send and gmail_reply REMOVED — email sending must go through
  // the approval-backed email.send / email.reply job types in the runtime kernel,
  // not through a chat-surface boolean confirmation.
]

/** Execute a tool by name, including new tools */
async function executeAgentTool(name: string, params: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'read_file': {
      const filePath = params.path as string
      const maxChars = (params.max_chars as number) ?? 2000
      try {
        const fs = await import('node:fs')
        const content = fs.readFileSync(filePath, 'utf8')
        return content.length > maxChars ? content.slice(0, maxChars) + '\n…(truncated)' : content
      } catch (e) {
        return `Cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    // trigger_agent handler removed — mutation not allowed from viewer-level chat.
    case 'trigger_agent':
      return 'Agent triggering is not available from the chat surface. Use Telegram /slash commands (e.g. /bd, /content) or the dashboard agents API.'
    case 'agent_status': {
      try {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
        db.exec("PRAGMA journal_mode = WAL;")
        const agents = ['bd-pipeline', 'proposal-engine', 'evidence-auditor', 'contract-reviewer', 'staffing-monitor', 'content-engine', 'portfolio-monitor', 'garden-calendar', 'email-campaign', 'social-engagement', 'security-monitor', 'drive-watcher', 'invoice-generator', 'meeting-transcriber']
        const lines = ['JARVIS AGENT STATUS\n']
        for (const id of agents) {
          const row = db.prepare('SELECT started_at, status FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1').get(id) as { started_at: string; status: string } | undefined
          const ts = row ? new Date(row.started_at).toLocaleDateString() : 'never'
          lines.push(`${id}: ${ts}${row?.status ? ` (${row.status})` : ''}`)
        }
        const pending = (db.prepare("SELECT COUNT(*) as c FROM approvals WHERE status = 'pending'").get() as { c: number }).c
        lines.push(`\nPending approvals: ${pending}`)
        db.close()
        return lines.join('\n')
      } catch (e) {
        return `Status check failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    case 'gmail_search': {
      const query = (params.query as string) ?? 'newer_than:1d'
      const maxResults = (params.max_results as number) ?? 5
      try {
        const token = await getGmailAccessToken()
        if (!token) return 'Gmail not configured. Add gmail credentials to ~/.jarvis/config.json'
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`
        const listResp = JSON.parse(await httpsGet(url, { Authorization: `Bearer ${token}` }))
        if (!listResp.messages || listResp.messages.length === 0) return `No emails found for: ${query}`

        const emails: string[] = []
        for (const msg of listResp.messages.slice(0, maxResults)) {
          const detail = JSON.parse(await httpsGet(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { Authorization: `Bearer ${token}` }
          ))
          const headers = detail.payload?.headers ?? []
          const from = headers.find((h: { name: string }) => h.name === 'From')?.value ?? 'Unknown'
          const subject = headers.find((h: { name: string }) => h.name === 'Subject')?.value ?? '(no subject)'
          const date = headers.find((h: { name: string }) => h.name === 'Date')?.value ?? ''
          const snippet = detail.snippet ?? ''
          emails.push(`📧 From: ${from}\n   Subject: ${subject}\n   Date: ${date}\n   Preview: ${snippet}\n   ID: ${msg.id}`)
        }
        return `Gmail results (${query}):\n\n${emails.join('\n\n')}`
      } catch (e) {
        return `Gmail search failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'gmail_read': {
      const messageId = params.message_id as string
      if (!messageId) return 'Error: message_id required'
      try {
        const token = await getGmailAccessToken()
        if (!token) return 'Gmail not configured.'
        const detail = JSON.parse(await httpsGet(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
          { Authorization: `Bearer ${token}` }
        ))
        const headers = detail.payload?.headers ?? []
        const from = headers.find((h: { name: string }) => h.name === 'From')?.value ?? 'Unknown'
        const subject = headers.find((h: { name: string }) => h.name === 'Subject')?.value ?? ''
        const date = headers.find((h: { name: string }) => h.name === 'Date')?.value ?? ''
        // Extract body text
        let body = ''
        const parts = detail.payload?.parts ?? [detail.payload]
        for (const part of parts) {
          if (part?.mimeType === 'text/plain' && part?.body?.data) {
            body = Buffer.from(part.body.data, 'base64url').toString('utf8')
            break
          }
        }
        if (!body && detail.payload?.body?.data) {
          body = Buffer.from(detail.payload.body.data, 'base64url').toString('utf8')
        }
        return `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${(body || detail.snippet || '').slice(0, 3000)}`
      } catch (e) {
        return `Gmail read failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    // gmail_send and gmail_reply handlers removed — email sending must go
    // through the approval-backed email.send / email.reply job types.
    case 'gmail_send':
      return 'Email sending is disabled in the chat surface. Use the /email-campaign agent or submit an email.send job through the runtime.'
    case 'gmail_reply':
      return 'Email reply is disabled in the chat surface. Use the /email-campaign agent or submit an email.reply job through the runtime.'

    case 'browse_page': {
      const url = params.url as string
      if (!url) return 'Error: url required'
      try {
        // Connect to Chrome CDP
        const cdpUrl = 'http://127.0.0.1:9222'
        // Get list of targets
        const targetsResp = await new Promise<string>((resolve, reject) => {
          http.get(`${cdpUrl}/json/new?${encodeURIComponent(url)}`, (res) => {
            let data = ''
            res.on('data', (c: Buffer) => data += c.toString())
            res.on('end', () => resolve(data))
            res.on('error', reject)
          }).on('error', reject)
        })
        const target = JSON.parse(targetsResp) as { id: string }

        // Wait for page to load, then extract content via CDP
        await new Promise(r => setTimeout(r, 3000))

        // Get page content via CDP evaluate
        const evalResp = await new Promise<string>((resolve, reject) => {
          const body = JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
            expression: 'document.body.innerText.slice(0, 5000)',
            returnByValue: true
          }})
          const wsUrl = `${cdpUrl}/json`
          // Use HTTP endpoint instead of WebSocket for simplicity
          const req = http.request({ hostname: '127.0.0.1', port: 9222, path: `/json/protocol`, method: 'GET' }, () => {})
          req.on('error', () => {})
          req.end()
          // Fallback: fetch via regular HTTP
          fetchUrl(url, CHAT_FETCH_OPTS).then(html => {
            const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            resolve(text.slice(0, 5000))
          }).catch(reject)
        })

        // Clean up: close the tab
        try {
          await new Promise<void>((resolve) => {
            http.get(`${cdpUrl}/json/close/${target.id}`, () => resolve()).on('error', () => resolve())
          })
        } catch {}

        return `Page content from ${url}:\n\n${evalResp}`
      } catch (e) {
        // Fallback to regular fetch
        try {
          const html = await fetchUrl(url, CHAT_FETCH_OPTS)
          const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          return `Page content from ${url} (via HTTP fetch):\n\n${text.slice(0, 5000)}`
        } catch (e2) {
          return `Browse failed: ${e2 instanceof Error ? e2.message : String(e2)}`
        }
      }
    }

    // write_file and run_command handlers removed — privileged execution
    // must go through the runtime kernel, not chat surfaces.
    default:
      return chatExecuteTool(name, params)
  }
}

// ─── Agentic LLM call with function calling ──────────────────────────────────

type FnCallMessage = {
  role: string
  content?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

function agentChat(messages: FnCallMessage[], model: string, baseUrl: string, tools: typeof AGENT_TOOLS): Promise<{
  content: string | null
  tool_calls: Array<{ id: string; function: { name: string; arguments: string } }>
}> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/v1/chat/completions`)
    const body = JSON.stringify({ model, messages, tools, stream: false, temperature: 0.3, max_tokens: 2048 })
    const req = http.request({
      hostname: url.hostname, port: Number(url.port) || 11434,
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              message?: { content?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }
              finish_reason?: string
            }>
          }
          const msg = parsed.choices?.[0]?.message
          resolve({
            content: msg?.content ?? null,
            tool_calls: (msg?.tool_calls ?? []).map(tc => ({ id: tc.id, function: tc.function }))
          })
        } catch { resolve({ content: data.slice(0, 500), tool_calls: [] }) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('LLM request timeout')) })
    req.write(body)
    req.end()
  })
}

// POST /api/chat/telegram — agentic endpoint with native function calling
chatRouter.post('/telegram', async (req, res) => {
  const { message, history = [] } = req.body as {
    message: string
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return }

  const context = buildContext({ includeDecisions: true })
  const systemPrompt = `You are Jarvis, Daniel's personal AI agent. You run on his Windows PC (${os.hostname()}).
You have read-only access to data via tools. ALWAYS use tools to get real data — never guess.

RULES:
1. Use tools proactively for any data request (files, system, web, CRM, email search, etc.)
2. Chain multiple tools when needed. Think step by step.
3. Be concise — this goes to Telegram.
4. Ask clarifying questions when needed.
5. You ARE Jarvis. Never identify as Qwen/GPT/etc.
6. Today: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}

You can SEARCH and READ emails (gmail_search, gmail_read) but CANNOT send emails from this surface.
To send emails or trigger agents, use Telegram /slash commands (e.g. /bd, /content).
This surface is read-only — it cannot trigger agents or send emails directly.

CRM/Knowledge:
${context.slice(0, 1500)}`

  const msgs: FnCallMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ]

  // Use qwen3:8b (has tool support) via Ollama, fallback to LM Studio
  let llmBaseUrl = 'http://localhost:11434'
  let llmModel = 'qwen3:8b'
  try {
    const ollamaModels = await listLocalModels('http://localhost:11434')
    if (ollamaModels.length > 0) {
      // Prefer models with tool support: qwen3 > qwen2.5
      llmModel = ollamaModels.find(m => m.startsWith('qwen3:'))
        ?? ollamaModels.find(m => m.startsWith('qwen2.5:'))
        ?? ollamaModels[0]!
    } else {
      llmBaseUrl = LMS_URL
      llmModel = DEFAULT_MODEL
    }
  } catch {
    llmBaseUrl = LMS_URL
    llmModel = DEFAULT_MODEL
  }

  try {
    const MAX_ITERATIONS = 6
    let finalResponse = ''

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await agentChat(msgs, llmModel, llmBaseUrl, AGENT_TOOLS)

      if (result.tool_calls.length > 0) {
        msgs.push({
          role: 'assistant', content: result.content ?? '',
          tool_calls: result.tool_calls.map(tc => ({ id: tc.id, type: 'function' as const, function: tc.function }))
        })

        for (const tc of result.tool_calls) {
          let params: Record<string, unknown> = {}
          try { params = JSON.parse(tc.function.arguments) } catch {}
          const toolResult = await executeAgentTool(tc.function.name, params)
          msgs.push({ role: 'tool', content: toolResult, tool_call_id: tc.id, name: tc.function.name })
        }
        continue
      }

      finalResponse = result.content ?? ''
      break
    }

    // Clean artifacts
    finalResponse = finalResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    finalResponse = finalResponse.replace(/<\|[^>]+\|>/g, '').trim()

    // Deduplicate
    const paras = finalResponse.split('\n\n')
    const seen = new Set<string>()
    const unique = paras.filter(p => {
      const k = p.trim().toLowerCase().slice(0, 100)
      if (!k || seen.has(k)) return false
      seen.add(k); return true
    })
    finalResponse = unique.join('\n\n')
    if (finalResponse.length > 3000) finalResponse = finalResponse.slice(0, 3000) + '…'

    res.json({ reply: finalResponse || 'No response generated.' })
  } catch (e) {
    res.status(500).json({ error: `Agent error: ${e instanceof Error ? e.message : String(e)}` })
  }
})

function listLocalModels(baseUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const mod = baseUrl.startsWith('https') ? https : http
    const url = new URL(`${baseUrl}/v1/models`)
    const req = mod.get(url, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as { data?: Array<{ id?: string }> }
          resolve(json.data?.map(m => m.id ?? '').filter(Boolean) ?? [])
        } catch { resolve([]) }
      })
    })
    req.on('error', () => resolve([]))
    req.setTimeout(3000, () => { req.destroy(); resolve([]) })
  })
}

// GET /api/chat/models
chatRouter.get('/models', (_req, res) => {
  const lmsUrl = new URL(`${LMS_URL}/v1/models`)
  const lmsReq = http.request({
    hostname: lmsUrl.hostname, port: Number(lmsUrl.port) || 1234,
    path: lmsUrl.pathname, method: 'GET'
  }, (lmsRes) => {
    let body = ''
    lmsRes.on('data', (c: Buffer) => body += c.toString())
    lmsRes.on('end', () => {
      try {
        const data = JSON.parse(body) as { data: Array<{ id: string }> }
        res.json({ models: data.data.map(m => m.id), default: DEFAULT_MODEL })
      } catch { res.json({ models: [], default: DEFAULT_MODEL }) }
    })
  })
  lmsReq.on('error', () => res.json({ models: [], default: DEFAULT_MODEL, error: 'LM Studio unreachable' }))
  lmsReq.setTimeout(30000, () => { lmsReq.destroy() })
  lmsReq.end()
})
