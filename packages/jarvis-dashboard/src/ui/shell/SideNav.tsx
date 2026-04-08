import { NavLink, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useDashboardStore } from '../stores/dashboard-store.ts'
import {
  IconHome, IconInbox, IconWorkflow, IconKnowledge, IconCrm, IconSystem,
  IconGodmode, IconSchedule, IconPlugins, IconModels, IconSupport, IconSettings,
  IconHistory, IconRuns, IconQueue, IconGraph, IconDecisions, IconAnalytics,
} from '../shared/icons.tsx'

/* ── Navigation structure ──────────────────────────────────── */

interface NavEntry {
  to: string
  label: string
  icon: () => React.JSX.Element
  end?: boolean
  badge?: 'approvals'
  children?: NavEntry[]
}

const PRIMARY_NAV: NavEntry[] = [
  { to: '/', label: 'Overview', icon: IconHome, end: true },
  { to: '/inbox', label: 'Inbox', icon: IconInbox, badge: 'approvals' },
  {
    to: '/workflows', label: 'Work', icon: IconWorkflow,
    children: [
      { to: '/workflows', label: 'Workflows', icon: IconWorkflow },
      { to: '/history', label: 'History', icon: IconHistory },
    ],
  },
  {
    to: '/knowledge', label: 'Knowledge', icon: IconKnowledge,
    children: [
      { to: '/knowledge', label: 'Documents', icon: IconKnowledge },
      { to: '/graph', label: 'Entity Graph', icon: IconGraph },
      { to: '/decisions', label: 'Decisions', icon: IconDecisions },
    ],
  },
  {
    to: '/crm', label: 'CRM', icon: IconCrm,
    children: [
      { to: '/crm', label: 'Pipeline', icon: IconCrm },
      { to: '/crm/analytics', label: 'Analytics', icon: IconAnalytics },
    ],
  },
  { to: '/system', label: 'System', icon: IconSystem },
]

const SECONDARY_NAV: NavEntry[] = [
  { to: '/godmode', label: 'Godmode', icon: IconGodmode },
  { to: '/runs', label: 'Runs', icon: IconRuns },
  { to: '/models', label: 'Models', icon: IconModels },
  { to: '/queue', label: 'Queue', icon: IconQueue },
  { to: '/schedule', label: 'Schedule', icon: IconSchedule },
  { to: '/plugins', label: 'Plugins', icon: IconPlugins },
  { to: '/support', label: 'Support', icon: IconSupport },
]

const NAV_ACTIVE = 'text-j-text bg-j-elevated border-l-2 border-l-j-accent -ml-px'
const NAV_IDLE = 'text-j-text-secondary hover:text-j-text hover:bg-j-hover'
const NAV_BASE = 'flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors duration-100 cursor-pointer'

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
      className={`transition-transform duration-150 opacity-30 ${open ? 'rotate-180' : ''}`} aria-hidden="true">
      <path d="M2 4l3 3 3-3" />
    </svg>
  )
}

/* ── Component ─────────────────────────────────────────────── */

export default function SideNav() {
  const { systemHealth, pendingApprovals } = useDashboardStore()
  const [showSecondary, setShowSecondary] = useState(false)
  const location = useLocation()

  const healthDot = systemHealth === 'healthy' ? 'bg-emerald-500'
    : systemHealth === 'needs_attention' ? 'bg-amber-400'
    : 'bg-j-text-muted'

  const healthLabel = systemHealth === 'healthy' ? 'Systems nominal'
    : systemHealth === 'needs_attention' ? 'Needs attention'
    : 'Offline'

  return (
    <aside className="w-[220px] shrink-0 bg-j-surface border-r border-j-border flex flex-col h-full select-none" aria-label="Main navigation">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <h1 className="text-[15px] font-semibold tracking-tight text-j-text">Jarvis</h1>
        <p className="text-[10px] text-j-text-muted mt-0.5">Operations Console</p>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-3 overflow-y-auto" aria-label="Primary">
        <div className="flex flex-col gap-0.5" role="list">
          {PRIMARY_NAV.map(item => (
            <NavGroup key={item.to} item={item} pendingApprovals={pendingApprovals} location={location} />
          ))}
        </div>

        {/* Advanced */}
        <div className="mt-5 mb-1">
          <button
            onClick={() => setShowSecondary(!showSecondary)}
            aria-expanded={showSecondary}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-j-text-muted uppercase tracking-wider font-medium hover:text-j-text-secondary transition-colors cursor-pointer"
          >
            <span className="flex-1 text-left">Advanced</span>
            <Chevron open={showSecondary} />
          </button>
        </div>

        {showSecondary && (
          <div className="flex flex-col gap-0.5 animate-j-fade-in" role="list">
            {SECONDARY_NAV.map(item => (
              <NavItem key={item.to} item={item} />
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-j-border">
        <NavItem item={{ to: '/settings', label: 'Settings', icon: IconSettings }} />
        <div className="flex items-center gap-2 px-3 py-2 mt-1" role="status" aria-label={`System health: ${healthLabel}`}>
          <span className={`size-1.5 rounded-full ${healthDot}`} aria-hidden="true" />
          <span className="text-[11px] text-j-text-secondary">{healthLabel}</span>
        </div>
      </div>
    </aside>
  )
}

/* ── Nav primitives ────────────────────────────────────────── */

function NavItem({ item, indent, pendingApprovals }: {
  item: NavEntry; indent?: boolean; pendingApprovals?: number
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      role="listitem"
      className={({ isActive }) => `${NAV_BASE} ${indent ? 'ml-5' : ''} ${isActive ? NAV_ACTIVE : NAV_IDLE}`}
    >
      <span className="shrink-0 opacity-60" aria-hidden="true"><item.icon /></span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge === 'approvals' && pendingApprovals !== undefined && pendingApprovals > 0 && (
        <span className="bg-amber-500/80 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
          aria-label={`${pendingApprovals} pending`}>{pendingApprovals}</span>
      )}
    </NavLink>
  )
}

function NavGroup({ item, pendingApprovals, location }: {
  item: NavEntry; pendingApprovals: number; location: ReturnType<typeof useLocation>
}) {
  if (!item.children) return <NavItem item={item} pendingApprovals={pendingApprovals} />

  const isGroupActive = item.children.some(child => location.pathname === child.to) || location.pathname === item.to
  const [expanded, setExpanded] = useState(isGroupActive)

  return (
    <div role="listitem">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={`w-full ${NAV_BASE} ${isGroupActive ? 'text-j-text' : NAV_IDLE}`}
      >
        <span className="shrink-0 opacity-60" aria-hidden="true"><item.icon /></span>
        <span className="flex-1 truncate text-left">{item.label}</span>
        <Chevron open={expanded} />
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5 animate-j-fade-in" role="list">
          {item.children.map(child => <NavItem key={child.to} item={child} indent />)}
        </div>
      )}
    </div>
  )
}
