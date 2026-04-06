import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  error?: boolean
}

// ─── Persistent state helpers (survives page navigation, clears on tab close) ──
const STORAGE_KEY = 'jarvis-chat'

function loadChatState(): { messages: Message[]; model: string; input: string } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as { messages: Message[]; model: string; input: string }
  } catch { /* ignore */ }
  return { messages: [], model: '', input: '' }
}

function saveChatState(messages: Message[], model: string, input: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, model, input }))
  } catch { /* storage full or unavailable */ }
}

function MessageBubble({ msg, isLast, streaming }: { msg: Message; isLast: boolean; streaming: boolean }) {
  const [showThinking, setShowThinking] = useState(false)
  const isStreaming = isLast && streaming && msg.role === 'assistant'
  const isThinking = isStreaming && !!msg.thinking && !msg.content

  return (
    <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} gap-1`}>
      {/* Thinking block -- only for assistant messages with reasoning_content */}
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

      {/* Main message bubble */}
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
          ? null  // show nothing in bubble while thinking (thinking block above handles it)
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

// suppress unused warning
const _noop = useCallback

const QUICK_PROMPTS = [
  'What is the current CRM pipeline status?',
  'Which contacts have the highest scores?',
  'What are the key playbook rules I should know?',
  'Summarise the latest agent decisions',
  'What lessons have been captured so far?',
]

export default function JarvisChat() {
  const saved = loadChatState()
  const [messages, setMessages] = useState<Message[]>(saved.messages)
  const [input, setInput] = useState(saved.input)
  const [streaming, setStreaming] = useState(false)
  const [model, setModel] = useState(saved.model || 'qwen/qwen3.5-35b-a3b')
  const [models, setModels] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Persist chat state whenever messages, model, or input change
  useEffect(() => {
    if (!streaming) saveChatState(messages, model, input)
  }, [messages, model, input, streaming])

  useEffect(() => {
    fetch('/api/chat/models')
      .then(r => r.json())
      .then((d: { models: string[]; default: string }) => {
        if (d.models.length) setModels(d.models)
        // Only set default model if no saved model preference
        if (d.default && !saved.model) setModel(d.default)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setInput('')

    const userMsg: Message = { role: 'user', content: trimmed }
    const assistantMsg: Message = { role: 'assistant', content: '' }
    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    // Build history from existing messages (exclude the blank assistant we just pushed)
    const history = messages.map(m => ({ role: m.role, content: m.content }))

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
            const parsed = JSON.parse(data) as { token?: string; error?: string }
            const p = parsed as { token?: string; thinking?: string; error?: string }
            if (p.error) {
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: p.error!, error: true }
                }
                return updated
              })
            } else if (p.thinking) {
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, thinking: (last.thinking ?? '') + p.thinking }
                }
                return updated
              })
            } else if (p.token) {
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + p.token }
                }
                return updated
              })
            }
          } catch {}
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: errMsg, error: true }
        }
        return updated
      })
    }

    setStreaming(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex flex-col bg-slate-800/30 backdrop-blur-sm border border-white/5 rounded-xl overflow-hidden" style={{ height: '460px' }}>
      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2.5">
          {/* Chat icon */}
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
        {models.length > 1 && (
          <div className="relative">
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all duration-200 cursor-pointer appearance-none pr-7"
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

      {/* ── Messages ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 mb-3 font-medium">Quick questions:</p>
            {QUICK_PROMPTS.map(q => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={streaming}
                className="block w-full text-left text-xs px-3.5 py-2.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 rounded-lg border border-white/5 hover:border-white/10 transition-all duration-200 disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
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

      {/* ── Input ────────────────────────────────────────── */}
      <div className="shrink-0 px-5 py-3.5 border-t border-white/5 flex gap-2">
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
          className="px-4 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all duration-200 shrink-0 cursor-pointer focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-2 focus:ring-offset-slate-900 focus:outline-none min-h-[44px] flex items-center gap-1.5"
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
  )
}
