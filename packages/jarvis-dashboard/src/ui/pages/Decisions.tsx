import { useEffect, useState, useCallback, useRef } from 'react'

interface Decision {
  decision_id: number | string
  agent_id: string
  step: string
  action: string
  reasoning: string
  outcome: string
  decided_at?: string
  created_at?: string
  [key: string]: unknown
}

const AGENT_IDS = [
  'orchestrator', 'self-reflection', 'regulatory-watch', 'knowledge-curator',
  'proposal-engine', 'evidence-auditor', 'contract-reviewer', 'staffing-monitor',
]

const OUTCOME_COLORS: Record<string, string> = {
  approved: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  rejected: 'bg-red-500/10 text-red-400 border border-red-500/20',
  pending: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  skipped: 'bg-slate-500/10 text-slate-500 border border-slate-500/20',
  completed: 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
}

const PAGE_SIZE = 50
const POLL_INTERVAL = 10_000 // 10 seconds

export default function Decisions() {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [agentFilter, setAgentFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentFilterRef = useRef(agentFilter)
  const currentOffsetRef = useRef(offset)

  const fetchDecisions = useCallback((agent: string, off: number) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE + 1),
      offset: String(off)
    })
    if (agent !== 'all') params.set('agent', agent)
    fetch(`/api/agents/decisions?${params}`)
      .then(r => r.json())
      .then((data: Decision[]) => {
        setHasMore(data.length > PAGE_SIZE)
        setDecisions(data.slice(0, PAGE_SIZE))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Keep refs in sync for the polling callback
  useEffect(() => { currentFilterRef.current = agentFilter }, [agentFilter])
  useEffect(() => { currentOffsetRef.current = offset }, [offset])

  useEffect(() => {
    setOffset(0)
    fetchDecisions(agentFilter, 0)
  }, [agentFilter, fetchDecisions])

  // Auto-refresh polling every 10 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchDecisions(currentFilterRef.current, currentOffsetRef.current)
    }, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchDecisions])

  const handlePrev = () => {
    const newOffset = Math.max(0, offset - PAGE_SIZE)
    setOffset(newOffset)
    fetchDecisions(agentFilter, newOffset)
  }

  const handleNext = () => {
    const newOffset = offset + PAGE_SIZE
    setOffset(newOffset)
    fetchDecisions(agentFilter, newOffset)
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Decisions Log</h1>
          <p className="text-xs text-slate-500 mt-0.5">Audit trail of all agent decisions</p>
        </div>
        <div className="relative">
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="text-sm bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all duration-200 cursor-pointer appearance-none pr-8 min-h-[44px]"
          >
            <option value="all">All Agents</option>
            {AGENT_IDS.map(id => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          {/* Dropdown arrow */}
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-500 font-medium">Loading decisions...</span>
          </div>
        </div>
      ) : decisions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <svg className="text-slate-700 mb-3" width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="6" y="8" width="28" height="24" rx="3" />
            <path d="M6 16h28" />
            <path d="M14 8v-4M26 8v-4" />
          </svg>
          <p className="text-slate-500 text-sm font-medium">No decisions found.</p>
          <p className="text-slate-600 text-xs mt-1">Try changing the agent filter</p>
        </div>
      ) : (
        <>
          <div className="bg-slate-800/30 backdrop-blur-sm border border-white/5 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Time</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Agent</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Step</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Action</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Reasoning</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {decisions.map((d, idx) => {
                  const ts = d.decided_at ?? d.created_at
                  const outcomeClass = (d.outcome && OUTCOME_COLORS[String(d.outcome).toLowerCase()]) ?? 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
                  return (
                    <tr
                      key={d.decision_id}
                      className={`hover:bg-slate-800/40 transition-colors duration-150 ${
                        idx % 2 === 1 ? 'bg-slate-800/10' : ''
                      }`}
                    >
                      <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap font-mono tabular-nums">
                        {ts ? new Date(ts as string).toLocaleString() : '\u2014'}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs text-indigo-400 font-medium font-mono">{d.agent_id}</span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-400 max-w-24 truncate" title={String(d.step ?? '')}>
                        {d.step ?? '\u2014'}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-300 max-w-32 truncate" title={String(d.action ?? '')}>
                        {d.action ?? '\u2014'}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-500 max-w-xs leading-relaxed">
                        {d.reasoning
                          ? String(d.reasoning).slice(0, 80) + (String(d.reasoning).length > 80 ? '\u2026' : '')
                          : '\u2014'}
                      </td>
                      <td className="px-5 py-3.5">
                        {d.outcome && (
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${outcomeClass}`}>
                            {String(d.outcome)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ───────────────────────────────── */}
          <div className="flex items-center justify-between mt-5 text-sm">
            <span className="text-slate-500 text-xs font-mono tabular-nums">
              Showing {offset + 1}&ndash;{offset + decisions.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handlePrev}
                disabled={offset === 0}
                className="px-4 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 border border-white/5 hover:border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 text-xs font-medium cursor-pointer focus:ring-2 focus:ring-indigo-500/50 focus:outline-none min-h-[44px] flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3L4 7l4 4" />
                </svg>
                Previous
              </button>
              <button
                onClick={handleNext}
                disabled={!hasMore}
                className="px-4 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 border border-white/5 hover:border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 text-xs font-medium cursor-pointer focus:ring-2 focus:ring-indigo-500/50 focus:outline-none min-h-[44px] flex items-center gap-1.5"
              >
                Next
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3l4 4-4 4" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
