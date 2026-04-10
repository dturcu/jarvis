import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  error?: boolean
}

interface ChatSession {
  id: string
  title: string
  messages: Message[]
  model: string
  createdAt: string
  updatedAt: string
}

// ─── Conversations API (database-backed) ───────────────────
const API_CHANNEL = 'dashboard-chat'

const chatApi = {
  async listConversations(): Promise<Array<{ id: string; title: string; updatedAt: string; messageCount: number }>> {
    try {
      const res = await fetch(`/api/conversations?channel=${API_CHANNEL}`)
      if (!res.ok) return []
      return await res.json()
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
      return ((await res.json()) as { id: string }).id
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
  async getContext(id: string): Promise<{ mode: string; summary: string | null; messages?: Array<{ role: string; content: string }>; recentMessages?: Array<{ role: string; content: string }> } | null> {
    try {
      const res = await fetch(`/api/conversations/${id}/context`)
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  },
  async deleteConversation(id: string): Promise<void> {
    try { await fetch(`/api/conversations/${id}`, { method: 'DELETE' }) } catch {}
  },
}

// ─── Persistent state helpers (localStorage cache) ─────────
const SESSIONS_KEY = 'jarvis-chat-sessions'
const ACTIVE_KEY = 'jarvis-chat-active'

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) return JSON.parse(raw) as ChatSession[]
  } catch { /* ignore */ }
  return []
}

function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  } catch { /* storage full */ }
}

function loadActiveId(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY) } catch { return null }
}

function saveActiveId(id: string): void {
  try { localStorage.setItem(ACTIVE_KEY, id) } catch { /* ignore */ }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser) return 'New chat'
  const text = firstUser.content.trim()
  return text.length > 50 ? text.slice(0, 47) + '...' : text
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 172_800_000) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ─── Message Bubble ─────────────────────────────────────────

