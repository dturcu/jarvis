import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import Home from './pages/Home.tsx'
import Workflows from './pages/Workflows.tsx'
import Inbox from './pages/Inbox.tsx'
import History from './pages/History.tsx'
import System from './pages/System.tsx'
import Settings from './pages/Settings.tsx'
import Recovery from './pages/Recovery.tsx'
import Runs from './pages/Runs.tsx'
import Models from './pages/Models.tsx'
import Queue from './pages/Queue.tsx'
import Support from './pages/Support.tsx'
import Godmode from './pages/Godmode.tsx'
import CrmPipeline from './pages/CrmPipeline.tsx'
import CrmAnalytics from './pages/CrmAnalytics.tsx'
import KnowledgeBase from './pages/KnowledgeBase.tsx'
import Decisions from './pages/Decisions.tsx'
import Schedule from './pages/Schedule.tsx'
import Plugins from './pages/Plugins.tsx'
import Portal from './pages/Portal.tsx'
import EntityGraph from './pages/EntityGraph.tsx'
import { ModeProvider, useMode } from './context/ModeContext.tsx'
import { useDashboardStore } from './stores/dashboard-store.ts'
import {
  IconHome, IconWorkflow, IconInbox, IconHistory, IconSystem, IconSettings,
  IconRecovery, IconGodmode, IconRuns, IconModels, IconQueue, IconSupport,
  IconCrm, IconKnowledge, IconDecisions, IconSchedule, IconPlugins, IconGraph, IconAnalytics,
} from './shared/icons.tsx'

/* ── Navigation configuration ────────────────────────────── */

interface NavItem {
  to: string
  label: string
  icon: () => React.JSX.Element
  simple: boolean
  badge?: boolean
  end?: boolean
  section?: 'main' | 'expert' | 'legacy'
}

const NAV_ITEMS: NavItem[] = [
  // Simple mode — core operating loop
  { to: '/', label: 'Home', icon: IconHome, simple: true, end: true, section: 'main' },
  { to: '/workflows', label: 'Workflows', icon: IconWorkflow, simple: true, section: 'main' },
  { to: '/inbox', label: 'Inbox', icon: IconInbox, simple: true, badge: true, section: 'main' },
  { to: '/history', label: 'History', icon: IconHistory, simple: true, section: 'main' },
  { to: '/system', label: 'System', icon: IconSystem, simple: true, section: 'main' },

  // Expert mode — deeper visibility
  { to: '/godmode', label: 'Godmode', icon: IconGodmode, simple: false, section: 'expert' },
  { to: '/runs', label: 'Runs', icon: IconRuns, simple: false, section: 'expert' },
  { to: '/models', label: 'Models', icon: IconModels, simple: false, section: 'expert' },
  { to: '/queue', label: 'Queue', icon: IconQueue, simple: false, section: 'expert' },
  { to: '/support', label: 'Support', icon: IconSupport, simple: false, section: 'expert' },

  // Expert — legacy pages moved from simple mode
  { to: '/crm', label: 'CRM Pipeline', icon: IconCrm, simple: false, section: 'legacy' },
  { to: '/crm/analytics', label: 'CRM Analytics', icon: IconAnalytics, simple: false, section: 'legacy' },
  { to: '/knowledge', label: 'Knowledge Base', icon: IconKnowledge, simple: false, section: 'legacy' },
  { to: '/decisions', label: 'Decisions', icon: IconDecisions, simple: false, section: 'legacy' },
  { to: '/schedule', label: 'Schedule', icon: IconSchedule, simple: false, section: 'legacy' },
  { to: '/plugins', label: 'Plugins', icon: IconPlugins, simple: false, section: 'legacy' },
  { to: '/graph', label: 'Entity Graph', icon: IconGraph, simple: false, section: 'legacy' },
]

/* ── App Shell ───────────────────────────────────────────── */

