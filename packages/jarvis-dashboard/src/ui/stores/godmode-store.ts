import { create } from 'zustand'

// ─── Session Persistence ────────────────────────────────────────────────────

const STORAGE_KEY = 'godmode-session'

interface PersistedState {
  messages: GodmodeMessage[]
  artifactHistory: Artifact[]
  currentArtifact: Artifact | null
  model: string
}

function loadSession(): Partial<PersistedState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveSession(state: PersistedState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
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

  sendMessage: (text: string) => Promise<void>
  clearSession: () => void
  setArtifactViewMode: (mode: 'preview' | 'code') => void
  setModel: (model: string) => void
  setModels: (models: string[]) => void
  closeSurface: (id: SurfaceId) => void
}

export const useGodmodeStore = create<GodmodeState>((set, get) => {
  const persisted = loadSession()
  return {
  messages: persisted.messages ?? [],
  streaming: false,
  activeSurfaces: ['chat'],
  currentArtifact: persisted.currentArtifact ?? null,
  artifactHistory: persisted.artifactHistory ?? [],
  artifactViewMode: 'preview',
  researchPhase: 'idle',
  researchSources: [],
  coworkSteps: [],
  codeContent: '',
  toolLog: [],
  model: persisted.model ?? '',
  models: [],

  sendMessage: async (text: string) => {
    const { model, messages, streaming } = get()
    if (!text.trim() || streaming) return

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
        const json = await res.json() as { reply?: string; message?: string }
        const reply = json.reply ?? json.message ?? ''
        set(state => {
          const msgs = [...state.messages]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: reply }
          }
          return { messages: msgs }
        })
        set({ streaming: false })
        const final = get()
        saveSession({ messages: final.messages, artifactHistory: final.artifactHistory, currentArtifact: final.currentArtifact, model: final.model })
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
                set(state => {
                  const msgs = [...state.messages]
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
                set(state => {
                  const msgs = [...state.messages]
                  const last = msgs[msgs.length - 1]
                  if (last?.role === 'assistant') {
                    msgs[msgs.length - 1] = { ...last, content: last.content + content }
                  }
                  // Detect code blocks for code surface
                  const newContent = last?.content ?? ''
                  const codeContent = state.activeSurfaces.includes('code') ? newContent : state.codeContent
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
                set(state => ({
                  toolLog: [...state.toolLog, tool],
                  messages: (() => {
                    const msgs = [...state.messages]
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
                set(state => ({
                  toolLog: state.toolLog.map(t => t.id === id ? { ...t, result, duration, status: 'done' as const } : t),
                  messages: (() => {
                    const msgs = [...state.messages]
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
                      return [...state.researchSources, ...newSources]
                    }
                    return state.researchSources
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
                set(state => ({
                  currentArtifact: artifact,
                  artifactHistory: [...state.artifactHistory, artifact],
                  activeSurfaces: state.activeSurfaces.includes('artifact')
                    ? state.activeSurfaces
                    : [...state.activeSurfaces, 'artifact']
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
                set(state => {
                  const steps = [...state.coworkSteps]
                  const existing = steps.findIndex(s => s.index === step.index)
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
                set(state => {
                  const msgs = [...state.messages]
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
      set(state => {
        const msgs = [...state.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: e instanceof Error ? e.message : String(e), error: true }
        }
        return { messages: msgs }
      })
    }

    // If the assistant message is still empty after the stream (e.g. API returned
    // plain JSON instead of SSE, or the model produced no tokens), show an error.
    set(state => {
      const msgs = [...state.messages]
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

    // Persist to sessionStorage
    const final = get()
    saveSession({
      messages: final.messages,
      artifactHistory: final.artifactHistory,
      currentArtifact: final.currentArtifact,
      model: final.model,
    })
  },

  clearSession: () => {
    try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
    set({
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

  setArtifactViewMode: (mode) => set({ artifactViewMode: mode }),
  setModel: (model) => set({ model }),
  setModels: (models) => set({ models }),
  closeSurface: (id) => set(state => ({
    activeSurfaces: state.activeSurfaces.filter(s => s !== id)
  })),
}})