function MessageBubble({ msg, isLast, streaming }: { msg: Message; isLast: boolean; streaming: boolean }) {
  const [showThinking, setShowThinking] = useState(false)
  const isStreaming = isLast && streaming && msg.role === 'assistant'
  const isThinking = isStreaming && !!msg.thinking && !msg.content

  return (
    <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} gap-1`}>
      {msg.role === 'assistant' && msg.thinking && (
        <div className="max-w-[85%] w-full">
          <button
            onClick={() => setShowThinking(v => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-all duration-200 cursor-pointer focus:outline-none"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform duration-200 ${showThinking ? 'rotate-90' : ''}`}>
              <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {isThinking ? <span className="animate-pulse">Thinking...</span> : 'Show thinking'}
          </button>
          {showThinking && (
            <div className="mt-1.5 text-xs text-slate-500 bg-slate-900/80 border border-white/5 rounded-lg px-3.5 py-2.5 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
              {msg.thinking}
            </div>
          )}
        </div>
      )}

      <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
        msg.role === 'user'
          ? 'bg-indigo-600 text-white rounded-br-md'
          : msg.error
          ? 'bg-red-500/10 border border-red-500/20 text-red-300'
          : 'bg-slate-800/70 text-slate-200 border border-white/5 rounded-bl-md'
      }`}>
        {msg.content
          ? msg.content
          : isThinking
          ? null
          : isStreaming
          ? <span className="inline-flex gap-1.5 items-center text-slate-500">
              <span className="animate-pulse">&#9679;</span>
              <span className="animate-pulse" style={{animationDelay:'0.2s'}}>&#9679;</span>
              <span className="animate-pulse" style={{animationDelay:'0.4s'}}>&#9679;</span>
            </span>
          : null}
      </div>
    </div>
  )
}

const QUICK_PROMPTS = [
  'What is the current CRM pipeline status?',
  'Which contacts have the highest scores?',
  'What are the key playbook rules I should know?',
  'Summarise the latest agent decisions',
  'What lessons have been captured so far?',
]

// ─── Main Component ─────────────────────────────────────────

export default function JarvisChat() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions)
  const [activeId, setActiveId] = useState<string | null>(loadActiveId)
  const [showHistory, setShowHistory] = useState(false)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [model, setModel] = useState('qwen/qwen3.5-35b-a3b')
  const [models, setModels] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionsRef = useRef(sessions) as MutableRefObject<ChatSession[]>
  sessionsRef.current = sessions

  const activeSession = sessions.find(s => s.id === activeId) ?? null
  const messages = activeSession?.messages ?? []

  // Persist on every change (including mid-stream — partial messages beat lost messages)
  useEffect(() => {
    saveSessions(sessions)
  }, [sessions])

  // Safety: persist on unmount via ref to avoid stale closure
  useEffect(() => {
    return () => { saveSessions(sessionsRef.current) }
  }, [])

  useEffect(() => {
    if (activeId) saveActiveId(activeId)
  }, [activeId])

  // Load models
  useEffect(() => {
    fetch('/api/chat/models')
      .then(r => r.json())
      .then((d: { models: string[]; default: string }) => {
        if (d.models.length) setModels(d.models)
        if (d.default) setModel(d.default)
      })
      .catch(() => {})
  }, [])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const updateActiveMessages = useCallback((updater: (msgs: Message[]) => Message[]) => {
    setSessions(prev => prev.map(s =>
      s.id === activeId
        ? { ...s, messages: updater(s.messages), title: deriveTitle(updater(s.messages)), updatedAt: new Date().toISOString() }
        : s
    ))
  }, [activeId])

  const startNewSession = useCallback(() => {
    const localId = generateId()
    const newSession: ChatSession = {
      id: localId,
      title: 'New chat',
      messages: [],
      model,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setSessions(prev => [newSession, ...prev])
    setActiveId(newSession.id)
    setInput('')
    inputRef.current?.focus()
    // Create on server in background
    chatApi.createConversation('New chat').then(serverId => {
      if (serverId && serverId !== localId) {
        setSessions(prev => prev.map(s => s.id === localId ? { ...s, id: serverId } : s))
        setActiveId(prev => prev === localId ? serverId : prev)
      }
    }).catch(() => {})
  }, [model])

  const switchSession = useCallback((id: string) => {
    setActiveId(id)
    setShowHistory(false)
    const session = sessions.find(s => s.id === id)
    if (session) setModel(session.model)
  }, [sessions])

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeId === id) {
      const remaining = sessions.filter(s => s.id !== id)
      setActiveId(remaining.length > 0 ? remaining[0].id : null)
    }
    chatApi.deleteConversation(id).catch(() => {})
  }, [activeId, sessions])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setInput('')

    // Create session if none active
    if (!activeId) {
      const localId = generateId()
      const newSession: ChatSession = {
        id: localId,
        title: trimmed.length > 50 ? trimmed.slice(0, 47) + '...' : trimmed,
        messages: [],
        model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setSessions(prev => [newSession, ...prev])
      setActiveId(localId)

      // Create on server synchronously so messages record against real ID
      let sessionId = localId
      try {
        const serverId = await chatApi.createConversation(newSession.title)
        if (serverId) {
          sessionId = serverId
          setSessions(prev => prev.map(s => s.id === localId ? { ...s, id: serverId } : s))
          setActiveId(serverId)
        }
      } catch { /* offline */ }

      await sendToSession(sessionId, trimmed, [])
      return
    }

    await sendToSession(activeId, trimmed, messages)
  }

  const sendToSession = async (sessionId: string, trimmed: string, currentMessages: Message[]) => {
    const userMsg: Message = { role: 'user', content: trimmed }
    const assistantMsg: Message = { role: 'assistant', content: '' }
    const newMessages = [...currentMessages, userMsg, assistantMsg]

    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, messages: newMessages, title: deriveTitle(newMessages), updatedAt: new Date().toISOString() }
        : s
    ))
    setStreaming(true)

    // Record user message to DB (non-blocking)
    chatApi.recordMessage(sessionId, 'user', trimmed, model).catch(() => {})

    // Build smart history: use server context (with summary) if available
    let history: Array<{ role: string; content: string }>
    const ctx = await chatApi.getContext(sessionId).catch(() => null)
    if (ctx?.mode === 'summarized' && ctx.summary && ctx.recentMessages) {
      history = [
        { role: 'user', content: `[Previous conversation context: ${ctx.summary}]` },
        { role: 'assistant', content: 'Understood, I have the context from our previous conversation.' },
        ...ctx.recentMessages,
      ]
    } else if (ctx?.mode === 'full' && ctx.messages) {
      history = ctx.messages
    } else {
      history = currentMessages.map(m => ({ role: m.role, content: m.content }))
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, model, history })
      })

      if (!res.ok || !res.body) throw new Error('No response from chat API')

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
            const p = JSON.parse(data) as { token?: string; thinking?: string; error?: string }
            if (p.error) {
              setSessions(prev => prev.map(s => {
                if (s.id !== sessionId) return s
                const msgs = [...s.messages]
                const last = msgs[msgs.length - 1]
                if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content: p.error!, error: true }
                return { ...s, messages: msgs, updatedAt: new Date().toISOString() }
              }))
            } else if (p.thinking) {
              setSessions(prev => prev.map(s => {
                if (s.id !== sessionId) return s
                const msgs = [...s.messages]
                const last = msgs[msgs.length - 1]
                if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, thinking: (last.thinking ?? '') + p.thinking }
                return { ...s, messages: msgs }
              }))
            } else if (p.token) {
              setSessions(prev => prev.map(s => {
                if (s.id !== sessionId) return s
                const msgs = [...s.messages]
                const last = msgs[msgs.length - 1]
                if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content: last.content + p.token }
                return { ...s, messages: msgs }
              }))
            }
          } catch {}
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      setSessions(prev => prev.map(s => {
        if (s.id !== sessionId) return s
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content: errMsg, error: true }
        return { ...s, messages: msgs, updatedAt: new Date().toISOString() }
      }))
    }

    setStreaming(false)
    inputRef.current?.focus()

    // Record assistant response to DB (non-blocking)
    const finalSessions = sessionsRef.current
    const finalSession = finalSessions.find(s => s.id === sessionId)
    const lastMsg = finalSession?.messages[finalSession.messages.length - 1]
    if (lastMsg?.role === 'assistant' && lastMsg.content && !lastMsg.error) {
      chatApi.recordMessage(sessionId, 'assistant', lastMsg.content, model).catch(() => {})
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── History sidebar ──────────────────────────────── */}
      <div className={`${showHistory ? 'w-52' : 'w-0'} shrink-0 transition-all duration-200 overflow-hidden border-r border-white/5 bg-slate-900/50`}>
        <div className="w-52 h-full flex flex-col">
          <div className="flex items-center justify-between px-3 py-3 border-b border-white/5">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Chats</span>
            <button
              onClick={startNewSession}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
            >
              + New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="text-xs text-slate-600 px-3 py-4 text-center">No chat history yet</p>
            ) : (
              sessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => switchSession(s.id)}
                  className={`group px-3 py-2.5 cursor-pointer border-b border-white/[0.03] transition-colors ${
                    s.id === activeId
                      ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
                      : 'hover:bg-slate-800/50 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${s.id === activeId ? 'text-indigo-300' : 'text-slate-300'}`}>
                        {s.title}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-0.5">
                        {s.messages.length} message{s.messages.length !== 1 ? 's' : ''} · {timeLabel(s.updatedAt)}
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteSession(s.id) }}
                      className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-xs cursor-pointer shrink-0 mt-0.5"
                      title="Delete chat"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Main chat area ───────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="w-7 h-7 rounded-lg bg-slate-800/50 border border-white/5 flex items-center justify-center hover:bg-slate-700/50 transition-colors cursor-pointer"
              title={showHistory ? 'Hide history' : 'Show history'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="text-slate-400">
                <path d="M2 3.5h10M2 7h10M2 10.5h10" />
              </svg>
            </button>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
                <path d="M2 3a1 1 0 011-1h8a1 1 0 011 1v6a1 1 0 01-1 1H5l-3 2V3z" />
              </svg>
            </div>
            <div>
              <span className="text-sm font-semibold text-slate-100">Ask Jarvis</span>
              <span className="ml-2 text-xs text-slate-500 font-mono">{model.split('/').pop()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sessions.length > 0 && (
              <span className="text-[10px] text-slate-600">{sessions.length} chat{sessions.length !== 1 ? 's' : ''}</span>
            )}
            <button
              onClick={startNewSession}
              className="text-xs text-slate-500 hover:text-slate-300 bg-slate-800/50 border border-white/5 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              New chat
            </button>
            {models.length > 1 && (
              <div className="relative">
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-400 focus:border-indigo-500 focus:outline-none transition-all duration-200 cursor-pointer appearance-none pr-7"
                >
                  {models.map(m => (
                    <option key={m} value={m}>{m.split('/').pop() ?? m}</option>
                  ))}
                </select>
                <svg className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-600" width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3 font-medium">Quick questions:</p>
              {QUICK_PROMPTS.map(q => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={streaming}
                  className="block w-full text-left text-xs px-3.5 py-2.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 rounded-lg border border-white/5 hover:border-white/10 transition-all duration-200 disabled:opacity-50 cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} isLast={i === messages.length - 1} streaming={streaming} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 py-3 border-t border-white/5 flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder={streaming ? 'Thinking...' : 'Ask anything about your pipeline, contacts, decisions...'}
            className="flex-1 text-sm bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none disabled:opacity-50 transition-all duration-200"
          />
          <button
            onClick={() => send(input)}
            disabled={streaming || !input.trim()}
            className="px-4 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all duration-200 shrink-0 cursor-pointer min-h-[44px] flex items-center gap-1.5"
          >
            {streaming ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2L7 9" />
                  <path d="M14 2l-4 12-3-5-5-3z" />
                </svg>
                Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
