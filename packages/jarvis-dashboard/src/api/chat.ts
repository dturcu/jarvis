import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import http from 'http'
import https from 'https'
import os from 'os'
import fs from 'fs'
import { join } from 'path'

const LMS_URL = process.env.LMS_URL ?? 'http://localhost:1234'
const DEFAULT_MODEL = process.env.LMS_MODEL ?? 'qwen/qwen3.5-35b-a3b'

// ─── Gmail Helper ────────────────────────────────────────────────────────────

function loadGmailConfig(): { client_id: string; client_secret: string; refresh_token: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(join(os.homedir(), '.jarvis', 'config.json'), 'utf8'))
    return raw.gmail ?? null
  } catch { return null }
}

function httpsPost(url: string, body: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.request({
      hostname: parsed.hostname, port: 443, path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers }
    }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body)
    req.end()
  })
}

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.get({ hostname: parsed.hostname, port: 443, path: parsed.pathname + parsed.search, headers }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function getGmailAccessToken(): Promise<string | null> {
  const cfg = loadGmailConfig()
  if (!cfg) return null
  const body = `client_id=${cfg.client_id}&client_secret=${cfg.client_secret}&refresh_token=${cfg.refresh_token}&grant_type=refresh_token`
  const resp = JSON.parse(await httpsPost('https://oauth2.googleapis.com/token', body))
  return resp.access_token ?? null
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

// ─── Tool Execution ───────────────────────────────────────────────────────────

async function executeTool(name: string, params: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'web_search': {
      const query = (params.query as string) ?? ''
      if (!query) return 'Error: query is required'
      try {
        // Use Google News RSS — reliable, no CAPTCHA, no API key needed
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
        const xml = await fetchUrl(rssUrl)

        const results: string[] = []
        // Parse RSS items: <item><title>...</title><link>...</link><pubDate>...</pubDate><source>...</source></item>
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

    case 'web_fetch': {
      const url = params.url as string
      if (!url) return 'Error: url is required'
      try {
        const html = await fetchUrl(url)
        // Strip HTML to get readable text
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim()
        return `Content from ${url}:\n\n${text.slice(0, 4000)}`
      } catch (e) {
        return `Fetch failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'crm_search': {
      const query = (params.query as string) ?? ''
      try {
        const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'crm.db'))
        const rows = db.prepare(
          "SELECT name, company, role, stage, score, email, tags FROM contacts WHERE name LIKE ? OR company LIKE ? ORDER BY score DESC LIMIT 10"
        ).all(`%${query}%`, `%${query}%`) as Array<Record<string, unknown>>
        db.close()
        if (rows.length === 0) return `No CRM contacts found for "${query}"`
        const results = rows.map(r => `- ${r.name} (${r.company}, ${r.role ?? 'N/A'}) — stage: ${r.stage}, score: ${r.score}, email: ${r.email ?? 'N/A'}`).join('\n')
        return `CRM results for "${query}":\n${results}`
      } catch (e) {
        return `CRM search failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'knowledge_search': {
      const query = (params.query as string) ?? ''
      const collection = params.collection as string | undefined
      try {
        const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'knowledge.db'))
        let rows: Array<Record<string, unknown>>
        if (collection) {
          rows = db.prepare(
            "SELECT title, content, collection, tags FROM documents WHERE collection = ? AND (title LIKE ? OR content LIKE ?) ORDER BY created_at DESC LIMIT 10"
          ).all(collection, `%${query}%`, `%${query}%`) as Array<Record<string, unknown>>
        } else {
          rows = db.prepare(
            "SELECT title, content, collection, tags FROM documents WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 10"
          ).all(`%${query}%`, `%${query}%`) as Array<Record<string, unknown>>
        }
        db.close()
        if (rows.length === 0) return `No knowledge documents found for "${query}"`
        const results = rows.map(r => `- [${r.collection}] ${r.title}\n  ${(r.content as string).slice(0, 200)}`).join('\n')
        return `Knowledge results for "${query}":\n${results}`
      } catch (e) {
        return `Knowledge search failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'system_info': {
      const cpus = os.cpus()
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const usedPct = Math.round(((totalMem - freeMem) / totalMem) * 100)
      return `System Info:
- Platform: ${os.platform()} ${os.arch()}
- CPU: ${cpus[0]?.model ?? 'unknown'} (${cpus.length} cores)
- Memory: ${usedPct}% used (${Math.round(freeMem / 1024 / 1024 / 1024)}GB free / ${Math.round(totalMem / 1024 / 1024 / 1024)}GB total)
- Uptime: ${Math.round(os.uptime() / 3600)}h
- Hostname: ${os.hostname()}`
    }

    case 'list_files': {
      const targetPath = (params.path as string) ?? join(os.homedir(), 'Desktop')
      try {
        const fs = await import('node:fs')
        const entries = fs.readdirSync(targetPath, { withFileTypes: true })
        const items = entries.slice(0, 50).map(e => {
          const type = e.isDirectory() ? '📁' : '📄'
          try {
            const stats = fs.statSync(join(targetPath, e.name))
            const size = e.isDirectory() ? '' : ` (${Math.round(stats.size / 1024)}KB)`
            return `${type} ${e.name}${size}`
          } catch {
            return `${type} ${e.name}`
          }
        })
        return `Files in ${targetPath}:\n${items.join('\n')}${entries.length > 50 ? `\n... and ${entries.length - 50} more` : ''}`
      } catch (e) {
        return `Cannot list files at ${targetPath}: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    default:
      return `Unknown tool: ${name}`
  }
}

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' } }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject)
        return
      }
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ─── Extract tool calls from LLM output ───────────────────────────────────────

const TOOL_REGEX = /\[TOOL:(\w+)\]\((\{[\s\S]*?\})\)/g

function extractToolCalls(text: string): Array<{ name: string; params: Record<string, unknown>; fullMatch: string }> {
  const calls: Array<{ name: string; params: Record<string, unknown>; fullMatch: string }> = []
  let match: RegExpExecArray | null
  const regex = new RegExp(TOOL_REGEX.source, 'g')
  while ((match = regex.exec(text)) !== null) {
    try {
      const params = JSON.parse(match[2]!) as Record<string, unknown>
      calls.push({ name: match[1]!, params, fullMatch: match[0] })
    } catch { /* skip malformed */ }
  }
  return calls
}

// ─── Context Builder ──────────────────────────────────────────────────────────

function buildContext(): string {
  const lines: string[] = []
  const jarvisDir = join(os.homedir(), '.jarvis')

  try {
    const db = new DatabaseSync(join(jarvisDir, 'crm.db'))
    const contacts = db.prepare(
      "SELECT name, company, role, stage, score, tags FROM contacts ORDER BY score DESC"
    ).all() as Array<{ name: string; company: string; role: string; stage: string; score: number; tags: string }>
    db.close()
    if (contacts.length > 0) {
      lines.push('## CRM Pipeline')
      for (const c of contacts) {
        let tags: string[] = []
        try { tags = JSON.parse(c.tags) } catch {}
        lines.push(`- ${c.name} (${c.company}, ${c.role ?? 'unknown role'}) — stage: ${c.stage}, score: ${c.score}${tags.length ? ', tags: ' + tags.join(', ') : ''}`)
      }
    }
  } catch {}

  try {
    const kb = new DatabaseSync(join(jarvisDir, 'knowledge.db'))
    const playbooks = kb.prepare("SELECT title, body FROM playbooks ORDER BY use_count DESC LIMIT 5").all() as Array<{ title: string; body: string }>
    const lessons = kb.prepare("SELECT title, content FROM documents WHERE collection = 'lessons' ORDER BY created_at DESC LIMIT 5").all() as Array<{ title: string; content: string }>
    const decisions = kb.prepare("SELECT agent_id, action, reasoning, outcome, created_at FROM decisions ORDER BY created_at DESC LIMIT 10").all() as Array<{ agent_id: string; action: string; reasoning: string; outcome: string; created_at: string }>
    kb.close()

    if (playbooks.length > 0) {
      lines.push('\n## Playbooks')
      for (const p of playbooks) lines.push(`### ${p.title}\n${p.body.slice(0, 400)}`)
    }
    if (lessons.length > 0) {
      lines.push('\n## Recent Lessons')
      for (const l of lessons) lines.push(`- ${l.title}: ${l.content.slice(0, 200)}`)
    }
    if (decisions.length > 0) {
      lines.push('\n## Recent Agent Decisions')
      for (const d of decisions) lines.push(`- [${d.agent_id}] ${d.action}: ${(d.reasoning ?? '').slice(0, 150)} → ${d.outcome ?? 'pending'}`)
    }
  } catch {}

  return lines.join('\n')
}

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

  const context = buildContext()
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
      const result = await executeTool(call.name, call.params)

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
  {
    type: 'function' as const, function: {
      name: 'trigger_agent', description: 'Trigger a Jarvis agent to run. Agents: bd-pipeline, proposal-engine, evidence-auditor, contract-reviewer, staffing-monitor, content-engine, portfolio-monitor, garden-calendar, email-campaign, social-engagement, security-monitor, drive-watcher, invoice-generator, meeting-transcriber',
      parameters: { type: 'object', properties: { agent_id: { type: 'string', description: 'Agent ID to trigger' } }, required: ['agent_id'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'agent_status', description: 'Get status of all Jarvis agents (last run, pending approvals)',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'write_file', description: 'Write content to a file. Use for creating text files, scripts, markdown, etc.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Full file path to write' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'run_command', description: 'Run a shell command on the system. Use for tasks like listing processes, checking network, etc.',
      parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' } }, required: ['command'] }
    }
  },
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
  {
    type: 'function' as const, function: {
      name: 'gmail_send', description: 'Send an email via Gmail. CRITICAL: Always confirm with Daniel before sending. Show him the to, subject, and body first and ask "Should I send this?"',
      parameters: { type: 'object', properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        confirmed: { type: 'boolean', description: 'Set to true ONLY after Daniel explicitly confirms. Default false — show draft first.' }
      }, required: ['to', 'subject', 'body'] }
    }
  },
  {
    type: 'function' as const, function: {
      name: 'gmail_reply', description: 'Reply to an email thread. CRITICAL: Always confirm with Daniel before sending.',
      parameters: { type: 'object', properties: {
        message_id: { type: 'string', description: 'Original message ID to reply to (from gmail_search)' },
        body: { type: 'string', description: 'Reply body (plain text)' },
        confirmed: { type: 'boolean', description: 'Set to true ONLY after Daniel confirms.' }
      }, required: ['message_id', 'body'] }
    }
  },
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
    case 'trigger_agent': {
      const agentId = params.agent_id as string
      try {
        const { DatabaseSync } = await import('node:sqlite')
        const { randomUUID } = await import('node:crypto')
        const db = new DatabaseSync(join(os.homedir(), '.jarvis', 'runtime.db'))
        db.exec("PRAGMA journal_mode = WAL;")
        db.exec("PRAGMA busy_timeout = 5000;")
        const commandId = randomUUID()
        db.prepare(`INSERT INTO agent_commands (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key) VALUES (?, 'run_agent', ?, ?, 'queued', 0, ?, 'telegram', ?)`).run(
          commandId, agentId, JSON.stringify({ triggered_by: 'telegram-agent' }), new Date().toISOString(), `telegram-${agentId}-${Date.now()}`
        )
        db.close()
        return `Agent ${agentId} triggered successfully. It will run shortly.`
      } catch (e) {
        return `Failed to trigger ${agentId}: ${e instanceof Error ? e.message : String(e)}`
      }
    }
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

    case 'gmail_send': {
      const to = params.to as string
      const subject = params.subject as string
      const body = params.body as string
      const confirmed = params.confirmed as boolean
      if (!to || !subject || !body) return 'Error: to, subject, and body are required'
      if (!confirmed) {
        return `📝 DRAFT EMAIL (not sent yet):\n\nTo: ${to}\nSubject: ${subject}\n\n${body}\n\n⚠️ Reply "yes, send it" to confirm sending.`
      }
      try {
        const token = await getGmailAccessToken()
        if (!token) return 'Gmail not configured.'
        const raw = Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url')
        const resp = await new Promise<string>((resolve, reject) => {
          const reqBody = JSON.stringify({ raw })
          const req = https.request({
            hostname: 'gmail.googleapis.com', port: 443,
            path: '/gmail/v1/users/me/messages/send', method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqBody) }
          }, (res) => {
            let data = ''
            res.on('data', (c: Buffer) => data += c.toString())
            res.on('end', () => resolve(data))
            res.on('error', reject)
          })
          req.on('error', reject)
          req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
          req.write(reqBody)
          req.end()
        })
        const result = JSON.parse(resp)
        if (result.id) return `✅ Email sent to ${to} (ID: ${result.id})`
        return `Failed to send: ${resp.slice(0, 300)}`
      } catch (e) {
        return `Send failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'gmail_reply': {
      const messageId = params.message_id as string
      const body = params.body as string
      const confirmed = params.confirmed as boolean
      if (!messageId || !body) return 'Error: message_id and body required'
      if (!confirmed) {
        return `📝 DRAFT REPLY (not sent yet):\n\nReply to message ${messageId.slice(0, 8)}...:\n\n${body}\n\n⚠️ Reply "yes, send it" to confirm.`
      }
      try {
        const token = await getGmailAccessToken()
        if (!token) return 'Gmail not configured.'
        // Get original message for thread ID and headers
        const original = JSON.parse(await httpsGet(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`,
          { Authorization: `Bearer ${token}` }
        ))
        const headers = original.payload?.headers ?? []
        const from = headers.find((h: { name: string }) => h.name === 'From')?.value ?? ''
        const subject = headers.find((h: { name: string }) => h.name === 'Subject')?.value ?? ''
        const msgIdHeader = headers.find((h: { name: string }) => h.name === 'Message-ID')?.value ?? ''
        const threadId = original.threadId

        const raw = Buffer.from(
          `To: ${from}\r\nSubject: Re: ${subject}\r\nIn-Reply-To: ${msgIdHeader}\r\nReferences: ${msgIdHeader}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url')
        const resp = await new Promise<string>((resolve, reject) => {
          const reqBody = JSON.stringify({ raw, threadId })
          const req = https.request({
            hostname: 'gmail.googleapis.com', port: 443,
            path: '/gmail/v1/users/me/messages/send', method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqBody) }
          }, (res) => {
            let data = ''
            res.on('data', (c: Buffer) => data += c.toString())
            res.on('end', () => resolve(data))
            res.on('error', reject)
          })
          req.on('error', reject)
          req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
          req.write(reqBody)
          req.end()
        })
        const result = JSON.parse(resp)
        if (result.id) return `✅ Reply sent to ${from} (ID: ${result.id})`
        return `Failed to reply: ${resp.slice(0, 300)}`
      } catch (e) {
        return `Reply failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

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
          fetchUrl(url).then(html => {
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
          const html = await fetchUrl(url)
          const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          return `Page content from ${url} (via HTTP fetch):\n\n${text.slice(0, 5000)}`
        } catch (e2) {
          return `Browse failed: ${e2 instanceof Error ? e2.message : String(e2)}`
        }
      }
    }

    case 'write_file': {
      const filePath = params.path as string
      const content = params.content as string
      if (!filePath || content === undefined) return 'Error: path and content required'
      try {
        const fs = await import('node:fs')
        const { dirname } = await import('node:path')
        fs.mkdirSync(dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, content, 'utf8')
        return `File written: ${filePath} (${content.length} chars)`
      } catch (e) {
        return `Write failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    case 'run_command': {
      const cmd = params.command as string
      if (!cmd) return 'Error: command required'
      // Safety: block dangerous commands
      const blocked = ['rm -rf', 'format', 'del /s', 'shutdown', 'taskkill', 'rmdir /s']
      if (blocked.some(b => cmd.toLowerCase().includes(b))) {
        return `Blocked: "${cmd}" is a destructive command. Ask Daniel for confirmation first.`
      }
      try {
        const { execSync } = await import('node:child_process')
        const output = execSync(cmd, { timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 1024 })
        return `Command: ${cmd}\n\n${output.slice(0, 3000)}`
      } catch (e) {
        return `Command failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    default:
      return executeTool(name, params)
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

  const context = buildContext()
  const systemPrompt = `You are Jarvis, Daniel's personal AI agent. You run on his Windows PC (${os.hostname()}).
You have FULL access to his system via tools. ALWAYS use tools to get real data — never guess.

RULES:
1. Use tools proactively for any data request (files, system, web, CRM, etc.)
2. Chain multiple tools when needed. Think step by step.
3. Be concise — this goes to Telegram.
4. Ask clarifying questions when needed.
5. You ARE Jarvis. Never identify as Qwen/GPT/etc.
6. Today: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
7. Daniel's paths: home=C:/Users/DanielV2, Desktop=C:/Users/DanielV2/Desktop

EMAIL — You HAVE gmail_send and gmail_reply. You CAN send emails. NEVER say "I cannot send".
- First call: gmail_send with confirmed=false → shows draft to Daniel
- When Daniel says "send"/"yes"/"do it" → call gmail_send with confirmed=true IMMEDIATELY
- For replies: use gmail_reply with message_id from gmail_search

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
