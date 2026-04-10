import { useEffect, useCallback, useState } from 'react'
import { useGodmodeStore } from '../stores/godmode-store.ts'
import ChatPanel from '../components/godmode/ChatPanel.tsx'
import ArtifactPanel from '../components/godmode/ArtifactPanel.tsx'
import ResearchPanel from '../components/godmode/ResearchPanel.tsx'
import CodePanel from '../components/godmode/CodePanel.tsx'
import CoworkPanel from '../components/godmode/CoworkPanel.tsx'
import { SurfaceBadge, ResizeHandle } from '../components/godmode/shared.tsx'

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

export default function Godmode() {
  const activeSurfaces = useGodmodeStore(s => s.activeSurfaces)
  const model = useGodmodeStore(s => s.model)
  const models = useGodmodeStore(s => s.models)
  const setModel = useGodmodeStore(s => s.setModel)
  const setModels = useGodmodeStore(s => s.setModels)
  const streaming = useGodmodeStore(s => s.streaming)

  // Conversation management
  const conversations = useGodmodeStore(s => s.conversations)
  const currentConversationId = useGodmodeStore(s => s.currentConversationId)
  const newConversation = useGodmodeStore(s => s.newConversation)
  const switchConversation = useGodmodeStore(s => s.switchConversation)
  const deleteConversation = useGodmodeStore(s => s.deleteConversation)

  const [rightPanelWidth, setRightPanelWidth] = useState(45) // percentage
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Fetch available models
  useEffect(() => {
    fetch('/api/godmode/models')
      .then(r => r.json())
      .then((d: { models: string[]; default: string }) => {
        if (d.models.length) setModels(d.models)
        if (d.default && !model) setModel(d.default)
      })
      .catch(() => {})
  }, [])

  const handleResize = useCallback((deltaX: number) => {
    setRightPanelWidth(prev => {
      const containerWidth = window.innerWidth - 240 // sidebar width
      const deltaPct = (deltaX / containerWidth) * 100
      return Math.max(25, Math.min(65, prev - deltaPct))
    })
  }, [])

  // Determine which right panel to show (only one at a time, priority order)
  const rightSurface = activeSurfaces.find(s => s === 'artifact')
    ?? activeSurfaces.find(s => s === 'research')
    ?? activeSurfaces.find(s => s === 'code')
    ?? null

  const showCowork = activeSurfaces.includes('cowork')
  const hasRightPanel = rightSurface !== null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#030712]">
        <div className="flex items-center gap-3">
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="w-8 h-8 rounded-xl bg-slate-800/50 border border-white/5 flex items-center justify-center hover:bg-slate-700/50 transition-colors cursor-pointer"
            title={sidebarOpen ? 'Hide conversations' : 'Show conversations'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="text-slate-400">
              <path d="M2 3.5h10M2 7h10M2 10.5h10" />
            </svg>
          </button>
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
              <path d="M10 2L3 7v6l7 5 7-5V7z" />
              <circle cx="10" cy="10" r="3" />
              <path d="M10 7v6M7 10h6" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-100">Godmode</h1>
            <p className="text-[10px] text-slate-600">Autonomous multi-surface AI</p>
          </div>

          {/* Active surface badges */}
          <div className="flex gap-1.5 ml-4">
            {activeSurfaces.map(s => (
              <SurfaceBadge key={s} surface={s} />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Model selector */}
          {models.length >= 1 && (
            <div className="relative">
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all cursor-pointer appearance-none pr-7"
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

          {/* New chat button */}
          <div
            onClick={() => !streaming && newConversation()}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
              streaming
                ? 'border-white/5 text-slate-600 cursor-not-allowed'
                : 'border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'
            }`}
          >
            New chat
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Conversation sidebar */}
        <div className={`${sidebarOpen ? 'w-56' : 'w-0'} shrink-0 transition-all duration-200 overflow-hidden border-r border-white/5 bg-[#0a0f1a]`}>
          <div className="w-56 h-full flex flex-col">
            <div className="flex items-center justify-between px-3 py-3 border-b border-white/5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Conversations</span>
              <span className="text-[10px] text-slate-600">{conversations.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="text-xs text-slate-600 px-3 py-4 text-center">No conversations yet</p>
              ) : (
                conversations.map(c => (
                  <div
                    key={c.id}
                    onClick={() => switchConversation(c.id)}
                    className={`group px-3 py-2.5 cursor-pointer border-b border-white/[0.03] transition-colors ${
                      c.id === currentConversationId
                        ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
                        : 'hover:bg-slate-800/50 border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${
                          c.id === currentConversationId ? 'text-indigo-300' : 'text-slate-300'
                        }`}>
                          {c.title}
                        </p>
                        <p className="text-[10px] text-slate-600 mt-0.5">
                          {c.messageCount} msg{c.messageCount !== 1 ? 's' : ''} · {timeLabel(c.updatedAt)}
                        </p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); deleteConversation(c.id) }}
                        className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-xs cursor-pointer shrink-0 mt-0.5"
                        title="Delete conversation"
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

        {/* Chat panel (always visible) */}
        <div
          className="flex flex-col overflow-hidden bg-[#030712]"
          style={{ width: hasRightPanel ? `${100 - rightPanelWidth}%` : '100%', flex: hasRightPanel ? undefined : 1 }}
        >
          <ChatPanel />
        </div>

        {/* Resize handle + right panel */}
        {hasRightPanel && (
          <>
            <ResizeHandle onResize={handleResize} />
            <div
              className="flex flex-col overflow-hidden border-l border-white/5 bg-[#0a0f1a]"
              style={{ width: `${rightPanelWidth}%` }}
            >
              {rightSurface === 'artifact' && <ArtifactPanel />}
              {rightSurface === 'research' && <ResearchPanel />}
              {rightSurface === 'code' && <CodePanel />}
            </div>
          </>
        )}
      </div>

      {/* Cowork bottom drawer */}
      {showCowork && (
        <div className="shrink-0 border-t border-white/5 bg-[#0a0f1a] max-h-[30vh] overflow-y-auto">
          <CoworkPanel />
        </div>
      )}
    </div>
  )
}
