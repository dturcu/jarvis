import { create } from 'zustand'

// ─── Multi-Conversation Persistence (localStorage) ─────────────────────────

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

function persistCurrentConversation(state: GodmodeState): void {
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

  newConversation: () => {
    const state = get()
    if (state.streaming) return

    // Persist current conversation first
    persistCurrentConversation(state)

    // Create new empty conversation
    const id = generateId()
    const meta: ConversationMeta = {
      id,
      title: 'New chat',
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    }
    const updated = [meta, ...state.conversations]
    saveConversationList(updated)
    saveActiveConversationId(id)

    set({
      conversations: updated,
      currentConversationId: id,
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
  },

  switchConversation: (id: string) => {
    const state = get()
    if (state.streaming || id === state.currentConversationId) return

    // Persist current first
    persistCurrentConversation(state)

    // Load target
    const data = loadConversationData(id)
    saveActiveConversationId(id)

    set({
      currentConversationId: id,
      messages: data?.messages ?? [],
      currentArtifact: data?.currentArtifact ?? null,
      artifactHistory: data?.artifactHistory ?? [],
      model: data?.model || state.model,
      activeSurfaces: ['chat'],
      toolLog: [],
      coworkSteps: [],
      researchPhase: 'idle',
      researchSources: [],
      codeContent: '',
    })
  },

  deleteConversation: (id: string) => {
    const state = get()
    if (state.streaming) return

    removeConversationData(id)
    const updated = state.conversations.filter(c => c.id !== id)
    saveConversationList(updated)

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
      convId = generateId()
      const meta: ConversationMeta = {
        id: convId,
        title: text.trim().length > 50 ? text.trim().slice(0, 47) + '...' : text.trim(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
      }
      const updated = [meta, ...state.conversations]
      saveConversationList(updated)
      saveActiveConversationId(convId)
      set({ conversations: updated, currentConversationId: convId })
    }

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

    const history = messages.map(m => ({ role: m.role, content: m.content }))

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
        persistCurrentConversation(get())
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
    persistCurrentConversation(get())
  },

  setArtifactViewMode: (mode) => set({ artifactViewMode: mode }),
  setModel: (model) => set({ model }),
  setModels: (models) => set({ models }),
  closeSurface: (id) => set(s => ({
    activeSurfaces: s.activeSurfaces.filter(ss => ss !== id)
  })),
}})
