import { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import AgentCard from '../components/AgentCard.tsx'
import JarvisChat from '../components/JarvisChat.tsx'

interface HealthData {
  ok: boolean
  crm: { contacts: number }
  knowledge: { documents: number; playbooks: number }
  decisions: { total: number }
  pendingApprovals: number
  telegramConfigured: boolean
}

interface AgentData {
  agentId: string
  label: string
  description: string
  schedule: string
  lastRun: string | null
  lastOutcome: string | null
}

interface DaemonCurrentRun {
  agent_id: string
  status: string
  step: number
  total_steps: number
  current_action: string
  started_at: string
}

interface DaemonLastRun {
  agent_id: string
  status: string
  completed_at: string
}

interface DaemonStatus {
  running: boolean
  pid: number | null
  uptime_seconds: number | null
  agents_registered: number
  schedules_active: number
  last_run: DaemonLastRun | null
  /** @deprecated Use active_runs instead */
  current_run: DaemonCurrentRun | null
  /** All currently executing agent runs (supports concurrent execution). */
  active_runs?: DaemonCurrentRun[]
}

/* ── Attention API types ─────────────────────────────────── */

interface AttentionNeedsAttention {
  pending_approvals: number
  failed_runs: number
  overdue_schedules: number
}

interface AttentionActiveWork {
  agent_id: string
  status: string
  current_step: number
  total_steps: number
}

interface AttentionRecentCompletion {
  agent_id: string
  status: string
  completed_at: string
}

interface AttentionData {
  needs_attention: AttentionNeedsAttention
  active_work: AttentionActiveWork[]
  recent_completions: AttentionRecentCompletion[]
  recommended_actions: string[]
  system_status: string // "healthy" | "needs_attention" | "unknown"
}

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '--'
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) return `${hours}h ${remMins}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const POLL_INTERVAL = 5_000 // 5 seconds
const ATTENTION_POLL_INTERVAL = 10_000 // 10 seconds

/* ── Stat Card Icons ─────────────────────────────────────── */

function IconContacts() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="8" r="3.5" />
      <path d="M4 19c0-3.3 3.1-6 7-6s7 2.7 7 6" />
    </svg>
  )
}

function IconDocuments() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h7l5 5v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path d="M13 3v5h5" />
    </svg>
  )
}

function IconPlaybooks() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a2 2 0 012-2h10a2 2 0 012 2v14l-7-3-7 3V5z" />
    </svg>
  )
}

function IconApprovals() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M8 11l2 2 4-4" />
    </svg>
  )
}

export default function Home() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [agents, setAgents] = useState<AgentData[]>([])
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null)
  const [attention, setAttention] = useState<AttentionData | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const attentionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(() => {
    Promise.all([
      fetch('/api/health').then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
      fetch('/api/daemon/status').then(r => r.json()),
    ]).then(([h, a, d]: [HealthData, AgentData[], DaemonStatus]) => {
      setHealth(h)
      setAgents(a)
      setDaemon(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const fetchAttention = useCallback(() => {
    fetch('/api/attention')
      .then(r => r.json())
      .then((data: AttentionData) => setAttention(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    // Initial fetch
    fetchData()
    fetchAttention()
    // Poll every 5 seconds for daemon/agents, every 10 seconds for attention
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL)
    attentionIntervalRef.current = setInterval(fetchAttention, ATTENTION_POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (attentionIntervalRef.current) clearInterval(attentionIntervalRef.current)
    }
  }, [fetchData, fetchAttention])

  const handleTrigger = async (agentId: string) => {
    await fetch(`/api/agents/${agentId}/trigger`, { method: 'POST' })
    setTimeout(fetchData, 500)
  }

  /** Compute the effective status for an agent based on daemon state.
   *  Checks active_runs (concurrent) first, falls back to current_run (legacy). */
  function getAgentStatus(agentId: string): 'ready' | 'running' | 'awaiting_approval' | 'error' {
    const runs = daemon?.active_runs?.length
      ? daemon.active_runs
      : daemon?.current_run ? [daemon.current_run] : []
    const run = runs.find(r => r.agent_id === agentId)
    if (!run) return 'ready'
    if (run.status === 'awaiting_approval') return 'awaiting_approval'
    return 'running'
  }

  function getAgentCurrentRun(agentId: string): DaemonCurrentRun | null {
    const runs = daemon?.active_runs?.length
      ? daemon.active_runs
      : daemon?.current_run ? [daemon.current_run] : []
    return runs.find(r => r.agent_id === agentId) ?? null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          <span className="text-sm text-slate-500 font-medium">Loading dashboard...</span>
        </div>
      </div>
    )
  }

  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const needsAttention = attention?.needs_attention
  const hasAttentionItems = needsAttention &&
    (needsAttention.pending_approvals > 0 ||
     needsAttention.failed_runs > 0 ||
     needsAttention.overdue_schedules > 0)

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* -- Daemon status banner -- */}
      <div className="mb-6">
        {daemon?.running ? (
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

      {/* -- Header -- */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-100 tracking-tight">{greeting}</h1>
        <p className="text-sm text-slate-500 mt-1">{today}</p>
      </div>

      {/* -- Needs Attention section -- */}
      {hasAttentionItems && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-200 tracking-tight mb-3">Needs Attention</h2>
          <div className="flex flex-wrap gap-3">
            {needsAttention.pending_approvals > 0 && (
              <Link
                to="/approvals"
                className="inline-flex items-center gap-2 bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-2.5 backdrop-blur-sm hover:border-amber-500/30 transition-colors duration-200"
              >
                <svg className="text-amber-400 shrink-0" width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <path d="M9 2L16.5 15H1.5L9 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M9 7v3M9 12v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span className="text-amber-300/90 text-sm font-medium">
                  {needsAttention.pending_approvals} pending approval{needsAttention.pending_approvals !== 1 ? 's' : ''}
                </span>
                <span className="bg-amber-500/90 text-black text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {needsAttention.pending_approvals}
                </span>
              </Link>
            )}
            {needsAttention.failed_runs > 0 && (
              <Link
                to="/runs"
                className="inline-flex items-center gap-2 bg-red-500/5 border border-red-500/15 rounded-xl px-4 py-2.5 backdrop-blur-sm hover:border-red-500/30 transition-colors duration-200"
              >
                <svg className="text-red-400 shrink-0" width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span className="text-red-300/90 text-sm font-medium">
                  {needsAttention.failed_runs} failed run{needsAttention.failed_runs !== 1 ? 's' : ''}
                </span>
                <span className="bg-red-500/90 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {needsAttention.failed_runs}
                </span>
              </Link>
            )}
            {needsAttention.overdue_schedules > 0 && (
              <Link
                to="/schedule"
                className="inline-flex items-center gap-2 bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-2.5 backdrop-blur-sm hover:border-amber-500/30 transition-colors duration-200"
              >
                <svg className="text-amber-400 shrink-0" width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-amber-300/90 text-sm font-medium">
                  {needsAttention.overdue_schedules} overdue schedule{needsAttention.overdue_schedules !== 1 ? 's' : ''}
                </span>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* -- Stats cards row -- */}
      {health && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Contacts */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl p-5 hover:border-white/10 transition-all duration-200 group">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-500 group-hover:text-slate-400 transition-colors duration-200">
                <IconContacts />
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{health.crm.contacts}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Contacts</p>
          </div>

          {/* Documents */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl p-5 hover:border-white/10 transition-all duration-200 group">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-500 group-hover:text-slate-400 transition-colors duration-200">
                <IconDocuments />
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{health.knowledge.documents}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Documents</p>
          </div>

          {/* Playbooks */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl p-5 hover:border-white/10 transition-all duration-200 group">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-500 group-hover:text-slate-400 transition-colors duration-200">
                <IconPlaybooks />
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{health.knowledge.playbooks}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Playbooks</p>
          </div>

          {/* Approvals */}
          <div className={`bg-slate-800/50 backdrop-blur-sm border rounded-xl p-5 transition-all duration-200 group ${
            health.pendingApprovals > 0
              ? 'border-amber-500/20 hover:border-amber-500/30'
              : 'border-white/5 hover:border-white/10'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`transition-colors duration-200 ${
                health.pendingApprovals > 0 ? 'text-amber-400' : 'text-slate-500 group-hover:text-slate-400'
              }`}>
                <IconApprovals />
              </span>
            </div>
            <p className={`text-2xl font-bold font-mono tabular-nums ${
              health.pendingApprovals > 0 ? 'text-amber-400' : 'text-slate-100'
            }`}>{health.pendingApprovals}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Pending Approvals</p>
          </div>
        </div>
      )}

      {/* -- Active Work section -- */}
      {attention && attention.active_work.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-200 tracking-tight mb-3">Active Work</h2>
          <div className="space-y-2">
            {attention.active_work.map((work, i) => (
              <div
                key={`${work.agent_id}-${i}`}
                className="bg-slate-800/50 backdrop-blur-sm border border-amber-500/10 rounded-xl px-5 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
                  </span>
                  <span className="text-sm text-slate-200 font-medium">{work.agent_id}</span>
                  <span className="text-xs text-amber-400/70 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                    {work.status}
                  </span>
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
                          style={{ width: `${Math.max(5, (work.current_step / work.total_steps) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 font-mono tabular-nums">
                        {Math.round((work.current_step / work.total_steps) * 100)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* -- Recent Completions section -- */}
      {attention && attention.recent_completions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-200 tracking-tight mb-3">Recent Completions</h2>
          <div className="space-y-2">
            {attention.recent_completions.slice(0, 5).map((comp, i) => {
              const statusColor = comp.status === 'completed'
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : comp.status === 'failed'
                  ? 'text-red-400 bg-red-500/10 border-red-500/20'
                  : 'text-slate-400 bg-slate-500/10 border-slate-500/20'
              return (
                <div
                  key={`${comp.agent_id}-${i}`}
                  className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl px-5 py-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex rounded-full h-2 w-2 ${
                      comp.status === 'completed' ? 'bg-emerald-500' : comp.status === 'failed' ? 'bg-red-500' : 'bg-slate-500'
                    }`} />
                    <span className="text-sm text-slate-200 font-medium">{comp.agent_id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor}`}>
                      {comp.status}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 font-mono">{timeAgo(comp.completed_at)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* -- Recommended Actions section -- */}
      {attention && attention.recommended_actions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-200 tracking-tight mb-3">Recommended Actions</h2>
          <div className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl p-5">
            <ul className="space-y-2">
              {attention.recommended_actions.map((action, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                  <svg className="text-indigo-400 shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {action}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* -- Ask Jarvis chat -- */}
      <div className="mb-10">
        <JarvisChat />
      </div>

      {/* -- Agent grid -- */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-200 tracking-tight">Agents</h2>
        <p className="text-xs text-slate-500 mt-0.5">Manage and monitor your autonomous agents</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {agents.map(agent => (
          <AgentCard
            key={agent.agentId}
            agentId={agent.agentId}
            label={agent.label}
            description={agent.description}
            schedule={agent.schedule}
            lastRun={agent.lastRun}
            lastOutcome={agent.lastOutcome}
            status={getAgentStatus(agent.agentId)}
            currentRun={getAgentCurrentRun(agent.agentId)}
            onTrigger={handleTrigger}
          />
        ))}
      </div>
    </div>
  )
}
