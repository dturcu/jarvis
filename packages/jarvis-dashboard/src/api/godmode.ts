import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import http from 'http'
import https from 'https'
import os from 'os'
import fs, { realpathSync } from 'fs'
import { join, resolve, relative } from 'path'

const LMS_URL = process.env.LMS_URL ?? 'http://localhost:1234'
const DEFAULT_MODEL = process.env.LMS_MODEL ?? 'qwen/qwen3.5-35b-a3b'

/** Project root for file_read/file_list tools. Configurable via env or config. */
function getProjectRoot(): string {
  return resolve(process.env.JARVIS_PROJECT_ROOT ?? join(os.homedir(), 'Documents', 'Playground'))
}

// ─── Intent Classification ───────────────────────────��──────────────────────

const INTENT_SYSTEM_PROMPT = `You are an intent classifier. Given a user message, return ONLY valid JSON (no markdown, no explanation) with this shape:
{"intent":"<type>","surfaces":["chat",...],"tools":[...]}

Intent types and their surfaces:
- "chat" → surfaces:["chat"] — conversational Q&A, factual queries, simple questions
- "artifact" → surfaces:["chat","artifact"] — generate code, HTML, React components, SVG, diagrams, documents
- "research" → surfaces:["chat","research"] — deep investigation requiring multiple searches, compare sources
- "code" → surfaces:["chat","code"] — write/explain/debug code, terminal commands, scripts
- "cowork" → surfaces:["chat","cowork"] — multi-step tasks: file operations, CRM updates, workflows

Available tools: web_search, web_fetch, crm_search, knowledge_search, system_info, file_read, file_list

Examples:
User: "What's the weather like?" → {"intent":"chat","surfaces":["chat"],"tools":["web_search"]}
User: "Create an HTML dashboard with charts" → {"intent":"artifact","surfaces":["chat","artifact"],"tools":[]}
User: "Research ISO 26262 Part 6 testing" → {"intent":"research","surfaces":["chat","research"],"tools":["web_search","web_fetch"]}
User: "Write a function to sort contacts" → {"intent":"code","surfaces":["chat","code"],"tools":[]}
User: "Check my CRM pipeline status" → {"intent":"chat","surfaces":["chat"],"tools":["crm_search"]}
User: "Find top prospects and draft outreach" → {"intent":"cowork","surfaces":["chat","cowork"],"tools":["crm_search"]}
User: "Review the godmode.ts code" → {"intent":"code","surfaces":["chat","code"],"tools":["file_read","file_list"]}
User: "What files are in the project?" → {"intent":"chat","surfaces":["chat"],"tools":["file_list"]}

Return ONLY the JSON object.`

interface IntentResult {
  intent: string
  surfaces: string[]
  tools: string[]
}

async function classifyIntent(message: string, model: string): Promise<IntentResult> {
  const fallback: IntentResult = { intent: 'chat', surfaces: ['chat'], tools: [] }
  try {
    const response = await llmChat([
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: message }
    ], model, 0.1, 200)

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallback
    const parsed = JSON.parse(jsonMatch[0]) as IntentResult
    if (!parsed.intent || !Array.isArray(parsed.surfaces)) return fallback
    // Ensure chat is always present
    if (!parsed.surfaces.includes('chat')) parsed.surfaces.unshift('chat')
    return parsed
  } catch {
    return fallback
  }
}

// ─── Surface-Specific System Prompts ────────────────────────────────────────

