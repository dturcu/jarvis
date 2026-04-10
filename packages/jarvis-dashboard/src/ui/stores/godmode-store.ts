import { create } from 'zustand'

// ─── Conversations API (database-backed, source of truth) ──────────────────

const API_CHANNEL = 'dashboard-godmode'

const api = {
  async listConversations(): Promise<ConversationMeta[]> {
    try {
      const res = await fetch(`/api/conversations?channel=${API_CHANNEL}`)
      if (!res.ok) return []
      return await res.json() as ConversationMeta[]
    } catch { return [] }
  },
  async createConversation(title?: string): Promise<string | null> {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: API_CHANNEL, title }),
      })
      if (!res.ok) return null
      const data = await res.json() as { id: string }
      return data.id
    } catch { return null }
  },
  async loadConversation(id: string): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: string }>; summary: string | null } | null> {
    try {
      const res = await fetch(`/api/conversations/${id}`)
      if (!res.ok) return null
      const data = await res.json() as { messages: Array<{ role: string; content: string }>; summary: string | null }
      return {
        messages: data.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        summary: data.summary,
      }
    } catch { return null }
  },
  async recordMessage(convId: string, role: 'user' | 'assistant', content: string, model?: string): Promise<void> {
    try {
      await fetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, model }),
      })
    } catch { /* best-effort */ }
  },
  async deleteConversation(id: string): Promise<void> {
    try {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
    } catch { /* best-effort */ }
  },
  async getContext(id: string): Promise<{ mode: string; summary: string | null; messages?: Array<{ role: 'user' | 'assistant'; content: string }>; recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }> } | null> {
    try {
      const res = await fetch(`/api/conversations/${id}/context`)
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  },
}

// ─── Multi-Conversation Persistence (localStorage cache) ───────────────────

const CONVERSATIONS_KEY = 'godmode-conversations'
const ACTIVE_CONV_KEY = 'godmode-active'
const CONV_PREFIX = 'godmode-conv-'

interface ConversationMeta {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

interface ConversationData {
  messages: GodmodeMessage[]
  artifactHistory: Artifact[]
  currentArtifact: Artifact | null
  model: string
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function deriveTitle(messages: GodmodeMessage[]): string {
  const first = messages.find(m => m.role === 'user')
  if (!first) return 'New chat'
  const text = first.content.trim()
  return text.length > 50 ? text.slice(0, 47) + '...' : text
}

function loadConversationList(): ConversationMeta[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (raw) return JSON.parse(raw) as ConversationMeta[]
  } catch { /* ignore */ }
  return []
}

function saveConversationList(list: ConversationMeta[]): void {
  try { localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(list)) } catch {}
}

function loadActiveConversationId(): string | null {
  try { return localStorage.getItem(ACTIVE_CONV_KEY) } catch { return null }
}

function saveActiveConversationId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_CONV_KEY, id)
    else localStorage.removeItem(ACTIVE_CONV_KEY)
  } catch {}
}

function loadConversationData(id: string): ConversationData | null {
  try {
    const raw = localStorage.getItem(CONV_PREFIX + id)
    if (raw) return JSON.parse(raw) as ConversationData
  } catch {}
  return null
}

function saveConversationData(id: string, data: ConversationData): void {
  try { localStorage.setItem(CONV_PREFIX + id, JSON.stringify(data)) } catch {}
}

function removeConversationData(id: string): void {
  try { localStorage.removeItem(CONV_PREFIX + id) } catch {}
}

