import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

interface Run {
  run_id: string
  agent_id: string
  trigger: string
  status: string
  started_at: string
  completed_at?: string | null
  plan?: {
    steps?: Array<{
      action?: string
      reasoning?: string
      outcome?: string
      started_at?: string
      completed_at?: string
    }>
  } | null
  [key: string]: unknown
}

interface RunEvent {
  event_id: string
  event_type: string
  step_no: number | null
  action: string | null
  payload_json: string | null
  created_at: string
}

interface RunDetail extends Run {
  events?: RunEvent[]
  decisions?: Array<{
    decision_id: number
    agent_id: string
    step: string
    action: string
    reasoning: string
    outcome: string
    decided_at?: string
    created_at?: string
  }>
}

const AGENT_IDS = [
  'orchestrator', 'self-reflection', 'regulatory-watch', 'knowledge-curator',
  'proposal-engine', 'evidence-auditor', 'contract-reviewer', 'staffing-monitor',
]

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-900 text-green-400',
  running: 'bg-yellow-900 text-yellow-400',
  failed: 'bg-red-900 text-red-400',
  cancelled: 'bg-gray-800 text-gray-500',
  pending: 'bg-blue-900 text-blue-400',
}

const OUTCOME_COLORS: Record<string, string> = {
  approved: 'bg-green-900 text-green-400',
  completed: 'bg-green-900 text-green-400',
  success: 'bg-green-900 text-green-400',
  rejected: 'bg-red-900 text-red-400',
  failed: 'bg-red-900 text-red-400',
  error: 'bg-red-900 text-red-400',
  pending: 'bg-yellow-900 text-yellow-400',
  skipped: 'bg-gray-800 text-gray-500',
}

const PAGE_SIZE = 30

