/**
 * tool-infra.ts -- Shared read-only tool infrastructure for chat.ts and godmode.ts
 *
 * Exports:
 *   fetchUrl()          HTTP/HTTPS GET with redirect following
 *   executeTool()       Read-only tool dispatcher (web_search, web_fetch, crm_search,
 *                       knowledge_search, system_info, list_files, file_read, file_list)
 *   extractToolCalls()  Parse [TOOL:name]({"param":"value"}) from LLM output
 *   buildContext()      Load CRM + knowledge context from SQLite
 *   TOOL_REGEX          RegExp source for tool-call pattern
 *   getProjectRoot()    Resolve the project root for file tools
 */

import { DatabaseSync } from 'node:sqlite'
import http from 'http'
import https from 'https'
import os from 'os'
import fs, { realpathSync } from 'fs'
import { join, resolve, relative } from 'path'

// ─── Read-Only Tool Registry ──────────────────────────────────────────────────

/** Single source of truth for read-only tools available to copilot surfaces. */
export const READONLY_TOOL_NAMES = [
  "web_search", "web_fetch", "crm_search", "knowledge_search",
  "system_info", "list_files", "file_read", "file_list",
  "gmail_search", "gmail_read", "agent_status", "browse_page",
] as const;

export type ReadOnlyToolName = (typeof READONLY_TOOL_NAMES)[number];

/** Check if a tool name is in the read-only registry. */
export function isReadOnlyTool(name: string): name is ReadOnlyToolName {
  return (READONLY_TOOL_NAMES as readonly string[]).includes(name);
}

// ─── Tool Sensitivity Classification ──────────────────────────────────────────

/** Tools that access potentially sensitive content (email, files). */
export const SENSITIVE_READ_TOOLS = new Set(["gmail_search", "gmail_read", "file_read", "browse_page"]);
/** Tools that only access public or system data. */
export const SAFE_READ_TOOLS = new Set(["web_search", "web_fetch", "crm_search", "knowledge_search", "system_info", "list_files", "file_list", "agent_status"]);

// ─── Prompt Sanitization ──────────────────────────────────────────────────────

/** Strip content that could be interpreted as instructions by the LLM. */
export function sanitizeForPrompt(text: string): string {
  return text
    // Remove script/style content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode entities
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    // Remove common prompt injection patterns
    .replace(/\[SYSTEM\][\s\S]*?\[\/SYSTEM\]/gi, '[content removed]')
    .replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '[content removed]')
    .replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/gi, '[content removed]')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Project Root ──────────────────────────────────────────────────────────────

/** Project root for file_read/file_list tools. Configurable via env or config. */
export function getProjectRoot(): string {
  return resolve(process.env.JARVIS_PROJECT_ROOT ?? join(os.homedir(), 'Documents', 'Playground'))
}

// ─── HTTP Fetch ────────────────────────────────────────────────────────────────

export interface FetchUrlOptions {
  userAgent?: string
  timeout?: number
  /** Internal: remaining redirect hops (default 5). */
  _redirectsLeft?: number
}

const MAX_REDIRECTS = 5

export function fetchUrl(url: string, opts: FetchUrlOptions = {}): Promise<string> {
  const userAgent = opts.userAgent ?? 'Jarvis/1.0'
  const timeout = opts.timeout ?? 15000
  const redirectsLeft = opts._redirectsLeft ?? MAX_REDIRECTS
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': userAgent } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`))
          return
        }
        // Resolve relative Location headers against the original URL
        const resolved = new URL(res.headers.location, url).href
        fetchUrl(resolved, { ...opts, _redirectsLeft: redirectsLeft - 1 }).then(resolve).catch(reject)
        return
      }
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ─── Tool-call Extraction ──────────────────────────────────────────────────────

export const TOOL_REGEX = /\[TOOL:(\w+)\]\((\{[\s\S]*?\})\)/g

