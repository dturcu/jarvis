import { usePolling } from '../hooks/usePolling.ts'
import PageHeader from '../shared/PageHeader.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import { timeAgo } from '../types/index.ts'

/* ── Page-local types ────────────────────────────────────── */

interface QueueCommand {
  id: string
  type: string
  target_agent: string
  status: string
  priority: number
  created_at: string
}

/* ── Priority helpers ────────────────────────────────────── */

const PRIORITY_LABELS: Record<number, string> = {
  0: 'Low',
  1: 'Normal',
  2: 'High',
  3: 'Critical',
}

const PRIORITY_COLORS: Record<number, string> = {
  0: 'text-slate-500',
  1: 'text-slate-300',
  2: 'text-amber-400',
  3: 'text-red-400',
}

function priorityLabel(p: number): string {
  return PRIORITY_LABELS[p] ?? `P${p}`
}

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id
}

/* ── Main Component ──────────────────────────────────────── */

export default function Queue() {
  const { data, loading, error } = usePolling<QueueCommand[]>('/api/queue', 5000)

  const commands = data ?? []

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Command Queue"
        subtitle="Pending and active commands"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-mono">
              Auto-refresh 5s
            </span>
            {!loading && (
              <StatusBadge
                status={commands.length > 0 ? 'pending' : 'ok'}
                label={`${commands.length} command${commands.length !== 1 ? 's' : ''}`}
                size="sm"
              />
            )}
          </div>
        }
      />

      {loading && !data ? (
        <LoadingSpinner message="Loading command queue..." />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : commands.length === 0 ? (
        <EmptyState
          title="Queue is empty"
          subtitle="No pending commands. Commands appear here when agents or workflows enqueue work."
        />
      ) : (
        <QueueTable commands={commands} />
      )}
    </div>
  )
}

/* ── Section Components ──────────────────────────────────── */

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4">
      <p className="text-sm text-red-400">Failed to load queue</p>
      <p className="text-xs text-red-300/60 mt-1">{message}</p>
    </div>
  )
}

function QueueTable({ commands }: { commands: QueueCommand[] }) {
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
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3">Priority</th>
              <th className="text-[10px] text-slate-600 uppercase tracking-wider px-5 py-3 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {commands.map(cmd => (
              <tr key={cmd.id} className="border-b border-white/[0.03] last:border-0 hover:bg-slate-800/30 transition-colors">
                <td className="px-5 py-3">
                  <span className="text-xs text-slate-300 font-mono" title={cmd.id}>
                    {truncateId(cmd.id)}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-sm text-slate-200">{cmd.type}</span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs text-slate-400">{cmd.target_agent}</span>
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={cmd.status} size="sm" />
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs font-medium ${PRIORITY_COLORS[cmd.priority] ?? 'text-slate-400'}`}>
                    {priorityLabel(cmd.priority)}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <span className="text-xs text-slate-500">{timeAgo(cmd.created_at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="border-t border-white/5 px-5 py-2.5 bg-slate-900/20">
        <span className="text-[11px] text-slate-600">
          Showing {commands.length} command{commands.length !== 1 ? 's' : ''} ordered by priority then creation time
        </span>
      </div>
    </div>
  )
}