function AppShell() {
  const { mode, setMode } = useMode()
  const { systemHealth, pendingApprovals, safeMode, startPolling, stopPolling } = useDashboardStore()

  useEffect(() => {
    startPolling(10_000)
    return stopPolling
  }, [startPolling, stopPolling])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
      isActive
        ? 'bg-indigo-500/10 text-indigo-400 border-l-2 border-indigo-500 -ml-px'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
    }`

  // Filter nav items by mode
  const visibleItems = mode === 'simple'
    ? NAV_ITEMS.filter(item => item.simple)
    : NAV_ITEMS

  // Group expert items for visual separation
  const mainItems = visibleItems.filter(i => i.section === 'main')
  const expertItems = visibleItems.filter(i => i.section === 'expert')
  const legacyItems = visibleItems.filter(i => i.section === 'legacy')

  const showRecovery = safeMode?.safe_mode_recommended

  // System health label
  const healthLabel = systemHealth === 'healthy'
    ? 'Healthy'
    : systemHealth === 'needs_attention'
      ? `${pendingApprovals > 0 ? `${pendingApprovals} approval${pendingApprovals !== 1 ? 's' : ''}` : 'Needs attention'}`
      : 'Offline'

  return (
    <div className="flex h-screen bg-[#030712] text-slate-100 overflow-hidden font-sans">
      {/* ── Sidebar ──────────────────────────────────────── */}
      <aside className="w-60 shrink-0 bg-[#0f172a] border-r border-white/5 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5">
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-300 bg-clip-text text-transparent">
            Jarvis
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">Operations Console</p>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {/* Main operating loop */}
          {mainItems.map(item => {
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

          {/* Recovery — shown when safe mode is active */}
          {showRecovery && (
            <NavLink to="/recovery" className={navLinkClass}>
              <IconRecovery />
              <span className="flex-1 truncate">Recovery</span>
              <span className="bg-red-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">!</span>
            </NavLink>
          )}

          {/* Expert mode sections */}
          {expertItems.length > 0 && (
            <>
              <div className="pt-4 pb-1 px-3">
                <span className="text-[10px] text-slate-600 uppercase tracking-wider font-medium">Expert</span>
              </div>
              {expertItems.map(item => {
                const Icon = item.icon
                return (
                  <NavLink key={item.to} to={item.to} end={item.end ?? false} className={navLinkClass}>
                    <Icon />
                    <span className="flex-1 truncate">{item.label}</span>
                  </NavLink>
                )
              })}
            </>
          )}

          {legacyItems.length > 0 && (
            <>
              <div className="pt-4 pb-1 px-3">
                <span className="text-[10px] text-slate-600 uppercase tracking-wider font-medium">Data</span>
              </div>
              {legacyItems.map(item => {
                const Icon = item.icon
                return (
                  <NavLink key={item.to} to={item.to} end={item.end ?? false} className={navLinkClass}>
                    <Icon />
                    <span className="flex-1 truncate">{item.label}</span>
                  </NavLink>
                )
              })}
            </>
          )}
        </nav>

        {/* Bottom section */}
        <div className="px-4 py-4 border-t border-white/5">
          <NavLink to="/settings" className={navLinkClass}>
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
              {healthLabel}
            </span>
          </div>
          <div className="mt-2 px-1">
            <p className="text-xs text-slate-600 font-medium">Thinking in Code</p>
            <p className="text-[10px] text-slate-700 mt-0.5">Automotive Safety Consulting</p>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-[#030712]">
        <Routes>
          {/* Core operating loop */}
          <Route path="/" element={<Home />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/history" element={<History />} />
          <Route path="/system" element={<System />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/recovery" element={<Recovery />} />

          {/* Expert pages */}
          <Route path="/godmode" element={<Godmode />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/models" element={<Models />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/support" element={<Support />} />

          {/* Legacy/Data pages (expert mode) */}
          <Route path="/crm" element={<CrmPipeline />} />
          <Route path="/crm/analytics" element={<CrmAnalytics />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/decisions" element={<Decisions />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/plugins" element={<Plugins />} />
          <Route path="/graph" element={<EntityGraph />} />
          <Route path="/portal" element={<Portal />} />

          {/* Redirects for old routes */}
          <Route path="/approvals" element={<Navigate to="/inbox" replace />} />
        </Routes>
      </main>
    </div>
  )
}

/* ── App Component ───────────────────────────────────────── */

export default function App() {
  return (
    <BrowserRouter>
      <ModeProvider>
        <AppShell />
      </ModeProvider>
    </BrowserRouter>
  )
}
