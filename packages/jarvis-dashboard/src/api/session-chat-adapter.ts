/**
 * session-chat-adapter.ts -- OpenClaw session-backed operator chat adapter.
 *
 * Bridges the godmode UX (intent classification, artifact extraction,
 * multi-surface streaming) with OpenClaw session delivery. The dashboard
 * becomes a client of OpenClaw sessions rather than a sibling orchestrator.
 *
 * Target state (from ADR-CHAT-SURFACES.md): "Only OpenClaw owns the
 * operator chat loop." This adapter is the migration bridge:
 *
 *   Dashboard UI  -->  SessionChatAdapter  -->  OpenClaw Gateway
 *                                          |
 *                                          '--> Legacy godmode (fallback)
 *
 * The v2 route provides the same REST interface as /api/godmode but
 * delegates to the session adapter. When the gateway is unreachable it
 * falls back to the legacy godmode endpoint transparently.
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import {
  invokeGatewayMethod,
  sendSessionMessage,
  type GatewayCallOptions,
} from '@jarvis/shared'
import {
  READONLY_TOOL_NAMES,
  type ReadOnlyToolName,
} from './tool-infra.js'

// ---- Types ----------------------------------------------------------------

export type SessionChatMode = 'chat' | 'research' | 'artifact' | 'code' | 'cowork'

export interface SessionChatResponse {
  reply: string
  artifacts?: Array<{ type: string; content: string; name?: string }>
  tool_calls?: Array<{ name: string; result: unknown }>
  session_key: string
}

export interface SessionInfo {
  session_key: string
  created_at: string
  last_active: string
  message_count: number
}

/** Shape returned by the gateway's sessions.send method. */
interface GatewaySendResult {
  reply?: string
  content?: string
  artifacts?: Array<{ type: string; content: string; name?: string }>
  tool_calls?: Array<{ name: string; result: unknown }>
  session_key?: string
  key?: string
}

/** Shape returned by the gateway's sessions.list method. */
interface GatewaySessionEntry {
  key?: string
  session_key?: string
  created_at?: string
  last_active?: string
  message_count?: number
  messages?: number
}

/** Shape returned by the gateway's sessions.create method. */
interface GatewayCreateResult {
  key?: string
  session_key?: string
}

// ---- OpenClaw tool registration shape ------------------------------------

export interface SessionToolRegistration {
  name: string
  description: string
  parameters: Record<string, unknown>
  read_only: true
}

// ---- Adapter class -------------------------------------------------------

export class SessionChatAdapter {
  private readonly gatewayUrl: string
  private readonly gatewayToken: string
  private readonly timeoutMs: number

  constructor(config: {
    gatewayUrl?: string
    gatewayToken?: string
    timeoutMs?: number
  } = {}) {
    this.gatewayUrl =
      config.gatewayUrl ??
      process.env.JARVIS_GATEWAY_URL ??
      `ws://127.0.0.1:${process.env.JARVIS_GATEWAY_PORT ?? '18789'}`
    this.gatewayToken =
      config.gatewayToken ??
      process.env.JARVIS_GATEWAY_TOKEN ??
      ''
    this.timeoutMs = config.timeoutMs ?? 60_000
  }

  // -- Public API ----------------------------------------------------------

  /**
   * Send a message to an operator session and get the response.
   *
   * The mode hint is forwarded as metadata so OpenClaw can route to the
   * appropriate surface prompt / plugin configuration.
   */
  async sendMessage(params: {
    sessionKey: string
    message: string
    mode?: SessionChatMode
  }): Promise<SessionChatResponse> {
    const overrides = this.callOptions()

    // Build the message payload. The mode is sent as a prefix directive
    // that the session plugin can interpret, keeping the wire format simple.
    const modeDirective = params.mode && params.mode !== 'chat'
      ? `[mode:${params.mode}] `
      : ''

    const raw = await sendSessionMessage(
      {
        sessionKey: params.sessionKey,
        message: `${modeDirective}${params.message}`,
        timeoutMs: this.timeoutMs,
      },
      undefined, // no OpenClawConfig -- we use overrides
      overrides,
    ) as GatewaySendResult

    return normalizeResponse(raw, params.sessionKey)
  }

  /**
   * List active operator sessions known to the gateway.
   */
  async listSessions(): Promise<SessionInfo[]> {
    const overrides = this.callOptions()
    const raw = await invokeGatewayMethod<{ sessions?: GatewaySessionEntry[] }>(
      'sessions.list',
      undefined,
      {},
      overrides,
    )

    const entries = raw.sessions ?? []
    return entries.map(normalizeSessionInfo)
  }

  /**
   * Get or create the default session for a given operator.
   *
   * Convention: the default session key is `operator:<operatorId>`.
   * If the session does not exist the gateway creates one.
   */
  async getOrCreateOperatorSession(operatorId: string): Promise<string> {
    const sessionKey = `operator:${operatorId}`
    const overrides = this.callOptions()

    try {
      // Try to create -- gateway returns the existing key if it already exists
      const raw = await invokeGatewayMethod<GatewayCreateResult>(
        'sessions.create',
        undefined,
        { key: sessionKey },
        overrides,
      )
      return raw.key ?? raw.session_key ?? sessionKey
    } catch {
      // If create fails (e.g. session already exists), return the key
      return sessionKey
    }
  }

