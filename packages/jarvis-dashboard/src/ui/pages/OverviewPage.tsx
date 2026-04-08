import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboardStore } from '../stores/dashboard-store.ts'
import { useApi } from '../hooks/useApi.ts'
import SectionCard from '../shared/SectionCard.tsx'
import StatusPill from '../shared/StatusPill.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import type { WorkflowDefinition, AttentionActiveWork, DaemonStatus, HealthData, SafeModeStatus } from '../types/index.ts'
import { agentLabel, formatUptime, timeAgo } from '../types/index.ts'

const AGENTS = [
  { id: 'orchestrator', short: 'ORCH' },
  { id: 'regulatory-watch', short: 'REG' },
  { id: 'knowledge-curator', short: 'KNOW' },
  { id: 'proposal-engine', short: 'PROP' },
  { id: 'evidence-auditor', short: 'EVID' },
  { id: 'contract-reviewer', short: 'CNTR' },
  { id: 'staffing-monitor', short: 'STFF' },
  { id: 'self-reflection', short: 'SELF' },
]

export default function OverviewPage() {
  const { attention, daemon, safeMode, health } = useDashboardStore()
  const { data: workflows } = useApi<WorkflowDefinition[]>('/api/workflows')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (attention !== null || daemon !== null) setLoading(false)
  }, [attention, daemon])

  if (loading && !attention && !daemon) {
    return <LoadingSpinner message="Loading..." />
  }

  const needs = attention?.needs_attention
  const hasAttention = needs && (needs.pending_approvals > 0 || needs.failed_runs > 0 || needs.overdue_schedules > 0)
  const activeWork = attention?.active_work ?? []
  const completions = attention?.recent_completions ?? []
  const isSafeMode = safeMode?.safe_mode_recommended

  return (
    <div className="p-6 max-w-[1400px]">
      {/* System strip */}
      <SystemStrip daemon={daemon} health={health} isSafeMode={isSafeMode} safeMode={safeMode} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mt-4">
        {/* Left — 3/5 */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {hasAttention && (
            <SectionCard title="Attention" accent="warn">
              <div className="flex flex-col gap-2">
                {needs.pending_approvals > 0 && (
                  <AttentionRow to="/inbox" label={`${needs.pending_approvals} pending approval${needs.pending_approvals !== 1 ? 's' : ''}`} severity="warn" count={needs.pending_approvals} />
                )}
                {needs.failed_runs > 0 && (
                  <AttentionRow to="/inbox?filter=failure" label={`${needs.failed_runs} failed run${needs.failed_runs !== 1 ? 's' : ''}`} severity="error" count={needs.failed_runs} />
                )}
                {needs.overdue_schedules > 0 && (
                  <AttentionRow to="/system" label={`${needs.overdue_schedules} overdue schedule${needs.overdue_schedules !== 1 ? 's' : ''}`} severity="warn" />
                )}
              </div>
            </SectionCard>
          )}

          <SectionCard
            title="Active operations"
            subtitle={activeWork.length > 0 ? `${activeWork.length} running` : undefined}
            accent={activeWork.length > 0 ? 'accent' : 'default'}
          >
            {activeWork.length > 0 ? (
              <div className="flex flex-col gap-2">
                {activeWork.map((work, i) => <ActiveRunRow key={`${work.agent_id}-${i}`} work={work} />)}
              </div>
            ) : (
              <p className="text-[12px] text-j-text-muted">No active operations</p>
            )}
          </SectionCard>

          <SectionCard title="Agents">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {AGENTS.map(agent => {
                const active = activeWork.find(w => w.agent_id === agent.id)
                const completed = completions.find(c => c.agent_id === agent.id)
                const status = active ? active.status : completed ? completed.status : 'idle'
                return (
                  <div key={agent.id} className="bg-j-surface border border-j-border p-3 flex flex-col gap-1.5 hover:border-j-border-active transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium font-mono text-j-text-muted tracking-wide">{agent.short}</span>
                      {status !== 'idle' && <StatusPill status={status} />}
                    </div>
                    <span className="text-[11px] text-j-text-secondary truncate">{agentLabel(agent.id)}</span>
                    {active && active.total_steps > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-j-base h-1 overflow-hidden">
                          <div className="bg-j-accent-dim h-1 transition-all duration-500"
                            style={{ width: `${Math.max(5, Math.round((active.current_step / active.total_steps) * 100))}%` }} />
                        </div>
                        <span className="text-[9px] font-mono text-j-text-muted">{active.current_step}/{active.total_steps}</span>
                      </div>
                    )}
                    {!active && completed && (
                      <span className="text-[10px] font-mono text-j-text-muted">{timeAgo(completed.completed_at)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </SectionCard>
        </div>

        {/* Right — 2/5 */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {workflows && workflows.length > 0 && (
            <SectionCard title="Quick actions"
              action={<Link to="/workflows" className="text-[10px] text-j-accent hover:text-j-text transition-colors">All workflows</Link>}>
              <div className="flex flex-col gap-1">
                {workflows.slice(0, 5).map(wf => (
                  <Link key={wf.workflow_id} to={`/workflows?start=${wf.workflow_id}`}
                    className="flex items-center justify-between px-3 py-2 hover:bg-j-hover transition-colors group">
                    <div className="min-w-0">
                      <span className="text-[12px] text-j-text group-hover:text-j-accent transition-colors truncate block">{wf.name}</span>
                      <span className="text-[10px] text-j-text-muted truncate block">{wf.expected_output}</span>
                    </div>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
                      className="shrink-0 text-j-text-muted group-hover:text-j-accent transition-colors ml-3" aria-hidden="true">
                      <path d="M3.5 1.5l3.5 3.5-3.5 3.5" />
                    </svg>
                  </Link>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard title="Recent activity"
            action={<Link to="/history" className="text-[10px] text-j-accent hover:text-j-text transition-colors">View all</Link>}>
            {completions.length > 0 ? (
              <div className="flex flex-col">
                {completions.slice(0, 8).map((comp, i) => (
                  <div key={`${comp.agent_id}-${i}`} className="flex items-center gap-3 py-2 border-b border-j-border last:border-0">
                    <StatusPill status={comp.status} variant="dot" />
                    <span className="text-[12px] text-j-text flex-1 truncate">{agentLabel(comp.agent_id)}</span>
                    <span className="text-[10px] font-mono text-j-text-muted shrink-0">{timeAgo(comp.completed_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-j-text-muted">No recent activity</p>
            )}
          </SectionCard>

          {health && (
            <SectionCard title="System" compact>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Contacts" value={health.crm?.contacts ?? 0} />
                <Metric label="Documents" value={health.knowledge?.documents ?? 0} />
                <Metric label="Playbooks" value={health.knowledge?.playbooks ?? 0} />
                <Metric label="Disk free" value={`${(health.disk_free_gb ?? 0).toFixed(1)} GB`} />
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ────────────────────────────────────────── */

function SystemStrip({ daemon, health, isSafeMode, safeMode }: {
  daemon: DaemonStatus | null; health: HealthData | null; isSafeMode: boolean | undefined; safeMode: SafeModeStatus | null
}) {
  if (isSafeMode) {
    return (
      <Link to="/recovery" className="block bg-red-500/4 border border-red-500/12 px-5 py-3 hover:border-red-500/25 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="size-1.5 rounded-full bg-red-500" />
            <span className="text-[12px] text-red-300 font-medium">Safe mode recommended</span>
          </div>
          <span className="text-[10px] text-red-400/50 font-mono">Recovery →</span>
        </div>
        {safeMode?.reasons?.length ? (
          <p className="text-[10px] text-red-400/40 mt-1 ml-4 font-mono">{safeMode.reasons.slice(0, 2).join(' · ')}</p>
        ) : null}
      </Link>
    )
  }

  return (
    <div className="bg-j-elevated border border-j-border px-5 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${daemon?.running ? 'bg-emerald-500' : 'bg-j-text-muted'}`} />
          <span className={`text-[11px] font-medium ${daemon?.running ? 'text-emerald-400/80' : 'text-j-text-muted'}`}>
            {daemon?.running ? 'Online' : 'Offline'}
          </span>
        </span>
        {daemon?.running && (
          <div className="flex items-center gap-3 text-[11px] font-mono text-j-text-secondary">
            <span>{formatUptime(daemon.uptime_seconds)}</span>
            <span className="text-j-text-muted">·</span>
            <span>{daemon.agents_registered} agents</span>
            <span className="text-j-text-muted">·</span>
            <span>{daemon.schedules_active} schedules</span>
          </div>
        )}
        {!daemon?.running && (
          <span className="text-[11px] text-j-text-muted font-mono">npm run daemon</span>
        )}
      </div>
      {health && (
        <div className="flex items-center gap-3 text-[10px] font-mono text-j-text-muted">
          <span>{health.crm?.contacts ?? 0} contacts</span>
          <span>{health.knowledge?.documents ?? 0} docs</span>
        </div>
      )}
    </div>
  )
}

function AttentionRow({ to, label, severity, count }: {
  to: string; label: string; severity: 'warn' | 'error'; count?: number
}) {
  return (
    <Link to={to} className="flex items-center gap-3 py-2 px-3 bg-j-surface border border-j-border hover:border-j-border-active transition-colors">
      <span className={`size-1.5 rounded-full shrink-0 ${severity === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} />
      <span className="text-[12px] text-j-text flex-1">{label}</span>
      {count !== undefined && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none ${
          severity === 'error' ? 'bg-red-500/80 text-white' : 'bg-amber-500/80 text-black'
        }`}>{count}</span>
      )}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-j-text-muted" aria-hidden="true">
        <path d="M3.5 1.5l3.5 3.5-3.5 3.5" />
      </svg>
    </Link>
  )
}

function ActiveRunRow({ work }: { work: AttentionActiveWork }) {
  const progress = work.total_steps > 0 ? Math.round((work.current_step / work.total_steps) * 100) : 0
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-j-surface border border-j-border">
      <span className="size-1.5 rounded-full bg-j-accent shrink-0" />
      <span className="text-[12px] text-j-text flex-1 truncate">{agentLabel(work.agent_id)}</span>
      <StatusPill status={work.status} />
      {work.total_steps > 0 && (
        <div className="flex items-center gap-2">
          <div className="w-16 bg-j-base h-1 overflow-hidden">
            <div className="bg-j-accent-dim h-1 transition-all duration-500" style={{ width: `${Math.max(5, progress)}%` }} />
          </div>
          <span className="text-[10px] font-mono text-j-text-muted tabular-nums w-7 text-right">{progress}%</span>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-j-text-muted uppercase tracking-wider">{label}</span>
      <span className="text-[15px] font-medium text-j-text font-mono tabular-nums">{value}</span>
    </div>
  )
}
