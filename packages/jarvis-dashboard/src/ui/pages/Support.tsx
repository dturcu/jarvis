import { useState, useCallback } from 'react'
import { useApi } from '../hooks/useApi.ts'
import PageHeader from '../shared/PageHeader.tsx'
import DataCard from '../shared/DataCard.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import { timeAgo, agentLabel, formatUptime } from '../types/index.ts'

/* ── Page-local types ────────────────────────────────────── */

interface SupportBundle {
  system: {
    node_version: string
    platform: string
    uptime: number
    memory: {
      rss?: number
      heapUsed?: number
      heapTotal?: number
      [key: string]: number | undefined
    }
  }
  recent_runs: Array<{
    run_id: string
    agent_id: string
    status: string
    started_at: string
    completed_at?: string | null
  }>
  failed_events: Array<{
    run_id: string
    agent_id: string
    error?: string
    timestamp: string
  }>
  audit_log: Array<{
    id: string
    action: string
    actor: string
    timestamp: string
    details?: string
  }>
  pending_approvals: Array<{
    id: string
    action: string
    agent: string
    created_at?: string
  }>
  daemon_heartbeat: {
    timestamp: string
    status: string
  } | null
}

/* ── Main Component ──────────────────────────────────────── */

export default function Support() {
  const { data: bundle, loading, error, refetch } = useApi<SupportBundle>('/api/support/bundle')

  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      const resp = await fetch('/api/support/bundle')
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jarvis-support-bundle-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // export failed — user can retry
    } finally {
      setExporting(false)
    }
  }, [])

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader title="Support" subtitle="Diagnostics and support tools" />
        <LoadingSpinner message="Collecting diagnostics..." />
      </div>
    )
  }

  if (error || !bundle) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader title="Support" subtitle="Diagnostics and support tools" />
        <DataCard variant="error" hover={false}>
          <p className="text-sm text-red-400">Failed to load support bundle</p>
          <p className="text-xs text-red-300/60 mt-1">{error ?? 'Unknown error'}</p>
          <button
            onClick={refetch}
            className="mt-3 text-xs px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors cursor-pointer"
          >
            Retry
          </button>
        </DataCard>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Support"
        subtitle="Diagnostics and support tools"
        actions={
          <button
            onClick={handleExport}
            disabled={exporting}
            className="text-sm px-4 py-2 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {exporting ? 'Exporting...' : 'Export Bundle'}
          </button>
        }
      />

      {/* ── System Info ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <SystemInfoCard system={bundle.system} />
        <HeartbeatCard heartbeat={bundle.daemon_heartbeat} />
      </div>

      {/* ── Recent Runs Summary ──────────────────────────────── */}
      <div className="mb-6">
        <RecentRunsSummary runs={bundle.recent_runs} />
      </div>

      {/* ── Pending Approvals ────────────────────────────────── */}
      <div className="mb-6">
        <PendingApprovalsCard approvals={bundle.pending_approvals} />
      </div>

      {/* ── Failed Events ────────────────────────────────────── */}
      <div className="mb-6">
        <FailedEventsCard events={bundle.failed_events} />
      </div>

      {/* ── Audit Log ────────────────────────────────────────── */}
      <div className="mb-6">
        <AuditLogTable entries={bundle.audit_log} />
      </div>
    </div>
  )
}

/* ── Section Components ──────────────────────────────────── */

function SystemInfoCard({ system }: { system: SupportBundle['system'] }) {
  const memMb = (bytes: number | undefined) =>
    bytes != null ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '--'

  return (
    <DataCard hover={false}>
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
        System Info
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <StatItem label="Node Version" value={system.node_version} />
        <StatItem label="Platform" value={system.platform} />
        <StatItem label="Uptime" value={formatUptime(system.uptime)} />
        <StatItem label="Memory (RSS)" value={memMb(system.memory.rss)} />
        <StatItem label="Heap Used" value={memMb(system.memory.heapUsed)} />
        <StatItem label="Heap Total" value={memMb(system.memory.heapTotal)} />
      </div>
    </DataCard>
  )
}

function HeartbeatCard({ heartbeat }: { heartbeat: SupportBundle['daemon_heartbeat'] }) {
  const alive = heartbeat != null
  const statusKey = heartbeat?.status ?? 'offline'

  return (
    <DataCard variant={alive ? 'default' : 'warning'} hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Daemon Heartbeat
        </h2>
        <StatusBadge
          status={alive ? 'ok' : 'warning'}
          label={alive ? 'Alive' : 'No Heartbeat'}
          size="sm"
        />
      </div>

      {alive ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Status</span>
            <StatusBadge status={statusKey} size="sm" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Last Beat</span>
            <span className="text-sm text-slate-200 font-medium">{timeAgo(heartbeat.timestamp)}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">No daemon heartbeat detected. The daemon may not be running.</p>
      )}
    </DataCard>
  )
}