  /**
   * Probe whether the gateway is reachable.
   * Returns true if a lightweight method succeeds within a short timeout.
   */
  async isGatewayAvailable(): Promise<boolean> {
    try {
      await invokeGatewayMethod(
        'sessions.list',
        undefined,
        {},
        { ...this.callOptions(), timeoutMs: 3_000 },
      )
      return true
    } catch {
      return false
    }
  }

  // -- Internals -----------------------------------------------------------

  private callOptions(): GatewayCallOptions {
    return {
      gatewayUrl: this.gatewayUrl,
      gatewayToken: this.gatewayToken,
      timeoutMs: this.timeoutMs,
    }
  }
}

// ---- Response normalizers ------------------------------------------------

function normalizeResponse(
  raw: GatewaySendResult,
  sessionKey: string,
): SessionChatResponse {
  return {
    reply: raw.reply ?? raw.content ?? '',
    artifacts: raw.artifacts,
    tool_calls: raw.tool_calls,
    session_key: raw.session_key ?? raw.key ?? sessionKey,
  }
}

function normalizeSessionInfo(entry: GatewaySessionEntry): SessionInfo {
  return {
    session_key: entry.key ?? entry.session_key ?? '',
    created_at: entry.created_at ?? '',
    last_active: entry.last_active ?? '',
    message_count: entry.message_count ?? entry.messages ?? 0,
  }
}

// ---- Tool mapping --------------------------------------------------------

/**
 * Map the current read-only tool set from tool-infra.ts into OpenClaw
 * session tool registrations.
 *
 * Each tool is marked read_only so the session plugin can enforce the
 * same safety invariant as the legacy godmode: no mutations flow through
 * the dashboard chat surface.
 *
 * The returned array can be passed to `sessions.registerTools` or included
 * in a plugin manifest's `tools` section.
 */
export function mapGodmodeToolsToSessionTools(): SessionToolRegistration[] {
  const toolMeta: Record<ReadOnlyToolName, { description: string; parameters: Record<string, unknown> }> = {
    web_search: {
      description: 'Search the web for current information',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
    },
    web_fetch: {
      description: 'Fetch and read content from a specific URL',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to fetch' } },
        required: ['url'],
      },
    },
    crm_search: {
      description: 'Search the CRM pipeline for contacts',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Company or person name' } },
        required: ['query'],
      },
    },
    knowledge_search: {
      description: 'Search the Jarvis knowledge base',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search topic' },
          collection: { type: 'string', description: 'Collection: lessons, playbooks, iso26262, contracts, proposals' },
        },
        required: ['query'],
      },
    },
    system_info: {
      description: 'Get current system info: CPU, memory, disk usage',
      parameters: { type: 'object', properties: {} },
    },
    list_files: {
      description: 'List files and folders at a path',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path' } },
        required: ['path'],
      },
    },
    file_read: {
      description: 'Read a file from the project directory',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path relative to project root' } },
        required: ['path'],
      },
    },
    file_list: {
      description: 'List files in a directory with optional recursion',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to project root' },
          recursive: { type: 'boolean', description: 'Include subdirectories' },
        },
      },
    },
    gmail_search: {
      description: 'Search Gmail emails using Gmail search syntax',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query' },
          max_results: { type: 'number', description: 'Max emails to return' },
        },
        required: ['query'],
      },
    },
    gmail_read: {
      description: 'Read a specific email by message ID',
      parameters: {
        type: 'object',
        properties: { message_id: { type: 'string', description: 'Gmail message ID' } },
        required: ['message_id'],
      },
    },
    agent_status: {
      description: 'Get status of all Jarvis agents. Read-only.',
      parameters: { type: 'object', properties: {} },
    },
    browse_page: {
      description: 'Open a URL in the browser and extract page content',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to navigate to' } },
        required: ['url'],
      },
    },
  }

  // Build registrations only for tools in the canonical READONLY_TOOL_NAMES list
  return READONLY_TOOL_NAMES.map((name) => {
    const meta = toolMeta[name]
    return {
      name,
      description: meta.description,
      parameters: meta.parameters,
      read_only: true as const,
    }
  })
}

// ---- Express route -------------------------------------------------------

/**
 * Create the v2 godmode route that delegates to the session adapter.
 *
 * Mount as: `app.use('/api/godmode/v2', createSessionChatRoute())`
 *
 * POST /api/godmode/v2
 *   Body: { message: string, mode?: SessionChatMode, session_key?: string }
 *   Response: { reply: string, artifacts?: [...], session_key: string }
 *
 * When the gateway is unavailable, falls back to proxying the request
 * to the legacy godmode endpoint on the same Express app.
 */
