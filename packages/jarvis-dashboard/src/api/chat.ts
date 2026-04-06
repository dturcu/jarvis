import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import http from 'http'
import https from 'https'
import os from 'os'
import { join } from 'path'

const LMS_URL = process.env.LMS_URL ?? 'http://localhost:1234'
const DEFAULT_MODEL = process.env.LMS_MODEL ?? 'qwen/qwen3.5-35b-a3b'

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
        // Use DuckDuckGo HTML for search
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const html = await fetchUrl(url)
        // Extract result snippets
        const results: string[] = []
        const regex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
        let match: RegExpExecArray | null
        let count = 0
        while ((match = regex.exec(html)) !== null && count < 8) {
          const title = match[2]?.replace(/<[^>]+>/g, '').trim() ?? ''
          const snippet = match[3]?.replace(/<[^>]+>/g, '').trim() ?? ''
          const href = match[1] ?? ''
          if (title) {
            results.push(`${count + 1}. ${title}\n   ${snippet}\n   URL: ${href}`)
            count++
          }
        }
        if (results.length === 0) {
          // Fallback: extract any text content
          const textContent = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          return `Search results for "${query}":\n${textContent.slice(0, 2000)}`
        }
        return `Search results for "${query}":\n\n${results.join('\n\n')}`
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

    default:
      return `Unknown tool: ${name}`
  }
}

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': 'Jarvis/1.0' } }, (res) => {
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
    lmsReq.write(body)
    lmsReq.end()
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
  lmsReq.end()
})
