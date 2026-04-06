import type { ReactNode } from 'react'

interface DataCardProps {
  children: ReactNode
  className?: string
  variant?: 'default' | 'warning' | 'error' | 'success'
  hover?: boolean
  onClick?: () => void
}

const VARIANTS = {
  default: 'border-white/5 hover:border-white/10',
  warning: 'border-amber-500/15 hover:border-amber-500/30',
  error: 'border-red-500/15 hover:border-red-500/30',
  success: 'border-emerald-500/15 hover:border-emerald-500/30',
}

export default function DataCard({
  children, className = '', variant = 'default', hover = true, onClick,
}: DataCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-slate-800/50 backdrop-blur-sm border rounded-xl p-5 transition-all duration-200 ${
        VARIANTS[variant]
      } ${hover ? '' : 'hover:border-inherit'} ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
