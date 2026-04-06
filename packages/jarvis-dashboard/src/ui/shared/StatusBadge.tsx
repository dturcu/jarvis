import { STATUS_COLORS, STATUS_DOT_COLORS, STATUS_LABELS } from '../types/index.ts'

interface StatusBadgeProps {
  status: string
  label?: string
  pulse?: boolean
  size?: 'sm' | 'md'
  variant?: 'pill' | 'dot'
}

export default function StatusBadge({ status, label, pulse, size = 'sm', variant = 'pill' }: StatusBadgeProps) {
  const displayLabel = label ?? STATUS_LABELS[status] ?? status
  const dotColor = STATUS_DOT_COLORS[status] ?? 'bg-slate-500'

  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="relative flex h-2 w-2 shrink-0">
          {pulse && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColor}`} />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`} />
        </span>
        <span className={`font-medium ${size === 'sm' ? 'text-xs' : 'text-sm'} text-slate-300`}>
          {displayLabel}
        </span>
      </span>
    )
  }

  const pillColor = STATUS_COLORS[status] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/20'

  return (
    <span className={`inline-flex items-center gap-1.5 border rounded-full font-medium ${pillColor} ${
      size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'
    }`}>
      {displayLabel}
    </span>
  )
}
