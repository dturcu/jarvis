import { useGodmodeStore } from '../../stores/godmode-store.ts'

const PHASES = [
  { id: 'searching', label: 'Search', icon: '1' },
  { id: 'reading', label: 'Read', icon: '2' },
  { id: 'synthesizing', label: 'Synthesize', icon: '3' },
] as const

export default function ResearchPanel() {
  const phase = useGodmodeStore(s => s.researchPhase)
  const sources = useGodmodeStore(s => s.researchSources)
  const closeSurface = useGodmodeStore(s => s.closeSurface)

  const phaseIndex = PHASES.findIndex(p => p.id === phase)
  const isDone = phase === 'done'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <span className="text-xs font-medium text-slate-300">Deep Research</span>
        </div>
        <div onClick={() => closeSurface('research')} className="p-1 text-slate-600 hover:text-slate-300 cursor-pointer transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </div>
      </div>

      {/* Phase progress bar */}
      <div className="shrink-0 px-4 py-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          {PHASES.map((p, i) => {
            const isActive = p.id === phase
            const isComplete = isDone || phaseIndex > i
            return (
              <div key={p.id} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-2 flex-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all ${
                    isComplete
                      ? 'bg-purple-500 text-white'
                      : isActive
                      ? 'bg-purple-500/20 text-purple-300 ring-2 ring-purple-500/50'
                      : 'bg-slate-800 text-slate-600'
                  }`}>
                    {isComplete ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 5l2.5 2.5L8 3" />
                      </svg>
                    ) : p.icon}
                  </div>
                  <span className={`text-[10px] font-medium ${
                    isActive || isComplete ? 'text-slate-300' : 'text-slate-600'
                  }`}>
                    {p.label}
                  </span>
                </div>
                {i < PHASES.length - 1 && (
                  <div className={`h-px flex-1 ${isComplete ? 'bg-purple-500' : 'bg-slate-800'}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Status text */}
        {phase !== 'idle' && (
          <div className="mt-2.5 flex items-center gap-2">
            {!isDone && (
              <div className="w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin shrink-0" />
            )}
            <span className="text-xs text-slate-500">
              {isDone ? 'Research complete' :
               phase === 'searching' ? 'Searching for sources...' :
               phase === 'reading' ? 'Reading and analyzing sources...' :
               phase === 'synthesizing' ? 'Synthesizing findings...' :
               'Preparing...'}
            </span>
          </div>
        )}
      </div>

      {/* Sources list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {sources.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-600 text-xs">
            Sources will appear here as the research progresses
          </div>
        ) : (
          <div className="space-y-2">
            <h3 className="text-[10px] text-slate-600 uppercase tracking-wider font-medium mb-2">
              Sources ({sources.length})
            </h3>
            {sources.map((source, i) => (
              <div key={i} className="p-2.5 bg-slate-800/30 border border-white/5 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-purple-400 font-mono shrink-0 mt-0.5">[{i + 1}]</span>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-300 font-medium truncate">{source.title}</p>
                    <p className="text-[10px] text-slate-600 truncate mt-0.5">{source.url}</p>
                    {source.snippet && (
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{source.snippet}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