function RecentRunsSummary({ runs }: { runs: SupportBundle['recent_runs'] }) {
  const total = runs.length
  const byStatus: Record<string, number> = {}
  for (const r of runs) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  }

  return (
    <DataCard hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Recent Runs
        </h2>
        <span className="text-xs text-slate-500 font-mono">
          Last {total}
        </span>
      </div>

      {total === 0 ? (
        <EmptyState title="No recent runs" subtitle="Runs will appear here after agents execute." />
      ) : (
        <>
          {/* Status breakdown */}
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(byStatus).map(([status, count]) => (
              <div
                key={status}
                className="bg-slate-900/40 border border-white/5 rounded-lg px-3 py-2 flex items-center gap-2"
              >
                <StatusBadge status={status} size="sm" />
                <span className="text-sm text-slate-200 font-mono font-medium">{count}</span>
              </div>
            ))}
          </div>

          {/* Compact run list */}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {runs.map(r => (
              <div
                key={r.run_id}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-900/30 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={r.status} size="sm" />
                  <span className="text-xs text-slate-300 truncate">{agentLabel(r.agent_id)}</span>
                </div>
                <span className="text-[11px] text-slate-600 shrink-0 ml-2">{timeAgo(r.started_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </DataCard>
  )
}

function PendingApprovalsCard({ approvals }: { approvals: SupportBundle['pending_approvals'] }) {
  return (
    <DataCard
      variant={approvals.length > 0 ? 'warning' : 'default'}
      hover={false}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Pending Approvals
        </h2>
        <StatusBadge
          status={approvals.length > 0 ? 'pending' : 'ok'}
          label={`${approvals.length}`}
          size="sm"
        />
      </div>

      {approvals.length === 0 ? (
        <EmptyState title="No pending approvals" subtitle="All approval requests have been resolved." />
      ) : (
        <div className="space-y-2">
          {approvals.map(a => (
            <div
              key={a.id}
              className="bg-slate-900/40 border border-white/5 rounded-lg px-4 py-3 flex items-center justify-between"
            >
              <div className="min-w-0">
                <span className="text-sm text-slate-200 block">{a.action}</span>
                <span className="text-[11px] text-slate-500">{agentLabel(a.agent)}</span>
              </div>
              <span className="text-[11px] text-slate-600 shrink-0 ml-2">{timeAgo(a.created_at ?? null)}</span>
            </div>
          ))}
        </div>
      )}
    </DataCard>
  )
}

function FailedEventsCard({ events }: { events: SupportBundle['failed_events'] }) {
  return (
    <DataCard variant={events.length > 0 ? 'error' : 'default'} hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Failed Events
        </h2>
        <StatusBadge
          status={events.length > 0 ? 'critical' : 'ok'}
          label={`${events.length} failure${events.length !== 1 ? 's' : ''}`}
          size="sm"
        />
      </div>

      {events.length === 0 ? (
        <EmptyState title="No failed events" subtitle="No recent failures recorded." />
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1.5">
          {events.map((ev, i) => (
            <div
              key={`${ev.run_id}-${i}`}
              className="bg-slate-900/40 border border-red-500/10 rounded-lg px-4 py-3"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-300 font-medium">{agentLabel(ev.agent_id)}</span>
                <span className="text-[11px] text-slate-600">{timeAgo(ev.timestamp)}</span>
              </div>
              {ev.error && (
                <p className="text-[11px] text-red-400/80 font-mono break-words">{ev.error}</p>
              )}
              <p className="text-[10px] text-slate-600 font-mono mt-1">Run: {ev.run_id}</p>
            </div>
          ))}
        </div>
      )}
    </DataCard>
  )
}

function AuditLogTable({ entries }: { entries: SupportBundle['audit_log'] }) {
  return (
    <DataCard hover={false}>
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
        Audit Log
      </h2>

      {entries.length === 0 ? (
        <EmptyState title="No audit entries" subtitle="Audit log entries will appear here as actions are performed." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Action</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Actor</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Details</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id} className="border-b border-white/[0.03] last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="text-sm text-slate-200">{entry.action}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-xs text-slate-400">{entry.actor}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-xs text-slate-500 truncate block max-w-[300px]">
                      {entry.details ?? '--'}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <span className="text-xs text-slate-500">{timeAgo(entry.timestamp)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DataCard>
  )
}

/* ── Utility sub-component ───────────────────────────────── */

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/40 rounded-lg px-3 py-2">
      <span className="text-[10px] text-slate-600 uppercase tracking-wider block">{label}</span>
      <span className="text-sm text-slate-200 font-mono font-medium">{value}</span>
    </div>
  )
}
