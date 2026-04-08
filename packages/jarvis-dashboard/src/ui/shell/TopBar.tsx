import { useLocation } from 'react-router-dom'
import { useDashboardStore } from '../stores/dashboard-store.ts'
import { formatUptime } from '../types/index.ts'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview', '/inbox': 'Inbox', '/workflows': 'Work', '/history': 'History',
  '/knowledge': 'Knowledge', '/graph': 'Entity Graph', '/decisions': 'Decisions',
  '/crm': 'CRM', '/crm/analytics': 'Analytics', '/system': 'System',
  '/settings': 'Settings', '/recovery': 'Recovery', '/godmode': 'Godmode',
  '/runs': 'Runs', '/models': 'Models', '/queue': 'Queue',
  '/support': 'Support', '/schedule': 'Schedule', '/plugins': 'Plugins', '/portal': 'Portal',
}

export default function TopBar({ onToggleAssistant, assistantOpen }: {
  onToggleAssistant: () => void; assistantOpen: boolean
}) {
  const location = useLocation()
  const { daemon, systemHealth } = useDashboardStore()
  const title = PAGE_TITLES[location.pathname] ?? 'Jarvis'

  return (
    <header className="h-12 shrink-0 bg-j-surface border-b border-j-border flex items-center justify-between px-5">
      <h2 className="text-[13px] font-medium text-j-text">{title}</h2>

      <div className="flex items-center gap-4">
        {daemon?.running ? (
          <div className="flex items-center gap-3 text-[11px] font-mono text-j-text-muted">
            <span className={`size-1.5 rounded-full ${systemHealth === 'healthy' ? 'bg-emerald-500' : systemHealth === 'needs_attention' ? 'bg-amber-400' : 'bg-j-text-muted'}`} />
            <span>PID {daemon.pid}</span>
            <span className="text-j-border">·</span>
            <span>{formatUptime(daemon.uptime_seconds)}</span>
            <span className="text-j-border">·</span>
            <span>{daemon.agents_registered} agents</span>
          </div>
        ) : (
          <span className="text-[11px] font-mono text-j-text-muted flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-j-text-muted" />
            Offline
          </span>
        )}

        <div className="h-4 w-px bg-j-border" />

        <button
          onClick={onToggleAssistant}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
            assistantOpen ? 'text-j-accent' : 'text-j-text-muted hover:text-j-text'
          }`}
          aria-label="Toggle assistant"
          aria-pressed={assistantOpen}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
            <rect x="1" y="2" width="11" height="8" rx="1" />
            <path d="M4 5.5h3M4 7.5h4" />
          </svg>
          Assistant
        </button>
      </div>
    </header>
  )
}
