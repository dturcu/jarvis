import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import JarvisChat from '../components/JarvisChat.tsx'
import { useDashboardStore } from '../stores/dashboard-store.ts'
import { useApi } from '../hooks/useApi.ts'
import StatusBadge from '../shared/StatusBadge.tsx'
import DataCard from '../shared/DataCard.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import { IconWarning, IconError, IconClock, IconArrowRight } from '../shared/icons.tsx'
import type { WorkflowDefinition, AttentionActiveWork } from '../types/index.ts'
import { agentLabel, STATUS_LABELS, formatUptime, timeAgo } from '../types/index.ts'

export default function Home() {
  const { attention, daemon, safeMode, health } = useDashboardStore()
  const { data: workflows } = useApi<WorkflowDefinition[]>('/api/workflows')
  const [loading, setLoading] = useState(true)

  // Wait for first dashboard-store fetch
  useEffect(() => {
    if (attention !== null || daemon !== null) setLoading(false)
  }, [attention, daemon])

  if (loading && !attention && !daemon) {
    return <LoadingSpinner message="Loading dashboard..." />
  }

  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const needs = attention?.needs_attention
  const hasAttention = needs && (needs.pending_approvals > 0 || needs.failed_runs > 0 || needs.overdue_schedules > 0)
  const activeWork = attention?.active_work ?? []
  const completions = attention?.recent_completions ?? []
  const actions = attention?.recommended_actions ?? []
  const isSafeMode = safeMode?.safe_mode_recommended

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* ── System banner ──────────────────────────────── */}
      <div className="mb-6">
        {isSafeMode ? (
          <Link
            to="/recovery"
            className="block bg-red-500/5 border border-red-500/15 rounded-xl px-5 py-3 backdrop-blur-sm hover:border-red-500/30 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="text-sm text-red-300 font-medium">Safe mode recommended</span>
              </div>
              <span className="text-xs text-red-400/60">Open Recovery</span>
            </div>
            {safeMode?.reasons?.length ? (
              <p className="text-xs text-red-400/50 mt-1 ml-6">
                {safeMode.reasons.slice(0, 2).join(' · ')}
              </p>
            ) : null}
          </Link>
        ) : daemon?.running ? (
          <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl px-5 py-3 flex items-center justify-between backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <span className="text-sm text-emerald-300 font-medium">Daemon connected</span>
            </div>
            <div className="flex items-center gap-5 text-xs text-emerald-400/60 font-mono">
              <span>PID {daemon.pid}</span>
              <span>Uptime {formatUptime(daemon.uptime_seconds)}</span>
              <span>{daemon.agents_registered} agents</span>
              <span>{daemon.schedules_active} schedules</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-800/30 border border-white/5 rounded-xl px-5 py-3 flex items-center gap-3 backdrop-blur-sm">
            <span className="inline-flex rounded-full h-2.5 w-2.5 bg-slate-600" />
            <span className="text-sm text-slate-500 font-medium">Daemon offline</span>
            <span className="text-xs text-slate-600 font-mono ml-2">npm run daemon</span>
          </div>
        )}
      </div>

      {/* ── Header ─────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-100 tracking-tight">{greeting}</h1>
        <p className="text-sm text-slate-500 mt-1">{today}</p>
      </div>

      {/* ── Needs Attention ────────────────────────────── */}
      {hasAttention && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-200 tracking-tight mb-3">Needs Attention</h2>
          <div className="flex flex-wrap gap-3">
            {needs.pending_approvals > 0 && (
              <Link
                to="/inbox"
                className="inline-flex items-center gap-2 bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-2.5 backdrop-blur-sm hover:border-amber-500/30 transition-colors duration-200"
              >
                <span className="text-amber-400 shrink-0"><IconWarning /></span>
                <span className="text-amber-300/90 text-sm font-medium">
                  {needs.pending_approvals} pending approval{needs.pending_approvals !== 1 ? 's' : ''}
                </span>
                <span className="bg-amber-500/90 text-black text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {needs.pending_approvals}
                </span>
              </Link>
            )}
            {needs.failed_runs > 0 && (
              <Link
                to="/inbox?tab=Failures"
                className="inline-flex items-center gap-2 bg-red-500/5 border border-red-500/15 rounded-xl px-4 py-2.5 backdrop-blur-sm hover:border-red-500/30 transition-colors duration-200"
              >
                <span className="text-red-400 shrink-0"><IconError /></span>
                <span className="text-red-300/90 text-sm font-medium">
                  {needs.failed_runs} failed run{needs.failed_runs !== 1 ? 's' : ''}
                </span>
                <span className="bg-red-500/90 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {needs.failed_runs}
                </span>
              </Link>
            )}
            {needs.overdue_schedules > 0 && (
              <Link
                to="/system"
                className="inline-flex items-center gap-2 bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-2.5 backdrop-blur-sm hover:border-amber-500/30 transition-colors duration-200"
              >
                <span className="text-amber-400 shrink-0"><IconClock /></span>
                <span className="text-amber-300/90 text-sm font-medium">
                  {needs.overdue_schedules} overdue schedule{needs.overdue_schedules !== 1 ? 's' : ''}
                </span>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ── Active Work ────────────────────────────────── */}
      {activeWork.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-200 tracking-tight mb-3">Active Work</h2>
          <div className="space-y-2">
            {activeWork.map((work: AttentionActiveWork, i: number) => (
              <ActiveWorkRow key={`${work.agent_id}-${i}`} work={work} />
            ))}
          </div>
        </div>
      )}

      {/* ── Quick-Start Workflows ──────────────────────── */}
      {workflows && workflows.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-200 tracking-tight">Quick Start</h2>
            <Link to="/workflows" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              All workflows
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {workflows.slice(0, 5).map(wf => (
              <Link key={wf.workflow_id} to={`/workflows?start=${wf.workflow_id}`}>
                <DataCard className="h-full">
                  <h3 className="text-sm font-medium text-slate-200 mb-1">{wf.name}</h3>
                  <p className="text-xs text-slate-500 line-clamp-2">{wf.expected_output}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <SafetyPostureBadge rules={wf.safety_rules} />
                    {wf.safety_rules.preview_available && (
                      <span className="text-[10px] text-blue-400/60 bg-blue-500/10 border border-blue-500/15 px-1.5 py-0.5 rounded">
                        Preview
                      </span>
                    )}
                  </div>
                </DataCard>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Completions ─────────────────────────── */}
      {completions.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-200 tracking-tight">Recent Completions</h2>
            <Link to="/history" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {completions.slice(0, 5).map((comp, i) => (
              <div
                key={`${comp.agent_id}-${i}`}
                className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl px-5 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={comp.status} variant="dot" />
                  <span className="text-sm text-slate-200 font-medium">{agentLabel(comp.agent_id)}</span>
                  <StatusBadge status={comp.status} />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{timeAgo(comp.completed_at)}</span>
                  {comp.status === 'failed' && (
                    <Link to="/inbox?tab=Failures" className="text-xs text-red-400 hover:text-red-300 transition-colors">
                      View
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recommended Actions ────────────────────────── */}
      {actions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-200 tracking-tight mb-3">Recommended Actions</h2>
          <DataCard>
            <ul className="space-y-2">
              {actions.map((action, i) => {
                const lc = action.toLowerCase()
                const link = lc.includes('approval') ? '/inbox'
                  : lc.includes('failed') || lc.includes('retry') ? '/inbox?tab=Failures'
                  : lc.includes('schedule') || lc.includes('overdue') ? '/system'
                  : null
                return (
                  <li key={i} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <span className="text-indigo-400 shrink-0"><IconArrowRight /></span>
                    <span className="flex-1">{action}</span>
                    {link && (
                      <Link
                        to={link}
                        className="shrink-0 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full transition-colors duration-200"
                      >
                        Go
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </DataCard>
        </div>
      )}

      {/* ── Ask Jarvis ─────────────────────────────────── */}
      <div className="mb-10">
        <JarvisChat />
      </div>
    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────── */

function ActiveWorkRow({ work }: { work: AttentionActiveWork }) {
  const progress = work.total_steps > 0 ? Math.round((work.current_step / work.total_steps) * 100) : 0

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-amber-500/10 rounded-xl px-5 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
        </span>
        <span className="text-sm text-slate-200 font-medium">{agentLabel(work.agent_id)}</span>
        <StatusBadge status={work.status} />
      </div>
      <div className="flex items-center gap-3">
        {work.total_steps > 0 && (
          <>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              Step {work.current_step}/{work.total_steps}
            </span>
            <div className="w-24 bg-slate-900/80 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-500 to-amber-400 h-1.5 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.max(5, progress)}%` }}
              />
            </div>
            <span className="text-xs text-slate-600 font-mono tabular-nums">{progress}%</span>
          </>
        )}
      </div>
    </div>
  )
}

function SafetyPostureBadge({ rules }: { rules: WorkflowDefinition['safety_rules'] }) {
  const colors = {
    draft: 'text-emerald-400/60 bg-emerald-500/10 border-emerald-500/15',
    send: 'text-amber-400/60 bg-amber-500/10 border-amber-500/15',
    blocked: 'text-red-400/60 bg-red-500/10 border-red-500/15',
  }
  const labels = { draft: 'Draft', send: 'Live', blocked: 'Blocked' }

  return (
    <span className={`text-[10px] border px-1.5 py-0.5 rounded ${colors[rules.outbound_default]}`}>
      {labels[rules.outbound_default]}
    </span>
  )
}
