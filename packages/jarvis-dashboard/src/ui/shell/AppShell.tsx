import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import SideNav from './SideNav.tsx'
import TopBar from './TopBar.tsx'
import AssistantRail from './AssistantRail.tsx'
import { useDashboardStore } from '../stores/dashboard-store.ts'

/* ── Pages ─────────────────────────────────────────────────── */
import OverviewPage from '../pages/OverviewPage.tsx'
import Workflows from '../pages/Workflows.tsx'
import Inbox from '../pages/Inbox.tsx'
import History from '../pages/History.tsx'
import System from '../pages/System.tsx'
import Settings from '../pages/Settings.tsx'
import Recovery from '../pages/Recovery.tsx'
import Runs from '../pages/Runs.tsx'
import Models from '../pages/Models.tsx'
import Queue from '../pages/Queue.tsx'
import Support from '../pages/Support.tsx'
import Godmode from '../pages/Godmode.tsx'
import CrmPipeline from '../pages/CrmPipeline.tsx'
import CrmAnalytics from '../pages/CrmAnalytics.tsx'
import KnowledgeBase from '../pages/KnowledgeBase.tsx'
import Decisions from '../pages/Decisions.tsx'
import Schedule from '../pages/Schedule.tsx'
import Plugins from '../pages/Plugins.tsx'
import Portal from '../pages/Portal.tsx'
import EntityGraph from '../pages/EntityGraph.tsx'

/* ── Shell ─────────────────────────────────────────────────── */

export default function AppShell() {
  const { startPolling, stopPolling } = useDashboardStore()
  const [assistantOpen, setAssistantOpen] = useState(false)

  useEffect(() => {
    startPolling(10_000)
    return stopPolling
  }, [startPolling, stopPolling])

  return (
    <div className="flex h-screen bg-j-base text-j-text overflow-hidden font-sans">
      <SideNav />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          onToggleAssistant={() => setAssistantOpen(prev => !prev)}
          assistantOpen={assistantOpen}
        />

        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto" aria-label="Page content">
            <Routes>
              {/* Primary */}
              <Route path="/" element={<OverviewPage />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/history" element={<History />} />
              <Route path="/knowledge" element={<KnowledgeBase />} />
              <Route path="/graph" element={<EntityGraph />} />
              <Route path="/decisions" element={<Decisions />} />
              <Route path="/crm" element={<CrmPipeline />} />
              <Route path="/crm/analytics" element={<CrmAnalytics />} />
              <Route path="/system" element={<System />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/recovery" element={<Recovery />} />

              {/* Advanced */}
              <Route path="/godmode" element={<Godmode />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/models" element={<Models />} />
              <Route path="/queue" element={<Queue />} />
              <Route path="/support" element={<Support />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/plugins" element={<Plugins />} />
              <Route path="/portal" element={<Portal />} />

              {/* Redirects */}
              <Route path="/approvals" element={<Navigate to="/inbox" replace />} />
            </Routes>
          </main>

          <AssistantRail open={assistantOpen} onClose={() => setAssistantOpen(false)} />
        </div>
      </div>
    </div>
  )
}
