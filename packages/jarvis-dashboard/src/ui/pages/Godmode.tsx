import { useEffect, useCallback, useState } from 'react'
import { useGodmodeStore } from '../stores/godmode-store.ts'
import ChatPanel from '../components/godmode/ChatPanel.tsx'
import ArtifactPanel from '../components/godmode/ArtifactPanel.tsx'
import ResearchPanel from '../components/godmode/ResearchPanel.tsx'
import CodePanel from '../components/godmode/CodePanel.tsx'
import CoworkPanel from '../components/godmode/CoworkPanel.tsx'
import { SurfaceBadge, ResizeHandle } from '../components/godmode/shared.tsx'

export default function Godmode() {
  const activeSurfaces = useGodmodeStore(s => s.activeSurfaces)
  const model = useGodmodeStore(s => s.model)
  const models = useGodmodeStore(s => s.models)
  const setModel = useGodmodeStore(s => s.setModel)
  const setModels = useGodmodeStore(s => s.setModels)
  const clearSession = useGodmodeStore(s => s.clearSession)
  const streaming = useGodmodeStore(s => s.streaming)

  const [rightPanelWidth, setRightPanelWidth] = useState(45) // percentage

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
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#030712]">
        <div className="flex items-center gap-3">
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
          {models.length > 1 && (
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

          {/* New session button */}
          <div
            onClick={() => !streaming && clearSession()}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
              streaming
                ? 'border-white/5 text-slate-600 cursor-not-allowed'
                : 'border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'
            }`}
          >
            New session
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat panel (always visible) */}
        <div
          className="flex flex-col overflow-hidden bg-[#030712]"
          style={{ width: hasRightPanel ? `${100 - rightPanelWidth}%` : '100%' }}
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
