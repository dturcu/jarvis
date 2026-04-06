import type { ReactNode } from 'react'
import { STATUS_DOT_COLORS } from '../types/index.ts'

interface TimelineItemProps {
  timestamp: string
  title: string
  subtitle?: string
  status?: string
  typeIcon?: ReactNode
  typeLabel?: string
  actions?: ReactNode
  children?: ReactNode
  last?: boolean
}

export default function TimelineItem({
  timestamp, title, subtitle, status, typeIcon, typeLabel, actions, children, last,
}: TimelineItemProps) {
  const dotColor = status ? (STATUS_DOT_COLORS[status] ?? 'bg-slate-500') : 'bg-indigo-500'
  const time = new Date(timestamp)
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' })

  return (
    <div className={`relative pl-8 ${last ? '' : 'mb-4'}`}>
      {/* Vertical connector line */}
      {!last && <div className="absolute left-[11px] top-[18px] bottom-0 w-px bg-slate-800" />}

      {/* Timeline dot */}
      <div className={`absolute left-[6px] top-[6px] w-3 h-3 rounded-full ${dotColor} border-2 border-slate-950`} />

      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl p-4 hover:border-white/10 transition-all duration-200">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {typeIcon && <span className="text-slate-500 shrink-0">{typeIcon}</span>}
              {typeLabel && (
                <span className="text-[10px] text-slate-600 uppercase tracking-wider font-medium">{typeLabel}</span>
              )}
              <span className="text-[10px] text-slate-600 font-mono">{dateStr} {timeStr}</span>
            </div>
            <h3 className="text-sm font-medium text-slate-200 truncate">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {children && <div className="mt-3 pt-3 border-t border-white/5">{children}</div>}
      </div>
    </div>
  )
}
