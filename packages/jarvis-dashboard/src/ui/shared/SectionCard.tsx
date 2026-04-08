import type { ReactNode } from 'react'

interface SectionCardProps {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  accent?: 'default' | 'warn' | 'error' | 'success' | 'accent'
  compact?: boolean
}

const ACCENT_LEFT: Record<string, string> = {
  default: '',
  warn: 'border-l-2 border-l-amber-500/30',
  error: 'border-l-2 border-l-red-500/30',
  success: 'border-l-2 border-l-emerald-500/30',
  accent: 'border-l-2 border-l-j-accent/30',
}

export default function SectionCard({
  title, subtitle, action, children, className = '', accent = 'default', compact = false,
}: SectionCardProps) {
  return (
    <div
      className={`bg-j-elevated border border-j-border ${ACCENT_LEFT[accent]} ${className}`}
      role={title ? 'region' : undefined}
      aria-label={title}
    >
      {(title || action) && (
        <div className={`flex items-center justify-between ${compact ? 'px-4 py-2.5' : 'px-5 py-3'} border-b border-j-border`}>
          <div>
            {title && <h3 className="text-[11px] font-medium text-j-text-secondary uppercase tracking-wider">{title}</h3>}
            {subtitle && <p className="text-[10px] text-j-text-muted mt-0.5">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={compact ? 'p-4' : 'p-5'}>
        {children}
      </div>
    </div>
  )
}
