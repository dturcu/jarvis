import { useState, useRef, useEffect } from 'react'
import { useGodmodeStore } from '../../stores/godmode-store.ts'
import type { GodmodeMessage } from '../../stores/godmode-store.ts'
import { MarkdownRenderer, ToolCallCard, ThinkingBlock, StreamingDots } from './shared.tsx'

// ─── Message Bubble ─────────────────────────────────────────────────────────

function MessageBubble({ msg, isLast, streaming }: { msg: GodmodeMessage; isLast: boolean; streaming: boolean }) {
  const isStreaming = isLast && streaming && msg.role === 'assistant'
  const isThinking = isStreaming && !!msg.thinking && !msg.content

  return (
    <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} gap-1`}>
      {/* Thinking block */}
      {msg.role === 'assistant' && msg.thinking && (
        <div className="max-w-[90%] w-full">
          <ThinkingBlock content={msg.thinking} isLive={isThinking} />
        </div>
      )}

      {/* Tool cards inline */}
      {msg.role === 'assistant' && msg.tools && msg.tools.length > 0 && (
        <div className="max-w-[90%] w-full">
          {msg.tools.map(tool => (
            <ToolCallCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {/* Main message bubble */}
      {(msg.content || (isStreaming && !isThinking)) && (
        <div className={`max-w-[90%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
          msg.role === 'user'
            ? 'bg-indigo-600 text-white rounded-br-md'
            : msg.error
            ? 'bg-red-500/10 border border-red-500/20 text-red-300'
            : 'bg-slate-800/70 text-slate-200 border border-white/5 rounded-bl-md'
        }`}>
          {msg.content ? (
            msg.role === 'assistant' && !msg.error ? (
              <MarkdownRenderer content={msg.content} />
            ) : (
              <span className="whitespace-pre-wrap">{msg.content}</span>
            )
          ) : isStreaming && !isThinking ? (
            <StreamingDots />
          ) : null}
        </div>
      )}
    </div>
  )
}

// ─── Quick Prompts ──────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: 'CRM overview', text: 'Show me the current CRM pipeline status with top prospects' },
  { label: 'Build a chart', text: 'Create an HTML dashboard showing a bar chart of CRM stages' },
  { label: 'Research', text: 'Research the latest ISO 26262 Part 6 amendments and their impact on software testing' },
  { label: 'Write code', text: 'Write a TypeScript function that sorts contacts by score and groups them by stage' },
  { label: 'Multi-step task', text: 'Find our top 3 scored contacts and draft a brief outreach summary for each' },
]

// ─── Chat Panel ─────────────────────────────────────────────────────────────

export default function ChatPanel() {
  const messages = useGodmodeStore(s => s.messages)
  const streaming = useGodmodeStore(s => s.streaming)
  const sendMessage = useGodmodeStore(s => s.sendMessage)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  const handleSend = () => {
    if (!input.trim() || streaming) return
    sendMessage(input)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
                  <path d="M12 2L5 7v6l7 5 7-5V7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-slate-200">Godmode</h2>
              <p className="text-sm text-slate-500 mt-1">Ask anything. The right tools and interface activate automatically.</p>
            </div>
            <div className="flex flex-wrap gap-2 max-w-md justify-center">
              {QUICK_PROMPTS.map(q => (
                <div
                  key={q.label}
                  onClick={() => !streaming && sendMessage(q.text)}
                  className="px-3 py-2 text-xs bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 rounded-lg border border-white/5 hover:border-white/10 transition-all cursor-pointer"
                >
                  {q.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} isLast={i === messages.length - 1} streaming={streaming} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 border-t border-white/5">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder={streaming ? 'Processing...' : 'Ask anything... (Enter to send, Shift+Enter for newline)'}
            rows={1}
            className="flex-1 text-sm bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none disabled:opacity-50 transition-all resize-none leading-relaxed"
          />
          <div
            onClick={handleSend}
            className={`p-3 rounded-xl transition-all shrink-0 cursor-pointer ${
              streaming || !input.trim()
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {streaming ? (
              <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2L7 9" />
                <path d="M14 2l-4 12-3-5-5-3z" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