export function extractToolCalls(text: string): Array<{ name: string; params: Record<string, unknown>; fullMatch: string }> {
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

// ─── Context Builder ───────────────────────────────────────────────────────────

export interface BuildContextOptions {
  /** Include the decisions table from knowledge.db (default: false) */
  includeDecisions?: boolean
}

export function buildContext(opts: BuildContextOptions = {}): string {
  const lines: string[] = []
  const jarvisDir = join(os.homedir(), '.jarvis')
  try {
    const db = new DatabaseSync(join(jarvisDir, 'crm.db'))
    const contacts = db.prepare(
      "SELECT name, company, role, stage, score, tags FROM contacts ORDER BY score DESC"
    ).all() as Array<Record<string, unknown>>
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

    let decisions: Array<{ agent_id: string; action: string; reasoning: string; outcome: string; created_at: string }> = []
    if (opts.includeDecisions) {
      decisions = kb.prepare("SELECT agent_id, action, reasoning, outcome, created_at FROM decisions ORDER BY created_at DESC LIMIT 10").all() as typeof decisions
    }

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

// ─── Read-only Tool Execution ──────────────────────────────────────────────────

export interface WebSearchOptions {
  /** Custom search implementation. When not provided, uses DuckDuckGo HTML scrape. */
  handler?: (query: string, fetchFn: typeof fetchUrl) => Promise<string>
}

/**
 * Execute a read-only tool by name.
 *
 * Supported tools: web_search, web_fetch, crm_search, knowledge_search,
 * system_info, list_files, file_read, file_list.
 *
 * @param name       Tool name
 * @param params     Tool parameters
 * @param options    Optional overrides (e.g. custom web_search handler, fetchUrl options)
 */
export async function executeTool(
  name: string,
  params: Record<string, unknown>,
  options: { fetch?: FetchUrlOptions; webSearch?: WebSearchOptions } = {}
): Promise<string> {
  const fetch = (url: string) => fetchUrl(url, options.fetch)

  switch (name) {
    case 'web_search': {
      const query = (params.query as string) ?? ''
      if (!query) return 'Error: query is required'
      // Allow callers to provide a custom search implementation
      if (options.webSearch?.handler) {
        return options.webSearch.handler(query, fetchUrl)
      }
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const html = await fetch(url)
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
          const textContent = sanitizeForPrompt(html)
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
        const html = await fetch(url)
        // Strip nav/footer before general sanitization
        const stripped = html
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        const text = sanitizeForPrompt(stripped)
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
      return `System Info:\n- Platform: ${os.platform()} ${os.arch()}\n- CPU: ${cpus[0]?.model ?? 'unknown'} (${cpus.length} cores)\n- Memory: ${usedPct}% used (${Math.round(freeMem / 1024 / 1024 / 1024)}GB free / ${Math.round(totalMem / 1024 / 1024 / 1024)}GB total)\n- Uptime: ${Math.round(os.uptime() / 3600)}h\n- Hostname: ${os.hostname()}`
    }

    case 'list_files': {
      const targetPath = (params.path as string) ?? join(os.homedir(), 'Desktop')
      try {
        const entries = fs.readdirSync(targetPath, { withFileTypes: true })
        const items = entries.slice(0, 50).map(e => {
          const type = e.isDirectory() ? '\u{1F4C1}' : '\u{1F4C4}'
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

    case 'file_read': {
      const filePath = params.path as string
      if (!filePath) return 'Error: path is required'
      try {
        const PROJECT_ROOT = realpathSync(getProjectRoot())
        const absPath = resolve(PROJECT_ROOT, filePath)
        if (!absPath.startsWith(PROJECT_ROOT)) return 'Error: path must be within the project directory'
        if (!fs.existsSync(absPath)) return `Error: file not found: ${filePath}`
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
        const realAbsPath = realpathSync(absPath)
        if (!realAbsPath.startsWith(PROJECT_ROOT)) return 'Error: path must be within the project directory'
        if (!fs.statSync(realAbsPath).isDirectory()) return `Error: ${dirPath} is a file, use file_read instead`

        const entries: string[] = []
        function walk(dir: string, depth: number) {
          if (depth > 4) return
          const items = fs.readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
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

// ─── Gmail Helpers ────────────────────────────────────────────────────────────

export function loadGmailConfig(): { client_id: string; client_secret: string; refresh_token: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(join(os.homedir(), '.jarvis', 'config.json'), 'utf8'))
    return raw.gmail ?? null
  } catch { return null }
}

export function httpsPost(url: string, body: string, headers: Record<string, string> = {}): Promise<string> {
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

export function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
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

export async function getGmailAccessToken(): Promise<string | null> {
  const cfg = loadGmailConfig()
  if (!cfg) return null
  const body = `client_id=${cfg.client_id}&client_secret=${cfg.client_secret}&refresh_token=${cfg.refresh_token}&grant_type=refresh_token`
  const resp = JSON.parse(await httpsPost('https://oauth2.googleapis.com/token', body))
  return resp.access_token ?? null
}
