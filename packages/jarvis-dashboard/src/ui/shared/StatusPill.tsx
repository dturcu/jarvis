const PILL_STYLES: Record<string, string> = {
  healthy: 'text-emerald-400/80 bg-emerald-500/6 border-emerald-500/12',
  ok: 'text-emerald-400/80 bg-emerald-500/6 border-emerald-500/12',
  completed: 'text-emerald-400/80 bg-emerald-500/6 border-emerald-500/12',
  approved: 'text-emerald-400/80 bg-emerald-500/6 border-emerald-500/12',

  running: 'text-j-accent/80 bg-j-accent/6 border-j-accent/12',
  executing: 'text-j-accent/80 bg-j-accent/6 border-j-accent/12',
  planning: 'text-blue-400/80 bg-blue-500/6 border-blue-500/12',
  queued: 'text-blue-400/80 bg-blue-500/6 border-blue-500/12',

  pending: 'text-amber-400/80 bg-amber-500/6 border-amber-500/12',
  awaiting_approval: 'text-amber-400/80 bg-amber-500/6 border-amber-500/12',
  warning: 'text-amber-400/80 bg-amber-500/6 border-amber-500/12',
  degraded: 'text-amber-400/80 bg-amber-500/6 border-amber-500/12',
  needs_attention: 'text-amber-400/80 bg-amber-500/6 border-amber-500/12',

  failed: 'text-red-400/80 bg-red-500/6 border-red-500/12',
  critical: 'text-red-400/80 bg-red-500/6 border-red-500/12',
  broken: 'text-red-400/80 bg-red-500/6 border-red-500/12',
  rejected: 'text-red-400/80 bg-red-500/6 border-red-500/12',

  cancelled: 'text-j-text-muted bg-j-surface border-j-border',
  offline: 'text-j-text-muted bg-j-surface border-j-border',
}

const DOT_COLORS: Record<string, string> = {
  healthy: 'bg-emerald-500', ok: 'bg-emerald-500', completed: 'bg-emerald-500', approved: 'bg-emerald-500',
  running: 'bg-j-accent', executing: 'bg-j-accent',
  planning: 'bg-blue-400', queued: 'bg-blue-400',
  pending: 'bg-amber-400', awaiting_approval: 'bg-amber-400', warning: 'bg-amber-400',
  failed: 'bg-red-500', critical: 'bg-red-500', broken: 'bg-red-500', rejected: 'bg-red-500',
  cancelled: 'bg-j-text-secondary', offline: 'bg-j-text-muted',
}

const LABELS: Record<string, string> = {
  planning: 'Planning', executing: 'Running', awaiting_approval: 'Awaiting', completed: 'Done',
  failed: 'Failed', cancelled: 'Cancelled', queued: 'Queued', running: 'Running', pending: 'Pending',
  approved: 'Approved', rejected: 'Rejected', ok: 'OK', warning: 'Warning', critical: 'Critical',
  healthy: 'Healthy', degraded: 'Degraded', broken: 'Broken', offline: 'Offline',
  needs_attention: 'Attention',
}

interface StatusPillProps {
  status: string
  label?: string
  variant?: 'pill' | 'dot'
  pulse?: boolean
}

export default function StatusPill({ status, label, variant = 'pill', pulse }: StatusPillProps) {
  const displayLabel = label ?? LABELS[status] ?? status
  const dotColor = DOT_COLORS[status] ?? 'bg-j-text-muted'

  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="relative flex size-1.5 shrink-0">
          {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-50 ${dotColor}`} />}
          <span className={`relative inline-flex rounded-full size-1.5 ${dotColor}`} />
        </span>
        <span className="text-[11px] text-j-text-secondary">{displayLabel}</span>
      </span>
    )
  }

  const pillStyle = PILL_STYLES[status] ?? 'text-j-text-muted bg-j-surface border-j-border'

  return (
    <span className={`inline-flex items-center border text-[10px] font-medium px-2 py-0.5 ${pillStyle}`}>
      {displayLabel}
    </span>
  )
}
