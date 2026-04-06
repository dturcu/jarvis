import { useState, useRef, useEffect } from 'react'
import type { ToolLogEntry } from '../../stores/godmode-store.ts'

// ─── Markdown Renderer ──────────────────────────────────────────────────────

export function MarkdownRenderer({ content }: { content: string }) {
  // Simple markdown rendering without external deps for streaming compatibility
  const html = renderMarkdown(content)
  return (
    <div
      className="prose prose-invert prose-sm max-w-none
        [&_pre]:bg-slate-900 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:font-mono
        [&_code]:bg-slate-800/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:text-indigo-300
        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-slate-300
        [&_a]:text-indigo-400 [&_a]:no-underline hover:[&_a]:underline
        [&_h1]:text-base [&_h1]:font-medium [&_h1]:text-slate-100 [&_h1]:mt-4 [&_h1]:mb-2
        [&_h2]:text-sm [&_h2]:font-medium [&_h2]:text-slate-200 [&_h2]:mt-3 [&_h2]:mb-1.5
        [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-slate-300 [&_h3]:mt-2 [&_h3]:mb-1
        [&_p]:text-sm [&_p]:text-slate-300 [&_p]:leading-relaxed [&_p]:my-1.5
        [&_ul]:text-sm [&_ul]:text-slate-300 [&_ul]:my-1 [&_ul]:pl-4
        [&_ol]:text-sm [&_ol]:text-slate-300 [&_ol]:my-1 [&_ol]:pl-4
        [&_li]:my-0.5
        [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-500/50 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 [&_blockquote]:italic
        [&_hr]:border-white/10 [&_hr]:my-3
        [&_table]:text-xs [&_table]:w-full [&_th]:text-left [&_th]:text-slate-400 [&_th]:font-medium [&_th]:pb-1 [&_th]:border-b [&_th]:border-white/10
        [&_td]:py-1 [&_td]:text-slate-300 [&_td]:border-b [&_td]:border-white/5
        [&_strong]:text-slate-100 [&_strong]:font-medium
        [&_em]:text-slate-400"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML (but preserve our generated tags later)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // HR
  html = html.replace(/^---$/gm, '<hr />')

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Paragraphs (lines not already wrapped)
  html = html.replace(/^(?!<[hupol\-lb]|$)(.+)$/gm, '<p>$1</p>')

  // Clean up double newlines
  html = html.replace(/\n{2,}/g, '\n')

  return html
}

// ─── Tool Call Card ─────────────────────────────────────────────────────────

export function ToolCallCard({ tool }: { tool: ToolLogEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-2 border border-white/10 rounded-lg overflow-hidden bg-slate-900/50">
      <div
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/50 transition-colors"
      >
        {/* Status icon */}
        {tool.status === 'running' ? (
          <div className="w-3.5 h-3.5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin shrink-0" />
        ) : tool.status === 'error' ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-red-400 shrink-0">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-emerald-400 shrink-0">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4.5 7l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}

        <span className="text-xs font-mono text-slate-400 flex-1">{tool.name}</span>

        {tool.duration != null && (
          <span className="text-[10px] text-slate-600 font-mono">{(tool.duration / 1000).toFixed(1)}s</span>
        )}

        {/* Chevron */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`text-slate-600 transition-transform ${expanded ? 'rotate-90' : ''}`}>
          <path d="M4 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {expanded && (
        <div className="px-3 py-2 border-t border-white/5 space-y-2">
          <div>
            <span className="text-[10px] text-slate-600 uppercase tracking-wider font-medium">Input</span>
            <pre className="text-[11px] text-slate-400 font-mono mt-0.5 whitespace-pre-wrap break-all">
              {JSON.stringify(tool.params, null, 2)}
            </pre>
          </div>
          {tool.result && (
            <div>
              <span className="text-[10px] text-slate-600 uppercase tracking-wider font-medium">Output</span>
              <pre className="text-[11px] text-slate-500 font-mono mt-0.5 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Thinking Block ─────────────────────────────────────────────────────────

export function ThinkingBlock({ content, isLive }: { content: string; isLive: boolean }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-1">
      <div
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors cursor-pointer"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>
          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {isLive ? <span className="animate-pulse">Thinking...</span> : 'Show thinking'}
      </div>
      {expanded && (
        <div className="mt-1.5 text-xs text-slate-500 bg-slate-900/80 border border-white/5 rounded-lg px-3.5 py-2.5 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  )
}

// ─── Streaming Dots ─────────────────────────────────────────────────────────

export function StreamingDots() {
  return (
    <span className="inline-flex gap-1.5 items-center text-slate-500">
      <span className="animate-pulse">&#9679;</span>
      <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>&#9679;</span>
      <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>&#9679;</span>
    </span>
  )
}

// ─── Copy Button ────────────────────────────────────────────────────────────

export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      onClick={handleCopy}
      className={`cursor-pointer text-slate-500 hover:text-slate-300 transition-colors ${className}`}
      title="Copy to clipboard"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
          <path d="M3 7.5l3 3 5-5.5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="5" width="7" height="7" rx="1.5" />
          <path d="M9 5V3.5A1.5 1.5 0 007.5 2h-4A1.5 1.5 0 002 3.5v4A1.5 1.5 0 003.5 9H5" />
        </svg>
      )}
    </div>
  )
}

// ─── Surface Badge ──────────────────────────────────────────────────────────

const SURFACE_COLORS: Record<string, string> = {
  chat: 'bg-slate-700 text-slate-300',
  artifact: 'bg-indigo-500/20 text-indigo-300',
  research: 'bg-purple-500/20 text-purple-300',
  code: 'bg-emerald-500/20 text-emerald-300',
  cowork: 'bg-amber-500/20 text-amber-300',
}

const SURFACE_LABELS: Record<string, string> = {
  chat: 'Chat',
  artifact: 'Artifact',
  research: 'Research',
  code: 'Code',
  cowork: 'Cowork',
}

export function SurfaceBadge({ surface }: { surface: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${SURFACE_COLORS[surface] ?? SURFACE_COLORS.chat}`}>
      {SURFACE_LABELS[surface] ?? surface}
    </span>
  )
}

// ─── Resize Handle ──────────────────────────────────────────────────────────

export function ResizeHandle({ onResize }: { onResize: (deltaX: number) => void }) {
  const dragging = useRef(false)
  const lastX = useRef(0)

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = e.clientX - lastX.current
      lastX.current = e.clientX
      onResize(delta)
    }
    const handleUp = () => { dragging.current = false }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [onResize])

  return (
    <div
      onMouseDown={(e) => { dragging.current = true; lastX.current = e.clientX }}
      className="w-1 cursor-col-resize hover:bg-indigo-500/30 active:bg-indigo-500/50 transition-colors shrink-0"
    />
  )
}
