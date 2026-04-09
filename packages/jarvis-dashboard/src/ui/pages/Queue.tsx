import { useState, useCallback } from 'react'
import { usePolling } from '../hooks/usePolling.ts'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import PageHeader from '../shared/PageHeader.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { timeAgo, formatDuration, agentLabel } from '../types/index.ts'

/* ── Page-local types ────────────────────────────────────── */

interface QueueCommand {
  command_id: string
  command_type: string
  target_agent_id: string
  status: string
  priority: number
  created_at: string
  created_by?: string
  claimed_at?: string
}

interface HistoryCommand extends QueueCommand {
  completed_at?: string | null
  run_id?: string
  goal?: string
  error?: string
  current_step?: number
  total_steps?: number
  run_started_at?: string
  run_completed_at?: string | null
}

/* ── Priority helpers ────────────────────────────────────── */

const PRIORITY_LABELS: Record<number, string> = { 0: 'Low', 1: 'Normal', 2: 'High', 3: 'Critical' }
const PRIORITY_COLORS: Record<number, string> = { 0: 'text-slate-500', 1: 'text-slate-300', 2: 'text-amber-400', 3: 'text-red-400' }

function priorityLabel(p: number): string { return PRIORITY_LABELS[p] ?? `P${p}` }
function truncateId(id: string): string { return id.length > 12 ? `${id.slice(0, 8)} …` : id }

/* ── Main Component ──────────────────────────────────────── */

type TabId = 'active' | 'history'

export default function Queue() {
  const [tab, setTab] = useState<TabId>('active')
  const { data, loading } = usePolling<QueueCommand[]>('/api/queue', 5000)
  const { data: history, loading: historyLoading, refetch: refetchHistory } = useApi<HistoryCommand[]>('/api/queue/history?limit=50')
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [cancelAllOpen, setCancelAllOpen] = useState(false)

  const commands = data ?? []

  const handleCancel = useCallback(async (commandId: string) => {
    await apiFetch(`/api/queue/${commandId}`, { body: { status: 'cancelled' }, method: 'PATCH' })
    setCancelTarget(null)
  }, [])

  const handleCancelAll = useCallback(async () => {
    await apiFetch('/api/queue/all', { method: 'DELETE' })
    setCancelAllOpen(false)
  }, [])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Command Queue"
        subtitle="Pending, active, and completed commands"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-mono">Auto-refresh 5s</span>
            {!loading && (
              <StatusBadge
                status={commands.length > 0 ? 'pending' : 'ok'}
                label={`${commands.length} active`}
                size="sm"
              />
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-5">
        <TabButton active={tab === 'active'} onClick={() => setTab('active')} count={commands.length}>
          Active Queue
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => { setTab('history'); refetchHistory() }} count={history?.length}>
          History
        </TabButton>
      </div>

      {tab === 'active' && (
        <>
          {loading && !data ? (
            <LoadingSpinner message="Loading command queue..." />
          ) : commands.length === 0 ? (
            <EmptyState
              title="Queue is empty"
              subtitle="No pending commands. Commands appear here when agents or workflows enqueue work."
            />
          ) : (
            <>
              {commands.length > 1 && (
                <div className="flex justify-end mb-3">
                  <button
                    onClick={() => setCancelAllOpen(true)}
                    className="text-[11px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 px-3 py-1 rounded-lg transition-colors cursor-pointer"
                  >
                    Cancel All ({commands.length})
                  </button>
                </div>
              )}
              <ActiveTable commands={commands} onCancel={(id) => setCancelTarget(id)} />
            </>
          )}
        </>
      )}

      {tab === 'history' && (
        historyLoading ? (
          <LoadingSpinner message="Loading command history..." />
        ) : !history?.length ? (
          <EmptyState title="No command history" subtitle="Completed, failed, and cancelled commands will appear here." />
        ) : (
          <HistoryTable commands={history} />
        )
      )}

      {/* Cancel single command dialog */}
      {cancelTarget && (
        <ConfirmDialog
          title="Cancel Command"
          message={`Cancel command ${cancelTarget.slice(0, 8)}…? This cannot be undone.`}
          confirmLabel="Cancel Command"
          variant="danger"
          onConfirm={() => handleCancel(cancelTarget)}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {/* Cancel all dialog */}
      {cancelAllOpen && (
        <ConfirmDialog
          title="Cancel All Commands"
          message={`Cancel all ${commands.length} queued commands? This cannot be undone.`}
          confirmLabel="Cancel All"
          variant="danger"
          onConfirm={handleCancelAll}
          onCancel={() => setCancelAllOpen(false)}
        />
      )}
    </div>
  )
}

/* ── Tab Button ─────────────────────────────────────────── */

function TabButton({ active, onClick, count, children }: {
  active: boolean; onClick: () => void; count?: number; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
        active
          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
          : 'text-slate-400 hover:text-slate-300 border border-transparent hover:border-white/5'
      }`}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${active ? 'bg-indigo-500/30' : 'bg-slate-700'}`}>
          {count}
        </span>
      )}
    </button>
  )
}