// Migrate legacy sessionStorage data → new localStorage model (one-time)
function migrateLegacySession(): { id: string; data: ConversationData } | null {
  try {
    const raw = sessionStorage.getItem('godmode-session')
    if (!raw) return null
    const parsed = JSON.parse(raw) as ConversationData
    if (!parsed.messages?.length) return null
    sessionStorage.removeItem('godmode-session')
    const id = generateId()
    return { id, data: parsed }
  } catch { return null }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolLogEntry {
  id: string
  name: string
  params: Record<string, unknown>
  result?: string
  duration?: number
  status: 'running' | 'done' | 'error'
}

export interface Artifact {
  id: string
  kind: string
  title: string
  content: string
}

export interface ResearchSource {
  url: string
  title: string
  snippet: string
}

export interface CoworkStep {
  index: number
  action: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface GodmodeMessage {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  tools?: ToolLogEntry[]
  error?: boolean
}

export type SurfaceId = 'chat' | 'artifact' | 'research' | 'code' | 'cowork'

// ─── Store ──────────────────────────────────────────────────────────────────

interface GodmodeState {
  // Conversation management
  conversations: ConversationMeta[]
  currentConversationId: string | null

  // Current conversation state
  messages: GodmodeMessage[]
  streaming: boolean
  activeSurfaces: SurfaceId[]
  currentArtifact: Artifact | null
  artifactHistory: Artifact[]
  artifactViewMode: 'preview' | 'code'
  researchPhase: 'idle' | 'searching' | 'reading' | 'synthesizing' | 'done'
  researchSources: ResearchSource[]
  coworkSteps: CoworkStep[]
  codeContent: string
  toolLog: ToolLogEntry[]
  model: string
  models: string[]

  // Actions
  sendMessage: (text: string) => Promise<void>
  newConversation: () => void
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  loadFromApi: () => Promise<void>  // hydrate from database
  clearSession: () => void // backward-compat alias for newConversation
  setArtifactViewMode: (mode: 'preview' | 'code') => void
  setModel: (model: string) => void
  setModels: (models: string[]) => void
  closeSurface: (id: SurfaceId) => void
}

function initState(): {
  conversations: ConversationMeta[]
  currentConversationId: string | null
  messages: GodmodeMessage[]
  currentArtifact: Artifact | null
  artifactHistory: Artifact[]
  model: string
} {
  let conversations = loadConversationList()
  let activeId = loadActiveConversationId()

  // One-time migration from legacy sessionStorage
  const legacy = migrateLegacySession()
  if (legacy) {
    const meta: ConversationMeta = {
      id: legacy.id,
      title: deriveTitle(legacy.data.messages),
      updatedAt: new Date().toISOString(),
      messageCount: legacy.data.messages.length,
    }
    conversations = [meta, ...conversations]
    saveConversationList(conversations)
    saveConversationData(legacy.id, legacy.data)
    activeId = legacy.id
    saveActiveConversationId(activeId)
  }

  // Load active conversation data
  const data = activeId ? loadConversationData(activeId) : null

  // Validate activeId still exists in list
  if (activeId && !conversations.find(c => c.id === activeId)) {
    activeId = conversations.length > 0 ? conversations[0].id : null
    saveActiveConversationId(activeId)
  }

  const activeData = activeId ? (data ?? loadConversationData(activeId)) : null

  return {
    conversations,
    currentConversationId: activeId,
    messages: activeData?.messages ?? [],
    currentArtifact: activeData?.currentArtifact ?? null,
    artifactHistory: activeData?.artifactHistory ?? [],
    model: activeData?.model ?? '',
  }
}

function persistCurrentConversation(
  state: GodmodeState,
  storeSetter: (partial: Partial<GodmodeState>) => void,
): void {
  const { currentConversationId, messages, artifactHistory, currentArtifact, model, conversations } = state
  if (!currentConversationId) return

  // Save conversation data
  saveConversationData(currentConversationId, { messages, artifactHistory, currentArtifact, model })

  // Update metadata in list
  const updated = conversations.map(c =>
    c.id === currentConversationId
      ? { ...c, title: deriveTitle(messages), updatedAt: new Date().toISOString(), messageCount: messages.length }
      : c
  )
  saveConversationList(updated)

  // Sync metadata back to store so sidebar reflects current counts
  storeSetter({ conversations: updated })
}

export const useGodmodeStore = create<GodmodeState>((set, get) => {
  const init = initState()
  return {
  conversations: init.conversations,
  currentConversationId: init.currentConversationId,
  messages: init.messages,
  streaming: false,
  activeSurfaces: ['chat'],
  currentArtifact: init.currentArtifact,
  artifactHistory: init.artifactHistory,
  artifactViewMode: 'preview',
  researchPhase: 'idle',
  researchSources: [],
  coworkSteps: [],
  codeContent: '',
  toolLog: [],
  model: init.model,
  models: [],

  // ─── Conversation Management ─────────────────────────────────

  loadFromApi: async () => {
    const convs = await api.listConversations()
    if (convs.length > 0) {
      // API has data — use it as source of truth
      saveConversationList(convs)
      set({ conversations: convs })

      // Load active conversation from API
      const activeId = get().currentConversationId
      const targetId = activeId && convs.find(c => c.id === activeId) ? activeId : convs[0].id
      const data = await api.loadConversation(targetId)
      if (data) {
        const msgs: GodmodeMessage[] = data.messages.map(m => ({ role: m.role, content: m.content }))
        saveConversationData(targetId, { messages: msgs, artifactHistory: [], currentArtifact: null, model: get().model })
        saveActiveConversationId(targetId)
        set({ currentConversationId: targetId, messages: msgs })
      }
    }
  },

  newConversation: () => {
    const state = get()
    if (state.streaming) return

    // Persist current conversation first
    persistCurrentConversation(state, set)

    // Create new empty conversation (optimistic with local ID, API syncs in background)
    const localId = generateId()
    const meta: ConversationMeta = {
      id: localId,
      title: 'New chat',
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    }
    const updated = [meta, ...state.conversations]
    saveConversationList(updated)
    saveActiveConversationId(localId)

    set({
      conversations: updated,
      currentConversationId: localId,
      messages: [],
      streaming: false,
      activeSurfaces: ['chat'],
      currentArtifact: null,
      artifactHistory: [],
      artifactViewMode: 'preview',
      researchPhase: 'idle',
      researchSources: [],
      coworkSteps: [],
      codeContent: '',
      toolLog: [],
    })

    // Create on server in background; update ID if server returns a different one
    api.createConversation('New chat').then(serverId => {
      if (serverId && serverId !== localId) {
        const cur = get()
        // Remap local ID to server ID
        const remapped = cur.conversations.map(c => c.id === localId ? { ...c, id: serverId } : c)
        saveConversationList(remapped)
        saveActiveConversationId(serverId)
        if (cur.currentConversationId === localId) {
          set({ conversations: remapped, currentConversationId: serverId })
        } else {
          set({ conversations: remapped })
        }
      }
    }).catch(() => { /* offline — localStorage is fine */ })
  },

  switchConversation: (id: string) => {
    const state = get()
    if (state.streaming || id === state.currentConversationId) return

    // Persist current first
    persistCurrentConversation(state, set)

    // Load from localStorage cache first (instant)
    const cached = loadConversationData(id)
    saveActiveConversationId(id)

    set({
      currentConversationId: id,
      messages: cached?.messages ?? [],
      currentArtifact: cached?.currentArtifact ?? null,
      artifactHistory: cached?.artifactHistory ?? [],
      model: cached?.model || state.model,
      activeSurfaces: ['chat'],
      toolLog: [],
      coworkSteps: [],
      researchPhase: 'idle',
      researchSources: [],
      codeContent: '',
    })

    // Then hydrate from API (may have newer data from another session)
    api.loadConversation(id).then(data => {
      if (data && get().currentConversationId === id) {
        const msgs: GodmodeMessage[] = data.messages.map(m => ({ role: m.role, content: m.content }))
        saveConversationData(id, { messages: msgs, artifactHistory: get().artifactHistory, currentArtifact: get().currentArtifact, model: get().model })
        set({ messages: msgs })
      }
    }).catch(() => { /* offline — cached data is fine */ })
  },

  deleteConversation: (id: string) => {
    const state = get()
    if (state.streaming) return

    removeConversationData(id)
    const updated = state.conversations.filter(c => c.id !== id)
    saveConversationList(updated)

    // Delete on server in background
    api.deleteConversation(id).catch(() => {})

    if (state.currentConversationId === id) {
      const nextId = updated.length > 0 ? updated[0].id : null
      const nextData = nextId ? loadConversationData(nextId) : null
      saveActiveConversationId(nextId)
      set({
        conversations: updated,
        currentConversationId: nextId,
        messages: nextData?.messages ?? [],
        currentArtifact: nextData?.currentArtifact ?? null,
        artifactHistory: nextData?.artifactHistory ?? [],
        activeSurfaces: ['chat'],
        toolLog: [],
      })
    } else {
      set({ conversations: updated })
    }
  },

  // Backward-compat alias
  clearSession: () => get().newConversation(),

  // ─── Send Message ────────────────────────────────────────────

  sendMessage: async (text: string) => {
    const state = get()
    const { model, messages, streaming } = state
    if (!text.trim() || streaming) return

    // Auto-create conversation if none active
    let convId = state.currentConversationId
    if (!convId) {
      const localId = generateId()
      convId = localId
      const meta: ConversationMeta = {
        id: localId,
        title: text.trim().length > 50 ? text.trim().slice(0, 47) + '...' : text.trim(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
      }
      const updated = [meta, ...state.conversations]
      saveConversationList(updated)
      saveActiveConversationId(localId)
      set({ conversations: updated, currentConversationId: localId })

      // Create on server synchronously so we can record messages against the real ID
      try {
        const serverId = await api.createConversation(meta.title)
        if (serverId) {
          convId = serverId
          const remapped = get().conversations.map(c => c.id === localId ? { ...c, id: serverId } : c)
          saveConversationList(remapped)
          saveActiveConversationId(serverId)
          // Also remap localStorage data key
          const localData = loadConversationData(localId)
          if (localData) { saveConversationData(serverId, localData); removeConversationData(localId) }
          set({ conversations: remapped, currentConversationId: serverId })
        }
      } catch { /* offline — use local ID */ }
    }

    // Record user message to API (non-blocking)
    const activeConvId = convId
    api.recordMessage(activeConvId, 'user', text.trim(), model).catch(() => {})

    const userMsg: GodmodeMessage = { role: 'user', content: text.trim() }
    const assistantMsg: GodmodeMessage = { role: 'assistant', content: '', tools: [] }

    set({
      messages: [...messages, userMsg, assistantMsg],
      streaming: true,
      activeSurfaces: ['chat'],
      toolLog: [],
      coworkSteps: [],
      researchPhase: 'idle',
      researchSources: [],
      codeContent: '',
    })

    // Build smart history: use server context (with summary) if available, fall back to local
    let history: Array<{ role: string; content: string }>
    const ctx = await api.getContext(activeConvId).catch(() => null)
    if (ctx?.mode === 'summarized' && ctx.summary && ctx.recentMessages) {
      // Inject summary as context, then recent messages
      history = [
        { role: 'user', content: `[Previous conversation context: ${ctx.summary}]` },
        { role: 'assistant', content: 'Understood, I have the context from our previous conversation.' },
        ...ctx.recentMessages,
      ]
    } else if (ctx?.mode === 'full' && ctx.messages) {
      history = ctx.messages
    } else {
      // Offline fallback: use local messages
      history = messages.map(m => ({ role: m.role, content: m.content }))
    }

    try {
      const res = await fetch('/api/godmode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), model: model || undefined, history })
      })

      if (!res.ok || !res.body) throw new Error('No response from Godmode API')

      // If the API returns plain JSON (session-chat adapter), convert it to a
      // synthetic token event so the SSE loop below doesn't see an empty stream.
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const json = await res.json() as {
          reply?: string; message?: string;
          artifacts?: Array<{ type: string; content: string; name?: string }>;
          model?: string;
        }
        const reply = json.reply ?? json.message ?? ''

        // Process artifacts from the session adapter response
        const artifacts: Artifact[] = (json.artifacts ?? []).map((a, i) => ({
          id: `artifact-${Date.now()}-${i}`,
          kind: a.type,
          title: a.name ?? `${a.type} artifact`,
          content: a.content,
        }))
        const lastArtifact = artifacts.length > 0 ? artifacts[artifacts.length - 1]! : null

        set(s => {
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: reply }
          }
          return {
            messages: msgs,
            ...(lastArtifact ? {
              currentArtifact: lastArtifact,
              artifactHistory: [...s.artifactHistory, ...artifacts],
              activeSurfaces: [...s.activeSurfaces, 'artifact'] as SurfaceId[],
            } : {}),
            ...(json.model ? { model: json.model } : {}),
          }
        })
        set({ streaming: false })
        persistCurrentConversation(get(), set)
        // Record assistant response to API
        if (reply) api.recordMessage(activeConvId, 'assistant', reply, get().model).catch(() => {})
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const evt = JSON.parse(data) as Record<string, unknown>
            const type = evt.type as string

            switch (type) {
              case 'surface': {
                const surfaces = evt.surfaces as SurfaceId[]
                set({ activeSurfaces: surfaces })
                break
              }
              case 'thinking': {
                set(s => {
                  const msgs = [...s.messages]
                  const last = msgs[msgs.length - 1]
                  if (last?.role === 'assistant') {
                    msgs[msgs.length - 1] = { ...last, thinking: (last.thinking ?? '') + (evt.content as string) }
                  }
                  return { messages: msgs }
                })
                break
              }
              case 'token': {
                const content = evt.content as string
                set(s => {
                  const msgs = [...s.messages]
                  const last = msgs[msgs.length - 1]
                  if (last?.role === 'assistant') {
                    msgs[msgs.length - 1] = { ...last, content: last.content + content }
                  }
                  // Detect code blocks for code surface
                  const newContent = last?.content ?? ''
                  const codeContent = s.activeSurfaces.includes('code') ? newContent : s.codeContent
                  return { messages: msgs, codeContent }
                })
                break
              }
              case 'tool_start': {
                const tool: ToolLogEntry = {
                  id: evt.id as string,
                  name: evt.name as string,
                  params: evt.params as Record<string, unknown>,
                  status: 'running'
                }
                set(s => ({
                  toolLog: [...s.toolLog, tool],
                  messages: (() => {
                    const msgs = [...s.messages]
                    const last = msgs[msgs.length - 1]
                    if (last?.role === 'assistant') {
                      msgs[msgs.length - 1] = { ...last, tools: [...(last.tools ?? []), tool] }
                    }
                    return msgs
                  })()
                }))
                break
              }
              case 'tool_result': {
                const id = evt.id as string
                const result = evt.result as string
                const duration = evt.duration as number
                set(s => ({
                  toolLog: s.toolLog.map(t => t.id === id ? { ...t, result, duration, status: 'done' as const } : t),
                  messages: (() => {
                    const msgs = [...s.messages]
                    const last = msgs[msgs.length - 1]
                    if (last?.role === 'assistant') {
                      msgs[msgs.length - 1] = {
                        ...last,
                        tools: (last.tools ?? []).map(t => t.id === id ? { ...t, result, duration, status: 'done' as const } : t)
                      }
                    }
                    return msgs
                  })(),
                  // Extract sources for research panel
                  researchSources: (() => {
                    if (evt.name === 'web_search' && result) {
                      const urlMatches = [...result.matchAll(/URL:\s*(https?:\/\/\S+)/g)]
                      const titleMatches = [...result.matchAll(/^\d+\.\s+(.+)$/gm)]
                      const newSources = urlMatches.map((m, i) => ({
                        url: m[1]!,
                        title: titleMatches[i]?.[1] ?? m[1]!,
                        snippet: ''
                      }))
                      return [...s.researchSources, ...newSources]
                    }
                    return s.researchSources
                  })()
                }))
                break
              }
              case 'artifact': {
                const artifact: Artifact = {
                  id: evt.id as string,
                  kind: evt.kind as string,
                  title: evt.title as string,
                  content: evt.content as string
                }
                set(s => ({
                  currentArtifact: artifact,
                  artifactHistory: [...s.artifactHistory, artifact],
                  activeSurfaces: s.activeSurfaces.includes('artifact')
                    ? s.activeSurfaces
                    : [...s.activeSurfaces, 'artifact']
                }))
                break
              }
              case 'research_step': {
                set({
                  researchPhase: evt.phase as GodmodeState['researchPhase']
                })
                break
              }
              case 'step': {
                const step: CoworkStep = {
                  index: evt.index as number,
                  action: evt.action as string,
                  status: evt.status as CoworkStep['status']
                }
                set(s => {
                  const steps = [...s.coworkSteps]
                  const existing = steps.findIndex(ss => ss.index === step.index)
                  if (existing >= 0) steps[existing] = step
                  else steps.push(step)
                  return { coworkSteps: steps }
                })
                break
              }
              case 'model': {
                const modelId = evt.model as string
                if (modelId) set({ model: modelId })
                break
              }
              case 'error': {
                set(s => {
                  const msgs = [...s.messages]
                  const last = msgs[msgs.length - 1]
                  if (last?.role === 'assistant') {
                    msgs[msgs.length - 1] = { ...last, content: evt.message as string, error: true }
                  }
                  return { messages: msgs }
                })
                break
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      set(s => {
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: e instanceof Error ? e.message : String(e), error: true }
        }
        return { messages: msgs }
      })
    }

    // If the assistant message is still empty after the stream (e.g. API returned
    // plain JSON instead of SSE, or the model produced no tokens), show an error.
    set(s => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant' && !last.content && !last.error) {
        msgs[msgs.length - 1] = {
          ...last,
          content: 'No response — no AI model is currently available. Check Settings > Models to connect a local model.',
          error: true,
        }
        return { messages: msgs }
      }
      return {}
    })

    set({ streaming: false })

    // Persist to localStorage
    persistCurrentConversation(get(), set)

    // Record assistant response to API (non-blocking)
    const finalMsgs = get().messages
    const lastAssistant = finalMsgs[finalMsgs.length - 1]
    if (lastAssistant?.role === 'assistant' && lastAssistant.content && !lastAssistant.error) {
      api.recordMessage(get().currentConversationId ?? activeConvId, 'assistant', lastAssistant.content, get().model).catch(() => {})
    }
  },

  setArtifactViewMode: (mode) => set({ artifactViewMode: mode }),
  setModel: (model) => set({ model }),
  setModels: (models) => set({ models }),
  closeSurface: (id) => set(s => ({
    activeSurfaces: s.activeSurfaces.filter(ss => ss !== id)
  })),
}})
