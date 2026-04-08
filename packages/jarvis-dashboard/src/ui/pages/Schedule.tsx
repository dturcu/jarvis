import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../shared/PageHeader.tsx'
import DataCard from '../shared/DataCard.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import { useDashboardStore } from '../stores/dashboard-store.ts'
import { timeAgo, agentLabel } from '../types/index.ts'

interface ScheduledTask {
  id: string
  agentId: string
  label: string
  cron: string
  humanSchedule: string
  enabled: boolean
  lastRun?: { status: string; completed_at: string } | null
}

// ── Cron helpers ────────────────────────────────────────────

function cronToHuman(cron: string): string {
  const [minute, hour, , , dow] = cron.split(' ')
  const h = parseInt(hour, 10)
  const m = parseInt(minute, 10)
  const time = `${h > 12 ? h - 12 : h}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`

  if (dow === '*') return `Daily at ${time}`
  if (dow === '1-5') return `Weekdays at ${time}`
  const dayNames: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' }
  const days = dow.split(',').map(d => dayNames[d] ?? d).join(', ')
  return `${days} at ${time}`
}

function nextFireTime(cron: string): string {
  const now = new Date()
  const [minute, hour, , , dowField] = cron.split(' ')
  const h = parseInt(hour, 10)
  const m = parseInt(minute, 10)

  const targetDays: number[] = dowField === '*'
    ? [0, 1, 2, 3, 4, 5, 6]
    : dowField === '1-5'
    ? [1, 2, 3, 4, 5]
    : dowField.split(',').map(Number)

  const candidate = new Date(now)
  candidate.setHours(h, m, 0, 0)
  for (let i = 0; i < 8; i++) {
    if (targetDays.includes(candidate.getDay()) && candidate > now) {
      return candidate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    }
    candidate.setDate(candidate.getDate() + 1)
    candidate.setHours(h, m, 0, 0)
  }
  return 'Unknown'
}

// ── Static task definitions ─────────────────────────────────

const TASK_DEFS = [
  { id: 'jarvis-evidence-auditor', agentId: 'evidence-auditor', label: 'Evidence Auditor', cron: '0 9 * * 1', description: 'Audit project evidence against ISO 26262 and ASPICE baselines' },
  { id: 'jarvis-staffing-monitor', agentId: 'staffing-monitor', label: 'Staffing Monitor', cron: '0 9 * * 1', description: 'Track utilization, forecast gaps, match skills to pipeline' },
  { id: 'jarvis-regulatory-mon', agentId: 'regulatory-watch', label: 'Regulatory Watch (Mon)', cron: '0 7 * * 1', description: 'Track regulatory and standards changes' },
  { id: 'jarvis-regulatory-thu', agentId: 'regulatory-watch', label: 'Regulatory Watch (Thu)', cron: '0 7 * * 4', description: 'Track regulatory and standards changes' },
  { id: 'jarvis-knowledge-curator', agentId: 'knowledge-curator', label: 'Knowledge Curator', cron: '0 6 * * 1-5', description: 'Ingest documents, resolve entities, monitor collection health' },
  { id: 'jarvis-self-reflection', agentId: 'self-reflection', label: 'Self-Reflection', cron: '0 6 * * 0', description: 'Weekly system health analysis and improvement proposals' },
]

