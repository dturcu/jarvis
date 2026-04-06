import { useGodmodeStore } from '../../stores/godmode-store.ts'

export default function CoworkPanel() {
  const steps = useGodmodeStore(s => s.coworkSteps)
  const closeSurface = useGodmodeStore(s => s.closeSurface)

  if (steps.length === 0) {
    return (
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-500">Preparing task steps...</span>
        </div>
        <div onClick={() => closeSurface('cowork')} className="p-1 text-slate-600 hover:text-slate-300 cursor-pointer transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
            <path d="M7 2v10M2 7h10" />
            <rect x="2" y="2" width="10" height="10" rx="2" />
          </svg>
          <span className="text-xs font-medium text-slate-300">Task Steps</span>
          <span className="text-[10px] text-slate-600 font-mono">
            {steps.filter(s => s.status === 'done').length}/{steps.length}
          </span>
        </div>
        <div onClick={() => closeSurface('cowork')} className="p-1 text-slate-600 hover:text-slate-300 cursor-pointer transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {steps.map((step) => (
          <div
            key={step.index}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border shrink-0 ${
              step.status === 'done'
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : step.status === 'running'
                ? 'bg-amber-500/5 border-amber-500/20'
                : step.status === 'error'
                ? 'bg-red-500/5 border-red-500/20'
                : 'bg-slate-800/30 border-white/5'
            }`}
          >
            {/* Status indicator */}
            {step.status === 'running' ? (
              <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin shrink-0" />
            ) : step.status === 'done' ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-emerald-400 shrink-0">
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3.5 6l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : step.status === 'error' ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-red-400 shrink-0">
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 4l4 4M8 4l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <div className="w-3 h-3 rounded-full bg-slate-700 shrink-0" />
            )}

            <div>
              <span className="text-[10px] text-slate-500 font-mono">Step {step.index + 1}</span>
              <p className="text-xs text-slate-400 max-w-[200px] truncate">{step.action}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
