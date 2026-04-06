import { useEffect, useState, useCallback } from 'react'

interface LinkedRun {
  run_id: string
  agent_id: string
  status: string
  goal: string | null
  current_step: number | null
  total_steps: number | null
}

interface EnrichedApproval {
  id: string
  action: string
  agent: string
  severity: string
  status: string
  risk: { level: string; label: string; reversible: boolean } | null
  linked_run: LinkedRun | null
  timeout_at: string
  time_remaining_ms: number
  what_happens_if_nothing: string
}

function ApprovalCard({ approval, onResolve }: { approval: EnrichedApproval; onResolve: (id: string, action: 'approve' | 'reject') => void }) {
  const riskColors: Record<string, string> = { low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-red-400' }

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-200">{approval.action}</span>
        <span className={`text-xs ${riskColors[approval.risk?.level ?? ''] ?? 'text-slate-400'}`}>
          {approval.risk?.label ?? approval.severity}
        </span>
      </div>

      {approval.linked_run && (
        <p className="text-xs text-slate-400 mb-2">
          Run: {approval.linked_run.agent_id} — {approval.linked_run.goal ?? 'No goal'}
        </p>
      )}

      <p className="text-xs text-slate-500 mb-3">{approval.what_happens_if_nothing}</p>

      {approval.time_remaining_ms > 0 && approval.status === 'pending' && (
        <p className="text-xs text-amber-500 mb-3">
          Expires in {Math.ceil(approval.time_remaining_ms / 60000)} minutes
        </p>
      )}

      {approval.status === 'pending' ? (
        <div className="flex gap-2">
          <button onClick={() => onResolve(approval.id, 'approve')}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg transition-colors">
            Approve
          </button>
          <button onClick={() => onResolve(approval.id, 'reject')}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg transition-colors">
            Reject
          </button>
        </div>
      ) : (
        <span className={`text-xs font-medium ${approval.status === 'approved' ? 'text-emerald-400' : 'text-red-400'}`}>
          {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)}
        </span>
      )}
    </div>
  )
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<EnrichedApproval[]>([])
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  const fetchApprovals = useCallback(() => {
    fetch(`/api/approvals${filter === 'pending' ? '?status=pending' : ''}`)
      .then(r => r.json())
      .then(setApprovals)
      .catch(() => {})
  }, [filter])

  useEffect(() => {
    fetchApprovals()
    const id = setInterval(fetchApprovals, 10000)
    return () => clearInterval(id)
  }, [fetchApprovals])

  const resolve = useCallback(async (id: string, action: 'approve' | 'reject') => {
    await fetch(`/api/approvals/${id}/${action}`, { method: 'POST' })
    fetchApprovals()
  }, [fetchApprovals])

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-xs rounded-lg transition-colors ${
      active
        ? 'bg-indigo-500/20 text-indigo-400 font-medium'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
    }`

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Approvals</h1>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setFilter('pending')} className={tabClass(filter === 'pending')}>
          Pending
        </button>
        <button onClick={() => setFilter('all')} className={tabClass(filter === 'all')}>
          All
        </button>
      </div>

      {approvals.length === 0 ? (
        <p className="text-slate-500">No {filter} approvals</p>
      ) : (
        <div className="space-y-3">
          {approvals.map(a => <ApprovalCard key={a.id} approval={a} onResolve={resolve} />)}
        </div>
      )}
    </div>
  )
}
