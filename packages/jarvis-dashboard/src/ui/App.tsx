import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
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

interface HealthData {
  pendingApprovals?: number
}

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
  { to: '/godmode', label: 'Godmode', icon: IconGodmode },
  { to: '/', end: true, label: 'Home', icon: IconHome },
  { to: '/crm', label: 'CRM Pipeline', icon: IconCrm },
  { to: '/knowledge', label: 'Knowledge Base', icon: IconKnowledge },
  { to: '/decisions', label: 'Decisions', icon: IconDecisions },
  { to: '/schedule', label: 'Schedule', icon: IconSchedule, badge: true },
  { to: '/plugins', label: 'Plugins', icon: IconPlugins },
  { to: '/runs', label: 'Run Timeline', icon: IconRuns },
  { to: '/graph', label: 'Entity Graph', icon: IconGraph },
  { to: '/crm/analytics', label: 'CRM Analytics', icon: IconAnalytics },
] as const

/* ── App Component ───────────────────────────────────────── */

export default function App() {
  const [pendingApprovals, setPendingApprovals] = useState(0)

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then((data: HealthData) => setPendingApprovals(data.pendingApprovals ?? 0))
      .catch(() => {})
  }, [])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
      isActive
        ? 'bg-indigo-500/10 text-indigo-400 border-l-2 border-indigo-500 -ml-px'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
    }`

  return (
    <BrowserRouter>
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
            {NAV_ITEMS.map(item => {
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
            <div className="mt-3 px-1">
              <p className="text-xs text-slate-600 font-medium">Thinking in Code</p>
              <p className="text-[10px] text-slate-700 mt-0.5">Automotive Safety Consulting</p>
            </div>
          </div>
        </aside>

        {/* ── Main content ───────────────────────────────── */}
        <main className="flex-1 overflow-y-auto bg-[#030712]">
          <Routes>
            <Route path="/godmode" element={<Godmode />} />
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
    </BrowserRouter>
  )
}