const SURFACE_PROMPTS: Record<string, string> = {
  chat: `You are Jarvis, an autonomous AI assistant for Thinking in Code — Daniel Turcu's automotive safety consulting firm (ISO 26262, ASPICE, AUTOSAR, cybersecurity).

Be direct, specific, and thorough. Use your tools when you need live data.`,

  artifact: `You are Jarvis, an AI assistant that creates rich artifacts.

When generating code, HTML, React components, SVG, or diagrams, wrap the output in a special artifact block:

\`\`\`artifact:TYPE
TITLE: <descriptive title>
<content here>
\`\`\`

Where TYPE is one of: html, react, svg, mermaid, markdown, css, typescript, javascript

For HTML artifacts: produce a complete, self-contained HTML document with inline styles.
For React artifacts: produce a single functional component with inline styles (no imports needed, React is available).
For SVG artifacts: produce valid SVG markup.
For Mermaid artifacts: produce valid Mermaid diagram syntax.

ALWAYS use the artifact block format for generated content. Be creative and produce polished results.`,

  research: `You are Jarvis, conducting deep research. Structure your response in phases:

1. SEARCH PHASE: Use web_search to find relevant sources. Search multiple queries to get broad coverage.
2. READ PHASE: Use web_fetch on the most promising URLs to get detailed content.
3. SYNTHESIZE PHASE: Combine findings into a structured analysis with citations.

Format your final output with:
- An executive summary
- Key findings as numbered points
- Source citations as [1], [2], etc.
- A sources list at the end

Be thorough. Search at least 2-3 different queries. Read at least 2-3 sources.`,

  code: `You are Jarvis, a coding assistant. When writing code:

1. Produce clean, well-structured code
2. Include brief inline comments for complex logic
3. Wrap code output in standard fenced code blocks with language tags
4. If explaining code, use clear step-by-step breakdowns
5. For terminal commands, prefix with $ to indicate shell commands`,

  cowork: `You are Jarvis, executing a multi-step task. Break your work into clear steps:

For each step, output a step marker:
[STEP:1] Description of what you're doing

Then execute the step using available tools. After each step completes, output the next step marker.

Be systematic. Complete all steps before summarizing results.`
}

// ─── Tool Infrastructure (replicated from chat.ts since it doesn't export) ──

const TOOL_DESCRIPTIONS = `
You have these tools available. To use one, output EXACTLY this format on its own line:
[TOOL:tool_name]({"param":"value"})

After you output a tool call, STOP and wait. The system will execute it and give you the result. Then continue your response.

Available tools:

1. [TOOL:web_search]({"query":"search terms"})
   Search the web for current information.

2. [TOOL:web_fetch]({"url":"https://example.com"})
   Fetch and read the content of a specific URL.

3. [TOOL:crm_search]({"query":"company or person name"})
   Search the CRM pipeline for contacts.

4. [TOOL:knowledge_search]({"query":"topic", "collection":"lessons|playbooks|iso26262|contracts|proposals"})
   Search the Jarvis knowledge base.

5. [TOOL:system_info]({})
   Get current system info: CPU, memory, disk usage.

6. [TOOL:file_read]({"path":"src/index.ts"})
   Read a file from the project directory. Path is relative to the project root.

7. [TOOL:file_list]({"path":"src", "recursive": false})
   List files in a directory. Set recursive to true to include subdirectories.

Rules:
- Use tools when you need live/current data
- Use file_read and file_list when asked to review, analyze, or look at code
- You can chain multiple tool calls
- After receiving tool results, synthesize them into a clear answer
`.trim()

