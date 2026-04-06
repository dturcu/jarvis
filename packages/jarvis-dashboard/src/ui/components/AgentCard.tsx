import { useState } from 'react'

interface CurrentRunInfo {
  agent_id: string
  status: string
  step: number
  total_steps: number
  current_action: string
  started_at: string
}

interface AgentCardProps {
  agentId: string
  label: string
  description: string
  schedule: string
  lastRun: string | null
  lastOutcome: string | null
  status?: 'ready' | 'running' | 'awaiting_approval' | 'error'
  currentRun?: CurrentRunInfo | null
  onTrigger: (agentId: string) => void
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function AgentCard({
  agentId,
  label,
  description,
  schedule,
  lastRun,
  lastOutcome,
  status = 'ready',
  currentRun,
  onTrigger,
}: AgentCardProps) {
  const [triggering, setTriggering] = useState(false)

  const handleTrigger = async () => {
    setTriggering(true)
    try {
      await onTrigger(agentId)
    } finally {
      setTimeout(() => setTriggering(false), 1500)
    }
  }

  const isRunning = status === 'running' || status === 'awaiting_approval'

  /* ── Status dot + badge ────────────────────────────────── */
  const statusConfig = {
    ready: {
      dot: 'bg-emerald-500',
      dotPing: false,
      badge: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      text: 'Ready',
    },
    running: {
      dot: 'bg-amber-400',
      dotPing: true,
      badge: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      text: 'Running',
    },
    awaiting_approval: {
      dot: 'bg-orange-400',
      dotPing: true,
      badge: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
      text: 'Approval',
    },
    error: {
      dot: 'bg-red-500',
      dotPing: false,
      badge: 'bg-red-500/10 text-red-400 border border-red-500/20',
      text: 'Error',
    },
  }[status]

  const outcomeColors: Record<string, string> = {
    completed: 'text-emerald-400',
    error: 'text-red-400',
    approval_timeout: 'text-orange-400',
    empty_plan: 'text-slate-600',
  }

  const outcomeColor = lastOutcome
    ? outcomeColors[lastOutcome] ?? (lastOutcome.startsWith('error') ? 'text-red-400' : 'text-slate-600')
    : 'text-slate-600'

  const borderClass = isRunning
    ? 'border-amber-500/15'
    : status === 'error'
      ? 'border-red-500/15'
      : 'border-white/5 hover:border-white/10'

  return (
    <div
      className={`bg-slate-800/50 backdrop-blur-sm border ${borderClass} rounded-xl p-5 flex flex-col gap-3.5 transition-all duration-200`}
    >
      {/* ── Header: name + status badge ──────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-100 text-sm truncate">{label}</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">{description}</p>
        </div>
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5 shrink-0 ${statusConfig.badge}`}>
          <span className="relative flex h-2 w-2">
            {statusConfig.dotPing && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${statusConfig.dot} opacity-75`} />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${statusConfig.dot}`} />
          </span>
          {statusConfig.text}
        </span>
      </div>

      {/* ── Step progress (when running) ─────────────────── */}
      {isRunning && currentRun && currentRun.total_steps > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-amber-300/80 font-medium truncate max-w-[70%]">
              Step {currentRun.step}/{currentRun.total_steps}: {currentRun.current_action}
            </span>
            <span className="text-slate-600 font-mono tabular-nums">
              {Math.round((currentRun.step / currentRun.total_steps) * 100)}%
            </span>
          </div>
          <div className="w-full bg-slate-900/80 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-amber-500 to-amber-400 h-1.5 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.max(5, (currentRun.step / currentRun.total_steps) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Schedule + last run info ─────────────────────── */}
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="font-mono">{schedule}</span>
        <span className="flex items-center gap-1">
          Last: <span className={`font-medium ${outcomeColor}`}>{timeAgo(lastRun)}</span>
        </span>
      </div>

      {/* ── Run Now button ───────────────────────────────── */}
      <button
        onClick={handleTrigger}
        disabled={triggering || isRunning}
        className="w-full text-xs font-medium py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-2 focus:ring-offset-slate-900 focus:outline-none min-h-[44px] flex items-center justify-center"
      >
        {triggering ? 'Triggered...' : isRunning ? 'Running...' : 'Run Now'}
      </button>
    </div>
  )
}
