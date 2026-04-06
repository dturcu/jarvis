import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useEffect, useState, useCallback, useRef } from 'react'
import Home from './pages/Home.tsx'
import CrmPipeline from './pages/CrmPipeline.tsx'
import KnowledgeBase from './pages/KnowledgeBase.tsx'
import Decisions from './pages/Decisions.tsx'
import Schedule from './pages/Schedule.tsx'
import Plugins from './pages/Plugins.tsx'
import Portal from './pages/Portal.tsx'
import RunTimeline from './pages/RunTimeline.tsx'
import EntityGraph from './pages/EntityGraph.tsx'
import CrmAnalytics from './pages/CrmAnalytics.tsx'
import Settings from './pages/Settings.tsx'
import Godmode from './pages/Godmode.tsx'
import Approvals from './pages/Approvals.tsx'
import { ModeProvider, useMode } from './context/ModeContext.tsx'

interface HealthData {
  pendingApprovals?: number
}

interface AttentionSummary {
  needs_attention: { pending_approvals: number; failed_runs: number; overdue_schedules: number }
  system_status: string // "healthy" | "needs_attention" | "unknown"
}

type SystemHealth = 'healthy' | 'needs_attention' | 'offline'

/* ── SVG Icon Components ─────────────────────────────────── */

function IconGodmode() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2L3 7v6l7 5 7-5V7z" />
      <circle cx="10" cy="10" r="3" />
      <path d="M10 7v6M7 10h6" />
    </svg>
  )
}

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5L10 4l7 6.5" />
      <path d="M5 9.5V16a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V9.5" />
    </svg>
  )
}

function IconCrm() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <path d="M2 7h16" />
      <path d="M7 7v10" />
    </svg>
  )
}

function IconKnowledge() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h4l2 2h6a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
    </svg>
  )
}

function IconDecisions() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3v14" />
      <path d="M3 10h14" />
      <circle cx="10" cy="10" r="7" />
    </svg>
  )
}

function IconSchedule() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14" />
      <path d="M7 2v4M13 2v4" />
    </svg>
  )
}

function IconPlugins() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v3M12 3v3" />
      <rect x="4" y="6" width="12" height="11" rx="2" />
      <path d="M8 17v-3h4v3" />
    </svg>
  )
}

function IconRuns() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h2l2-5 3 10 2-5h5" />
    </svg>
  )
}

function IconGraph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="5" r="2" />
      <circle cx="5" cy="14" r="2" />
      <circle cx="15" cy="14" r="2" />
      <path d="M10 7v3M8.5 11.5L6.5 12.5M11.5 11.5l2 1" />
    </svg>
  )
}

function IconAnalytics() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 16V10M10 16V6M15 16V3" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2M10 16v2M3.5 5.5l1.4 1.4M15.1 13.1l1.4 1.4M2 10h2M16 10h2M3.5 14.5l1.4-1.4M15.1 6.9l1.4-1.4" />
    </svg>
  )
}

/* ── Navigation item config ──────────────────────────────── */

const NAV_ITEMS = [
  { to: '/godmode', label: 'Godmode', icon: IconGodmode, simple: false },
  { to: '/', end: true, label: 'Home', icon: IconHome, simple: true },
  { to: '/crm', label: 'CRM Pipeline', icon: IconCrm, simple: false },
  { to: '/knowledge', label: 'Knowledge Base', icon: IconKnowledge, simple: false },
  { to: '/decisions', label: 'Decisions', icon: IconDecisions, simple: false },
  { to: '/approvals', label: 'Approvals', icon: IconSchedule, badge: true, simple: true },
  { to: '/schedule', label: 'Schedule', icon: IconSchedule, simple: true },
  { to: '/plugins', label: 'Plugins', icon: IconPlugins, simple: false },
  { to: '/runs', label: 'Run Timeline', icon: IconRuns, simple: true },
  { to: '/graph', label: 'Entity Graph', icon: IconGraph, simple: false },
  { to: '/crm/analytics', label: 'CRM Analytics', icon: IconAnalytics, simple: false },
] as const

/* ── App Shell (uses mode context) ───────────────────────── */