async function executeTool(name: string, params: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'web_search': {
      const query = (params.query as string) ?? ''
      if (!query) return 'Error: query is required'
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const html = await fetchUrl(url)
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
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ').trim()
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
        return `CRM results for "${query}":\n${rows.map(r => `- ${r.name} (${r.company}, ${r.role ?? 'N/A'}) — stage: ${r.stage}, score: ${r.score}, email: ${r.email ?? 'N/A'}`).join('\n')}`
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
        return `Knowledge results for "${query}":\n${rows.map(r => `- [${r.collection}] ${r.title}\n  ${(r.content as string).slice(0, 200)}`).join('\n')}`
      } catch (e) {
        return `Knowledge search failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    case 'system_info': {
      const cpus = os.cpus()
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const usedPct = Math.round(((totalMem - freeMem) / totalMem) * 100)
      return `System Info:\n- Platform: ${os.platform()} ${os.arch()}\n- CPU: ${cpus[0]?.model ?? 'unknown'} (${cpus.length} cores)\n- Memory: ${usedPct}% used (${Math.round(freeMem / 1073741824)}GB free / ${Math.round(totalMem / 1073741824)}GB total)\n- Uptime: ${Math.round(os.uptime() / 3600)}h\n- Hostname: ${os.hostname()}`
    }
    case 'file_read': {
      const filePath = params.path as string
      if (!filePath) return 'Error: path is required'
      try {
        const PROJECT_ROOT = realpathSync(getProjectRoot())
        const absPath = resolve(PROJECT_ROOT, filePath)
        // Security: prevent path traversal outside project
        if (!absPath.startsWith(PROJECT_ROOT)) return 'Error: path must be within the project directory'
        if (!fs.existsSync(absPath)) return `Error: file not found: ${filePath}`
        // Resolve symlinks before final check to prevent symlink-based traversal
        const realPath = realpathSync(absPath)
        if (!realPath.startsWith(PROJECT_ROOT)) return 'Error: path must be within the project directory'
        const stat = fs.statSync(absPath)
        if (stat.isDirectory()) return `Error: ${filePath} is a directory, use file_list instead`
        if (stat.size > 100_000) return `Error: file too large (${Math.round(stat.size / 1024)}KB). Max 100KB.`
        const content = fs.readFileSync(absPath, 'utf-8')
        const lines = content.split('\n')
        const numbered = lines.map((line, i) => `${i + 1} | ${line}`).join('\n')
        return `File: ${filePath} (${lines.length} lines)\n\n${numbered}`
      } catch (e) {
        return `File read failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    case 'file_list': {
      const dirPath = (params.path as string) ?? '.'
      const recursive = (params.recursive as boolean) ?? false
      try {
        const PROJECT_ROOT = realpathSync(getProjectRoot())
        const absPath = resolve(PROJECT_ROOT, dirPath)
        if (!absPath.startsWith(PROJECT_ROOT)) return 'Error: path must be within the project directory'
        if (!fs.existsSync(absPath)) return `Error: directory not found: ${dirPath}`
        // Resolve symlinks before final check to prevent symlink-based traversal
        const realAbsPath = realpathSync(absPath)
        if (!realAbsPath.startsWith(PROJECT_ROOT)) return 'Error: path must be within the project directory'
        if (!fs.statSync(realAbsPath).isDirectory()) return `Error: ${dirPath} is a file, use file_read instead`

        const entries: string[] = []
        function walk(dir: string, depth: number) {
          if (depth > 4) return // max depth safety
          const items = fs.readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            // Skip common non-useful dirs
            if (['node_modules', '.git', 'dist', '.next', '.cache'].includes(item.name)) continue
            const rel = relative(PROJECT_ROOT, join(dir, item.name))
            if (item.isDirectory()) {
              entries.push(`${rel}/`)
              if (recursive) walk(join(dir, item.name), depth + 1)
            } else {
              const stat = fs.statSync(join(dir, item.name))
              entries.push(`${rel} (${stat.size > 1024 ? Math.round(stat.size / 1024) + 'KB' : stat.size + 'B'})`)
            }
          }
        }
        walk(absPath, 0)
        if (entries.length === 0) return `Directory ${dirPath} is empty`
        return `Directory: ${dirPath} (${entries.length} items)\n\n${entries.join('\n')}`
      } catch (e) {
        return `File list failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    default:
      return `Unknown tool: ${name}`
  }
}

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': 'Jarvis/1.0' } }, (res) => {
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

const TOOL_REGEX = /\[TOOL:(\w+)\]\((\{[\s\S]*?\})\)/g

function extractToolCalls(text: string): Array<{ name: string; params: Record<string, unknown>; fullMatch: string }> {
  const calls: Array<{ name: string; params: Record<string, unknown>; fullMatch: string }> = []
  const regex = new RegExp(TOOL_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    try {
      const params = JSON.parse(match[2]!) as Record<string, unknown>
      calls.push({ name: match[1]!, params, fullMatch: match[0] })
    } catch { /* skip malformed */ }
  }
  return calls
}

// ─── Artifact Extraction ────────────────────────────────────────────────────

const ARTIFACT_REGEX = /```artifact:(\w+)\nTITLE:\s*(.+)\n([\s\S]*?)```/g

function extractArtifacts(text: string): Array<{ kind: string; title: string; content: string }> {
  const artifacts: Array<{ kind: string; title: string; content: string }> = []
  const regex = new RegExp(ARTIFACT_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    artifacts.push({ kind: match[1]!, title: match[2]!.trim(), content: match[3]!.trim() })
  }
  return artifacts
}

// ─── Context Builder ───────────────────────────────────────────────────────��

function buildContext(): string {
  const lines: string[] = []
  const jarvisDir = join(os.homedir(), '.jarvis')
  try {
    const db = new DatabaseSync(join(jarvisDir, 'crm.db'))
    const contacts = db.prepare("SELECT name, company, role, stage, score, tags FROM contacts ORDER BY score DESC").all() as Array<Record<string, unknown>>
    db.close()
    if (contacts.length > 0) {
      lines.push('## CRM Pipeline')
      for (const c of contacts) {
        let tags: string[] = []
        try { tags = JSON.parse(c.tags as string) } catch {}
        lines.push(`- ${c.name} (${c.company}, ${c.role ?? 'unknown'}) — stage: ${c.stage}, score: ${c.score}${tags.length ? ', tags: ' + tags.join(', ') : ''}`)
      }
    }
  } catch {}
  try {
    const kb = new DatabaseSync(join(jarvisDir, 'knowledge.db'))
    const playbooks = kb.prepare("SELECT title, body FROM playbooks ORDER BY use_count DESC LIMIT 5").all() as Array<{ title: string; body: string }>
    const lessons = kb.prepare("SELECT title, content FROM documents WHERE collection = 'lessons' ORDER BY created_at DESC LIMIT 5").all() as Array<{ title: string; content: string }>
    kb.close()
    if (playbooks.length > 0) {
      lines.push('\n## Playbooks')
      for (const p of playbooks) lines.push(`### ${p.title}\n${p.body.slice(0, 400)}`)
    }
    if (lessons.length > 0) {
      lines.push('\n## Recent Lessons')
      for (const l of lessons) lines.push(`- ${l.title}: ${l.content.slice(0, 200)}`)
    }
  } catch {}
  return lines.join('\n')
}