function formatDuration(start: string, end?: string | null): string {
  if (!end) return '--'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return '--'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  if (mins < 60) return `${mins}m ${remSecs}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

export default function RunTimeline() {
  const { runId: urlRunId } = useParams<{ runId?: string }>()
  const [searchParams] = useSearchParams()
  const [runs, setRuns] = useState<Run[]>([])
  const [selected, setSelected] = useState<RunDetail | null>(null)
  const [agentFilter, setAgentFilter] = useState(() => searchParams.get('agent') ?? 'all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchRuns = useCallback((agent: string, off: number) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE + 1),
      offset: String(off)
    })
    if (agent !== 'all') params.set('agent', agent)
    fetch(`/api/runs?${params}`)
      .then(r => r.json())
      .then((data: Run[]) => {
        setHasMore(data.length > PAGE_SIZE)
        setRuns(data.slice(0, PAGE_SIZE))
        setLoading(false)
      })
      .catch(() => { setRuns([]); setLoading(false) })
  }, [])

  useEffect(() => {
    setOffset(0)
    setSelected(null)
    fetchRuns(agentFilter, 0)
  }, [agentFilter, fetchRuns])

  useEffect(() => {
    if (urlRunId) {
      fetch(`/api/runs/${urlRunId}`)
        .then(r => r.json())
        .then((data: RunDetail) => setSelected(data))
        .catch(() => {})
    }
  }, [urlRunId])

  const handleSelectRun = (runId: string) => {
    fetch(`/api/runs/${runId}`)
      .then(r => r.json())
      .then((data: RunDetail) => setSelected(data))
      .catch(() => {})
  }

  const handlePrev = () => {
    const newOff = Math.max(0, offset - PAGE_SIZE)
    setOffset(newOff)
    fetchRuns(agentFilter, newOff)
  }

  const handleNext = () => {
    const newOff = offset + PAGE_SIZE
    setOffset(newOff)
    fetchRuns(agentFilter, newOff)
  }

  const filteredRuns = statusFilter === 'all'
    ? runs
    : runs.filter(r => r.status === statusFilter)

  // Detail view
  if (selected) {
    // Build timeline from run_events (step_started / step_completed pairs)
    const events = selected.events ?? []
    const stepMap = new Map<number, { action: string; started_at: string | null; completed_at: string | null; outcome: string }>()
    for (const ev of events) {
      if (ev.step_no == null || !ev.action) continue
      if (ev.event_type === 'step_started') {
        stepMap.set(ev.step_no, { action: ev.action, started_at: ev.created_at, completed_at: null, outcome: '' })
      } else if (ev.event_type === 'step_completed' || ev.event_type === 'step_failed') {
        const existing = stepMap.get(ev.step_no)
        if (existing) {
          existing.completed_at = ev.created_at
          existing.outcome = ev.event_type === 'step_completed' ? 'completed' : 'failed'
        } else {
          stepMap.set(ev.step_no, { action: ev.action, started_at: null, completed_at: ev.created_at, outcome: ev.event_type === 'step_completed' ? 'completed' : 'failed' })
        }
      }
    }
    const timeline = Array.from(stepMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([stepNo, s], i) => ({
        index: i,
        action: s.action,
        reasoning: '',
        outcome: s.outcome,
        started_at: s.started_at,
        completed_at: s.completed_at,
      }))

    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-4"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to runs
        </button>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">Run Detail</h1>
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <span className="text-indigo-400 font-medium">{selected.agent_id}</span>
            <span className="text-gray-600">|</span>
            <span>{selected.trigger ?? 'manual'}</span>
            <span className="text-gray-600">|</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[selected.status] ?? 'bg-gray-800 text-gray-500'}`}>
              {selected.status}
            </span>
            <span className="text-gray-600">|</span>
            <span>{formatDuration(selected.started_at, selected.completed_at)}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Started: {new Date(selected.started_at).toLocaleString()}
            {selected.completed_at && ` — Completed: ${new Date(selected.completed_at).toLocaleString()}`}
          </p>
        </div>

        {/* Vertical timeline */}
        {timeline.length === 0 ? (
          <div className="text-gray-600 text-sm">No steps recorded for this run.</div>
        ) : (
          <div className="relative pl-8">
            {/* Vertical line */}
            <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-800" />

            {timeline.map((step, i) => {
              const outcomeClass = step.outcome
                ? (OUTCOME_COLORS[String(step.outcome).toLowerCase()] ?? 'bg-gray-800 text-gray-500')
                : ''
              return (
                <div key={i} className="relative mb-6 last:mb-0">
                  {/* Dot on timeline */}
                  <div className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-gray-950" />

                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 font-mono">#{step.index + 1}</span>
                        <h3 className="text-sm font-medium text-white">{step.action}</h3>
                      </div>
                      {step.outcome && (
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${outcomeClass}`}>
                          {step.outcome}
                        </span>
                      )}
                    </div>
                    {step.reasoning && (
                      <p className="text-xs text-gray-400 mb-2">{step.reasoning}</p>
                    )}
                    {step.started_at && (
                      <p className="text-xs text-gray-600">
                        {new Date(step.started_at).toLocaleString()}
                        {step.completed_at && step.completed_at !== step.started_at && (
                          <span> — {formatDuration(step.started_at, step.completed_at)}</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // List view
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-white">Run Timeline</h1>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Agents</option>
            {AGENT_IDS.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : filteredRuns.length === 0 ? (
        <div className="text-gray-600 text-sm">No runs found.</div>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">Agent</th>
                  <th className="text-left px-4 py-3 font-medium">Trigger</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Steps</th>
                  <th className="text-left px-4 py-3 font-medium">Duration</th>
                  <th className="text-left px-4 py-3 font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredRuns.map(r => {
                  const stepCount = r.plan?.steps?.length ?? 0
                  const completedSteps = r.plan?.steps?.filter(s => s.outcome)?.length ?? 0
                  const statusClass = STATUS_COLORS[r.status] ?? 'bg-gray-800 text-gray-500'
                  return (
                    <tr
                      key={r.run_id}
                      onClick={() => handleSelectRun(r.run_id)}
                      className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <span className="text-xs text-indigo-400 font-medium">{r.agent_id}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {r.trigger ?? 'manual'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {stepCount > 0 ? `${completedSteps}/${stepCount}` : '--'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {formatDuration(r.started_at, r.completed_at)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(r.started_at).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>Showing {offset + 1}–{offset + filteredRuns.length}</span>
            <div className="flex gap-2">
              <button
                onClick={handlePrev}
                disabled={offset === 0}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs"
              >
                Previous
              </button>
              <button
                onClick={handleNext}
                disabled={!hasMore}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