function AppShell() {
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [systemHealth, setSystemHealth] = useState<SystemHealth>('offline')
  const [systemLabel, setSystemLabel] = useState('Connecting...')
  const { mode, setMode } = useMode()
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSystemState = useCallback(() => {
    Promise.all([
      fetch('/api/health').then(r => r.json()).catch(() => null),
      fetch('/api/attention').then(r => r.json()).catch(() => null),
    ]).then(([healthData, attentionData]: [HealthData | null, AttentionSummary | null]) => {
      if (healthData) {
        setPendingApprovals(healthData.pendingApprovals ?? 0)
      }

      if (!attentionData) {
        setSystemHealth('offline')
        setSystemLabel('Offline')
        return
      }

      const status = attentionData.system_status
      if (status === 'needs_attention') {
        setSystemHealth('needs_attention')
        const attn = attentionData.needs_attention
        const parts: string[] = []
        if (attn.pending_approvals > 0) parts.push(`${attn.pending_approvals} approval${attn.pending_approvals !== 1 ? 's' : ''}`)
        if (attn.failed_runs > 0) parts.push(`${attn.failed_runs} failure${attn.failed_runs !== 1 ? 's' : ''}`)
        if (attn.overdue_schedules > 0) parts.push(`${attn.overdue_schedules} overdue`)
        setSystemLabel(parts.length > 0 ? parts.join(', ') : 'Needs attention')
      } else if (status === 'healthy') {
        setSystemHealth('healthy')
        setSystemLabel('Healthy')
      } else {
        setSystemHealth('offline')
        setSystemLabel('Offline')
      }
    })
  }, [])

  useEffect(() => {
    fetchSystemState()
    healthIntervalRef.current = setInterval(fetchSystemState, 15_000)
    return () => {
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current)
    }
  }, [fetchSystemState])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
      isActive
        ? 'bg-indigo-500/10 text-indigo-400 border-l-2 border-indigo-500 -ml-px'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
    }`

  const filteredNavItems = mode === 'simple'
    ? NAV_ITEMS.filter(item => item.simple)
    : NAV_ITEMS

  return (
    <div className="flex h-screen bg-[#030712] text-slate-100 overflow-hidden font-sans">
      {/* ── Sidebar ────────────────────────────────────── */}
      <aside className="w-60 shrink-0 bg-[#0f172a] border-r border-white/5 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5">
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-300 bg-clip-text text-transparent">
            Jarvis
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">Autonomous Agent System</p>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {filteredNavItems.map(item => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.end ?? false} className={navLinkClass}>
                <Icon />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && pendingApprovals > 0 && (
                  <span className="bg-amber-500/90 text-black text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {pendingApprovals}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom section */}
        <div className="px-4 py-4 border-t border-white/5">
          <NavLink
            to="/settings"
            className={navLinkClass}
          >
            <IconSettings />
            <span className="flex-1">Settings</span>
          </NavLink>
          {/* Mode toggle */}
          <button
            onClick={() => setMode(mode === 'simple' ? 'expert' : 'simple')}
            className="w-full text-xs text-slate-500 hover:text-slate-300 px-3 py-1.5 mt-2 rounded-md hover:bg-slate-800/50 transition-colors duration-200 text-left cursor-pointer"
          >
            {mode === 'simple' ? 'Expert mode' : 'Simple mode'}
          </button>
          {/* System status indicator */}
          <div className="flex items-center gap-2 px-3 py-2 mt-2">
            <span className="relative flex h-2 w-2 shrink-0">
              {systemHealth === 'healthy' && (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              )}
              {systemHealth === 'needs_attention' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </>
              )}
              {systemHealth === 'offline' && (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-600" />
              )}
            </span>
            <span className={`text-xs font-medium truncate ${
              systemHealth === 'healthy'
                ? 'text-emerald-400/80'
                : systemHealth === 'needs_attention'
                  ? 'text-amber-400/80'
                  : 'text-slate-600'
            }`}>
              {systemLabel}
            </span>
          </div>
          <div className="mt-2 px-1">
            <p className="text-xs text-slate-600 font-medium">Thinking in Code</p>
            <p className="text-[10px] text-slate-700 mt-0.5">Automotive Safety Consulting</p>
          </div>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-[#030712]">
        <Routes>
          <Route path="/godmode" element={<Godmode />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/" element={<Home />} />
          <Route path="/crm" element={<CrmPipeline />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/decisions" element={<Decisions />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/plugins" element={<Plugins />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/runs" element={<RunTimeline />} />
          <Route path="/graph" element={<EntityGraph />} />
          <Route path="/crm/analytics" element={<CrmAnalytics />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

/* ── App Component (wraps everything in providers) ──────── */

export default function App() {
  return (
    <BrowserRouter>
      <ModeProvider>
        <AppShell />
      </ModeProvider>
    </BrowserRouter>
  )
}