/* ── Active Queue Table ─────────────────────────────────── */

function ActiveTable({ commands, onCancel }: { commands: QueueCommand[]; onCancel: (id: string) => void }) {
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/5 bg-slate-900/30">
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Command ID</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Type</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Target Agent</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Status</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Source</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Priority</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3 text-right">Created</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {commands.map(cmd => (
              <tr key={cmd.command_id} className="border-b border-white/[0.03] last:border-0 hover:bg-slate-800/30 transition-colors">
                <td className="px-5 py-3">
                  <span className="text-xs text-slate-300 font-mono" title={cmd.command_id}>
                    {truncateId(cmd.command_id)}
                  </span>
                </td>
                <td className="px-5 py-3 text-sm text-slate-200">{cmd.command_type}</td>
                <td className="px-5 py-3 text-xs text-slate-400">{agentLabel(cmd.target_agent_id)}</td>
                <td className="px-5 py-3"><StatusBadge status={cmd.status} size="sm" /></td>
                <td className="px-5 py-3 text-xs text-slate-500">{cmd.created_by ?? '—'}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs font-medium ${PRIORITY_COLORS[cmd.priority] ?? 'text-slate-400'}`}>
                    {priorityLabel(cmd.priority)}
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-xs text-slate-500">{timeAgo(cmd.created_at)}</td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => onCancel(cmd.command_id)}
                    className="text-[10px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 px-2 py-0.5 rounded transition-colors cursor-pointer"
                    title="Cancel this command"
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-white/5 px-5 py-2.5 bg-slate-900/20">
        <span className="text-[11px] text-slate-600">
          Showing {commands.length} command{commands.length !== 1 ? 's' : ''} ordered by priority then creation time
        </span>
      </div>
    </div>
  )
}

/* ── History Table ──────────────────────────────────────── */

function HistoryTable({ commands }: { commands: HistoryCommand[] }) {
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/5 bg-slate-900/30">
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Command ID</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Agent</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Goal</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Status</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Steps</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Duration</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Source</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3 text-right">Completed</th>
            </tr>
          </thead>
          <tbody>
            {commands.map(cmd => {
              const startTime = cmd.run_started_at ?? cmd.claimed_at ?? cmd.created_at
              const endTime = cmd.run_completed_at ?? cmd.completed_at
              return (
                <tr key={cmd.command_id} className="border-b border-white/[0.03] last:border-0 hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3">
                    <span className="text-xs text-slate-300 font-mono" title={cmd.command_id}>
                      {truncateId(cmd.command_id)}
                    </span>
                    {cmd.run_id && (
                      <a href={`/runs/${cmd.run_id}`} className="block text-[10px] text-indigo-400 hover:text-indigo-300 mt-0.5">
                        Run: {cmd.run_id.slice(0, 8)}
                      </a>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-400">{agentLabel(cmd.target_agent_id)}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-slate-300 max-w-[200px] truncate block" title={cmd.goal ?? ''}>
                      {cmd.goal ? (cmd.goal.length > 60 ? cmd.goal.slice(0, 60) + '…' : cmd.goal) : '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3"><StatusBadge status={cmd.status} size="sm" /></td>
                  <td className="px-5 py-3 text-xs text-slate-400">
                    {cmd.current_step !== undefined && cmd.total_steps
                      ? `${cmd.current_step}/${cmd.total_steps}`
                      : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-slate-400 font-mono">
                      {formatDuration(startTime, endTime)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{cmd.created_by ?? '—'}</td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500">
                    {timeAgo(cmd.completed_at ?? cmd.created_at)}
                    {cmd.error && (
                      <span className="block text-[10px] text-red-400 mt-0.5 truncate max-w-[150px]" title={cmd.error}>
                        {cmd.error.slice(0, 40)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-white/5 px-5 py-2.5 bg-slate-900/20">
        <span className="text-[11px] text-slate-600">
          Showing {commands.length} completed command{commands.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
