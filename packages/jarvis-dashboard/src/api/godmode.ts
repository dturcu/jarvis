import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import http from 'http'
import os from 'os'
import fs from 'fs'
import { join } from 'path'
import { ChannelStore } from '@jarvis/runtime'
import {
  executeTool,
  extractToolCalls,
  buildContext,
} from './tool-infra.js'

const LMS_URL = process.env.LMS_URL ?? 'http://localhost:1234'
const DEFAULT_MODEL = process.env.LMS_MODEL ?? 'qwen/qwen3.5-35b-a3b'

// ─── Intent Classification ───────────────────────────────────────────────────

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

// ─── Tool Descriptions (godmode-specific: includes file_read/file_list) ──────

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

// ─── LLM Communication ──────────────────────────────────────────────────────

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

// ─── SSE Helper ──────────────────────────────────────────────────────────────

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

  let fullTextForArtifacts = ''

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

    fullTextForArtifacts = fullResponse

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

  // Record interaction in channel store for lineage tracking
  try {
    const runtimeDbPath = join(os.homedir(), '.jarvis', 'runtime.db')
    if (fs.existsSync(runtimeDbPath)) {
      const trackDb = new DatabaseSync(runtimeDbPath)
      trackDb.exec("PRAGMA journal_mode = WAL;")
      trackDb.exec("PRAGMA busy_timeout = 5000;")
      const cs = new ChannelStore(trackDb)
      const sessionId = (req.body as { sessionId?: string }).sessionId ?? `godmode-${Date.now()}`
      const threadId = cs.getOrCreateThread('dashboard', sessionId, 'Godmode session')
      cs.recordMessage({
        threadId,
        channel: 'dashboard',
        direction: 'inbound',
        contentPreview: message,
        sender: 'operator',
      })
      cs.recordMessage({
        threadId,
        channel: 'dashboard',
        direction: 'outbound',
        contentPreview: fullTextForArtifacts,
        sender: 'jarvis',
      })
      trackDb.close()
    }
  } catch { /* best-effort channel tracking */ }

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
