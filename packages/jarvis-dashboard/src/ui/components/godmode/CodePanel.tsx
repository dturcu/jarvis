import { useGodmodeStore } from '../../stores/godmode-store.ts'
import { CopyButton } from './shared.tsx'

export default function CodePanel() {
  const messages = useGodmodeStore(s => s.messages)
  const closeSurface = useGodmodeStore(s => s.closeSurface)
  const streaming = useGodmodeStore(s => s.streaming)

  // Extract code blocks from the latest assistant message
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const codeBlocks = extractCodeBlocks(lastAssistant?.content ?? '')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
            <path d="M5 4L2 8l3 4" />
            <path d="M11 4l3 4-3 4" />
            <path d="M9 2l-2 12" />
          </svg>
          <span className="text-xs font-medium text-slate-300">Code</span>
          {streaming && (
            <div className="w-2.5 h-2.5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
          )}
        </div>
        <div onClick={() => closeSurface('code')} className="p-1 text-slate-600 hover:text-slate-300 cursor-pointer transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </div>
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-y-auto">
        {codeBlocks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-600 text-xs font-mono">
            {streaming ? 'Generating code...' : 'No code blocks found'}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {codeBlocks.map((block, i) => (
              <div key={i} className="relative">
                {/* Language tag + copy */}
                <div className="flex items-center justify-between px-4 py-2 bg-slate-800/30">
                  <span className="text-[10px] text-slate-500 font-mono uppercase">{block.lang || 'text'}</span>
                  <CopyButton text={block.code} />
                </div>
                {/* Code */}
                <pre className="px-4 py-3 text-xs font-mono text-slate-300 leading-relaxed overflow-x-auto bg-[#0d1117]">
                  <code>{block.code}</code>
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function extractCodeBlocks(text: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = []
  const regex = /```(\w*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    // Skip artifact blocks (handled by artifact panel)
    if (match[1]?.startsWith('artifact')) continue
    blocks.push({ lang: match[1] ?? '', code: match[2]!.trim() })
  }
  return blocks
}