// ─── LLM Communication ─────────────────────────────��───────────────────────

function llmChat(messages: Array<{ role: string; content: string }>, model: string, temperature = 0.3, maxTokens = 2048): Promise<string> {
  return new Promise((resolve, reject) => {
    const lmsUrl = new URL(`${LMS_URL}/v1/chat/completions`)
    const body = JSON.stringify({ model, messages, stream: false, temperature, max_tokens: maxTokens })
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

function streamLlm(
  res: import('express').Response,
  messages: Array<{ role: string; content: string }>,
  model: string,
  onEvent: (type: string, data: unknown) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const lmsUrl = new URL(`${LMS_URL}/v1/chat/completions`)
    const body = JSON.stringify({ model, messages, stream: true, temperature: 0.3, max_tokens: 4096 })
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
              onEvent('thinking', delta.reasoning_content)
            }
            if (delta?.content) {
              fullText += delta.content
              onEvent('token', delta.content)
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

// ─── SSE Helper ───────────────────��─────────────────────────────────���───────

function sendSSE(res: import('express').Response, type: string, data: unknown) {
  res.write(`data: ${JSON.stringify({ type, ...data as Record<string, unknown> })}\n\n`)
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const godmodeRouter = Router()

godmodeRouter.post('/', async (req, res) => {
  const { message, model, history = [] } = req.body as {
    message: string
    model?: string
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return }

  const chosenModel = model ?? DEFAULT_MODEL

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  const socket = res.socket as (NodeJS.Socket & { setNoDelay?: (v: boolean) => void }) | null
  socket?.setNoDelay?.(true)

  try {
    // Step 1: Intent classification
    const intent = await classifyIntent(message, chosenModel)
    sendSSE(res, 'surface', { surfaces: intent.surfaces })

    // Step 2: Build system prompt based on surfaces
    const context = buildContext()
    const surfaceKey = intent.surfaces.find(s => s !== 'chat') ?? 'chat'
    const surfacePrompt = SURFACE_PROMPTS[surfaceKey] ?? SURFACE_PROMPTS.chat!

    const systemPrompt = `${surfacePrompt}

${intent.tools.length > 0 || ['research', 'cowork'].includes(intent.intent) ? TOOL_DESCRIPTIONS : ''}

LIVE DATA (from Jarvis databases):
${context}

Today is ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`

    const msgs = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10),
      { role: 'user', content: message }
    ]

    // Step 3: Stream main response
    let stepIndex = 0
    const fullResponse = await streamLlm(res, msgs, chosenModel, (type, data) => {
      if (type === 'thinking') {
        sendSSE(res, 'thinking', { content: data })
      } else if (type === 'token') {
        sendSSE(res, 'token', { content: data })
      }
    })

    // Step 4: Check for tool calls — execute ONCE, cache results
    const toolCalls = extractToolCalls(fullResponse)
    if (toolCalls.length > 0) {
      // Execute each tool once and cache the result
      const cachedResults: string[] = []

      for (const call of toolCalls) {
        const toolId = `t${Date.now()}`
        sendSSE(res, 'tool_start', { id: toolId, name: call.name, params: call.params })

        // For research mode, emit research phase
        if (intent.intent === 'research') {
          if (call.name === 'web_search') {
            sendSSE(res, 'research_step', { phase: 'searching', detail: `Searching: ${(call.params.query as string) ?? ''}` })
          } else if (call.name === 'web_fetch') {
            sendSSE(res, 'research_step', { phase: 'reading', detail: `Reading: ${(call.params.url as string) ?? ''}` })
          }
        }

        // For cowork mode, emit step markers
        if (intent.intent === 'cowork') {
          sendSSE(res, 'step', { index: stepIndex, action: `${call.name}: ${JSON.stringify(call.params).slice(0, 80)}`, status: 'running' })
        }

        const startTime = Date.now()
        const result = await executeTool(call.name, call.params)
        const duration = Date.now() - startTime

        // Cache the result — do NOT re-execute during synthesis
        cachedResults.push(result)

        sendSSE(res, 'tool_result', { id: toolId, name: call.name, result: result.slice(0, 2000), duration })

        if (intent.intent === 'cowork') {
          sendSSE(res, 'step', { index: stepIndex, action: `${call.name}`, status: 'done' })
          stepIndex++
        }
      }

      // Synthesize phase for research
      if (intent.intent === 'research') {
        sendSSE(res, 'research_step', { phase: 'synthesizing', detail: 'Combining findings...' })
      }

      // Build synthesis prompt using CACHED results (no re-execution)
      msgs.push({ role: 'assistant', content: fullResponse })

      const toolResults: string[] = []
      for (let i = 0; i < toolCalls.length; i++) {
        toolResults.push(`[Tool Result for ${toolCalls[i]!.name}]:\n${cachedResults[i]!}`)
      }

      msgs.push({
        role: 'user',
        content: `${toolResults.join('\n\n')}\n\nNow synthesize these results into a clear, comprehensive answer. Do NOT output any more tool calls.${intent.intent === 'artifact' ? ' If appropriate, generate an artifact.' : ''}`
      })

      sendSSE(res, 'token', { content: '\n\n---\n\n' })

      await streamLlm(res, msgs, chosenModel, (type, data) => {
        if (type === 'thinking') {
          sendSSE(res, 'thinking', { content: data })
        } else if (type === 'token') {
          sendSSE(res, 'token', { content: data })
        }
      })

      if (intent.intent === 'research') {
        sendSSE(res, 'research_step', { phase: 'done', detail: 'Research complete' })
      }
    }

    // Step 5: Extract artifacts from the full response stream
    // We need to re-check the complete response for artifact blocks
    // The artifacts are already in the streamed text, but we send explicit artifact events
    // for the frontend to render in the artifact panel
    const fullTextForArtifacts = fullResponse
    const artifacts = extractArtifacts(fullTextForArtifacts)
    for (const artifact of artifacts) {
      sendSSE(res, 'artifact', {
        id: `a${Date.now()}`,
        kind: artifact.kind,
        title: artifact.title,
        content: artifact.content
      })
    }

  } catch (e) {
    sendSSE(res, 'error', { message: e instanceof Error ? e.message : String(e) })
  }

  res.write('data: [DONE]\n\n')
  res.end()
})

// GET /api/godmode/models — proxy to LM Studio
godmodeRouter.get('/models', (_req, res) => {
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