export default function Schedule() {
  const { daemon } = useDashboardStore()
  const [agents, setAgents] = useState<Array<{ id: string; enabled: boolean }>>([])
  const [triggering, setTriggering] = useState<string | null>(null)
  const [triggered, setTriggered] = useState<Set<string>>(new Set())
  const [lastRuns, setLastRuns] = useState<Record<string, { status: string; completed_at: string }>>({})
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(() => {
    Promise.all([
      fetch('/api/settings/agents').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/runs?limit=50').then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([agentList, runs]) => {
      setAgents(agentList)
      // Build last-run map per agent
      const runMap: Record<string, { status: string; completed_at: string }> = {}
      for (const run of (runs as Array<{ agent_id: string; status: string; completed_at?: string; started_at: string }>)) {
        if (!runMap[run.agent_id] && (run.status === 'completed' || run.status === 'failed')) {
          runMap[run.agent_id] = { status: run.status, completed_at: run.completed_at ?? run.started_at }
        }
      }
      setLastRuns(runMap)
      setLoading(false)
    })
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleToggle = async (agentId: string, enabled: boolean) => {
    await fetch(`/api/settings/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, enabled } : a))
  }

  const handleRunNow = async (task: typeof TASK_DEFS[0]) => {
    setTriggering(task.id)
    try {
      await fetch(`/api/agents/${task.agentId}/trigger`, { method: 'POST' })
      setTriggered(prev => new Set([...prev, task.id]))
      setTimeout(() => {
        setTriggered(prev => { const n = new Set(prev); n.delete(task.id); return n })
      }, 3000)
    } finally {
      setTriggering(null)
    }
  }

  if (loading) return <LoadingSpinner message="Loading schedules..." />

  const activeRuns = daemon?.active_runs ?? (daemon?.current_run ? [daemon.current_run] : [])
  const enabledCount = TASK_DEFS.filter(t => agents.find(a => a.id === t.agentId)?.enabled !== false).length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Scheduled Tasks"
        subtitle={`${enabledCount} of ${TASK_DEFS.length} tasks active`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              status={daemon?.running ? 'healthy' : 'offline'}
              label={daemon?.running ? 'Daemon running' : 'Daemon offline'}
              variant="dot"
              pulse={daemon?.running}
            />
          </div>
        }
      />

      <div className="space-y-3">
        {TASK_DEFS.map(task => {
          const agentEnabled = agents.find(a => a.id === task.agentId)?.enabled !== false
          const isTriggering = triggering === task.id
          const wasTriggered = triggered.has(task.id)
          const isRunning = activeRuns.some(r => r.agent_id === task.agentId)
          const lastRun = lastRuns[task.agentId]

          return (
            <DataCard
              key={task.id}
              variant={isRunning ? 'warning' : !agentEnabled ? 'default' : 'default'}
            >
              <div className="flex items-start gap-4">
                {/* Left: info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex rounded-full h-2 w-2 shrink-0 ${
                      isRunning ? 'bg-amber-400' : agentEnabled ? 'bg-emerald-500' : 'bg-slate-600'
                    }`} />
                    <h3 className={`text-sm font-medium ${agentEnabled ? 'text-white' : 'text-slate-500'}`}>
                      {task.label}
                    </h3>
                    {isRunning && <StatusBadge status="running" label="Running" size="sm" />}
                    {!agentEnabled && <StatusBadge status="cancelled" label="Paused" size="sm" />}
                  </div>

                  <p className="text-xs text-slate-500 mb-2">{task.description}</p>

                  {/* Schedule + next fire */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                    <span className="text-slate-500">
                      <span className="text-slate-400">Schedule:</span> {cronToHuman(task.cron)}
                    </span>
                    {agentEnabled && (
                      <span className="text-slate-600">
                        Next: <span className="text-slate-400">{nextFireTime(task.cron)}</span>
                      </span>
                    )}
                  </div>

                  {/* Last run */}
                  {lastRun && (
                    <div className="flex items-center gap-2 mt-2 text-[11px]">
                      <span className="text-slate-600">Last run:</span>
                      <StatusBadge status={lastRun.status} size="sm" />
                      <span className="text-slate-600">{timeAgo(lastRun.completed_at)}</span>
                    </div>
                  )}

                  {/* Links */}
                  <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-white/5">
                    <Link
                      to={`/history?agent=${task.agentId}`}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      View history
                    </Link>
                    <Link
                      to={`/runs?agent=${task.agentId}`}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      View runs
                    </Link>
                  </div>
                </div>

                {/* Right: controls */}
                <div className="shrink-0 flex flex-col items-end gap-3">
                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => handleToggle(task.agentId, !agentEnabled)}
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                      agentEnabled ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                    title={agentEnabled ? 'Pause this task' : 'Enable this task'}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      agentEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>

                  {/* Run Now button */}
                  <button
                    onClick={() => handleRunNow(task)}
                    disabled={isTriggering || wasTriggered || isRunning || !agentEnabled}
                    className={`text-xs px-3.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                      wasTriggered
                        ? 'bg-emerald-900/50 text-emerald-400'
                        : isRunning
                        ? 'bg-amber-900/50 text-amber-400 cursor-not-allowed'
                        : !agentEnabled
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
                    }`}
                  >
                    {isTriggering ? 'Triggering...' : wasTriggered ? 'Triggered' : isRunning ? 'Running...' : 'Run Now'}
                  </button>
                </div>
              </div>
            </DataCard>
          )
        })}
      </div>
    </div>
  )
}