export function createSessionChatRoute(adapterOverride?: SessionChatAdapter): Router {
  const router = Router()

  // Lazily-initialized adapter -- reused across requests
  let _adapter: SessionChatAdapter | undefined = adapterOverride

  function getAdapter(): SessionChatAdapter {
    if (!_adapter) {
      _adapter = new SessionChatAdapter()
    }
    return _adapter
  }

  // POST / -- main entry point
  router.post('/', async (req: Request, res: Response) => {
    const { message, mode, session_key } = req.body as {
      message?: string
      mode?: SessionChatMode
      session_key?: string
    }

    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' })
      return
    }

    const adapter = getAdapter()

    // Check gateway availability before committing to the session path
    const gatewayUp = await adapter.isGatewayAvailable()

    if (!gatewayUp) {
      // Fall back to legacy godmode by proxying the request internally.
      // The legacy endpoint uses SSE, so we rewrite the request body to
      // match its expected shape and pipe the response.
      await legacyFallback(req, res, message, mode)
      return
    }

    try {
      // Resolve session key -- use provided key, or create a default one
      const resolvedKey = session_key ?? await adapter.getOrCreateOperatorSession('default')

      const response = await adapter.sendMessage({
        sessionKey: resolvedKey,
        message,
        mode,
      })

      res.json(response)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)

      // If the session call failed, try the legacy fallback
      console.warn(`[session-chat-adapter] Gateway call failed, falling back to legacy: ${errMsg}`)
      await legacyFallback(req, res, message, mode)
    }
  })

  // GET /sessions -- list operator sessions
  router.get('/sessions', async (_req: Request, res: Response) => {
    const adapter = getAdapter()
    try {
      const sessions = await adapter.listSessions()
      res.json({ sessions })
    } catch (err) {
      res.status(502).json({
        error: 'Gateway unavailable',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  })

  // GET /tools -- return the session tool registrations
  router.get('/tools', (_req: Request, res: Response) => {
    res.json({ tools: mapGodmodeToolsToSessionTools() })
  })

  return router
}

// ---- Legacy fallback -----------------------------------------------------

/**
 * Forward a v2 request to the legacy /api/godmode endpoint.
 *
 * The legacy endpoint streams SSE, so we collect the full response and
 * return it as a single JSON object matching the v2 shape.
 */
async function legacyFallback(
  _req: Request,
  res: Response,
  message: string,
  mode?: SessionChatMode,
): Promise<void> {
  // Dynamic import to avoid circular dependency at module load time.
  // The legacy godmode router is mounted on the same Express app, so
  // we issue a loopback HTTP request to the local /api/godmode route
  // to reuse its existing middleware, auth handling, and SSE behavior.
  try {
    const http = await import('http')

    // Build the internal request to /api/godmode
    const PORT = Number(process.env.PORT ?? 4242)
    const body = JSON.stringify({ message, mode })

    const collected = await new Promise<string>((resolve, reject) => {
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path: '/api/godmode',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            // Forward auth header if present
            ...(_req.headers.authorization
              ? { Authorization: _req.headers.authorization }
              : {}),
          },
        },
        (proxyRes) => {
          let data = ''
          proxyRes.on('data', (chunk: Buffer) => { data += chunk.toString() })
          proxyRes.on('end', () => resolve(data))
          proxyRes.on('error', reject)
        },
      )
      proxyReq.on('error', reject)
      proxyReq.setTimeout(60_000, () => {
        proxyReq.destroy()
        reject(new Error('Legacy godmode timeout'))
      })
      proxyReq.write(body)
      proxyReq.end()
    })

    // The legacy response is SSE. Extract token content and artifacts.
    const reply = extractReplyFromSSE(collected)
    const artifacts = extractArtifactsFromSSE(collected)

    res.json({
      reply,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      session_key: 'legacy',
    } satisfies SessionChatResponse)
  } catch (err) {
    res.status(502).json({
      error: 'Both gateway and legacy godmode are unavailable',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---- SSE parsing helpers -------------------------------------------------

/** Collect all `token` events from an SSE stream into a single reply string. */
function extractReplyFromSSE(sse: string): string {
  const tokens: string[] = []
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload) as { type?: string; content?: string }
      if (obj.type === 'token' && obj.content) {
        tokens.push(obj.content)
      }
    } catch { /* skip malformed */ }
  }
  return tokens.join('')
}

/** Collect all `artifact` events from an SSE stream. */
function extractArtifactsFromSSE(
  sse: string,
): Array<{ type: string; content: string; name?: string }> {
  const artifacts: Array<{ type: string; content: string; name?: string }> = []
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload) as {
        type?: string
        kind?: string
        content?: string
        title?: string
      }
      if (obj.type === 'artifact' && obj.content) {
        artifacts.push({
          type: obj.kind ?? 'unknown',
          content: obj.content,
          name: obj.title,
        })
      }
    } catch { /* skip malformed */ }
  }
  return artifacts
}
