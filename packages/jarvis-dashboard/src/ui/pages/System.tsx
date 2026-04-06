import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useDashboardStore } from '../stores/dashboard-store.ts'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import PageHeader from '../shared/PageHeader.tsx'
import DataCard from '../shared/DataCard.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import TimelineItem from '../shared/TimelineItem.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { IconWarning, IconCheck, IconError, IconClock } from '../shared/icons.tsx'
import type { ModelHealthReport, HistoryResponse, HistoryEvent } from '../types/index.ts'
import { formatUptime, timeAgo } from '../types/index.ts'

/* ── API response shapes (page-local) ────────────────────── */

interface ServiceStatusResponse {
  daemon: { running: boolean; pid: number | null; uptime_seconds: number | null }
  dashboard: { version: string; uptime_seconds: number | null }
}

interface BackupStatusResponse {
  last_backup: string | null
  path: string | null
  files: string[]
  size: number
}

/* ── Main Component ──────────────────────────────────────── */

export default function System() {
  const { daemon, safeMode } = useDashboardStore()

  const { data: modelHealth, loading: modelsLoading, error: modelsError } =
    useApi<ModelHealthReport>('/api/models/health')
  const { data: serviceStatus, loading: serviceLoading } =
    useApi<ServiceStatusResponse>('/api/service/status')
  const { data: backupStatus, loading: backupLoading, refetch: refetchBackup } =
    useApi<BackupStatusResponse>('/api/backup/status')
  const { data: historyData, loading: historyLoading } =
    useApi<HistoryResponse>('/api/history?type=system&limit=10')

  const [backupConfirm, setBackupConfirm] = useState(false)
  const [backupRunning, setBackupRunning] = useState(false)

  const handleBackup = useCallback(async () => {
    setBackupConfirm(false)
    setBackupRunning(true)
    try {
      await apiFetch('/api/backup', { method: 'POST' })
      refetchBackup()
    } catch {
      // Backup failed silently — user sees stale timestamp
    } finally {
      setBackupRunning(false)
    }
  }, [refetchBackup])

  const isSafeMode = safeMode?.safe_mode_recommended
  const events = historyData?.events ?? []

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="System"
        subtitle="Infrastructure health and diagnostics"
        actions={
          <StatusBadge
            status={isSafeMode ? 'critical' : daemon?.running ? 'healthy' : 'offline'}
            label={isSafeMode ? 'Safe Mode' : daemon?.running ? 'Operational' : 'Offline'}
            pulse={isSafeMode || (daemon?.running ?? false)}
            variant="dot"
            size="md"
          />
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* ── 1. Daemon Status ─────────────────────────────── */}
        <DaemonCard />

        {/* ── 2. Safe Mode ─────────────────────────────────── */}
        <SafeModeCard />
      </div>

      {/* ── 3. Model / Runtime Health ──────────────────────── */}
      <div className="mb-4">
        <ModelHealthCard
          data={modelHealth}
          loading={modelsLoading}
          error={modelsError}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* ── 4. Service Status ────────────────────────────── */}
        <ServiceStatusCard data={serviceStatus} loading={serviceLoading} />

        {/* ── 5. Backup Status ─────────────────────────────── */}
        <BackupCard
          data={backupStatus}
          loading={backupLoading}
          running={backupRunning}
          onBackupRequest={() => setBackupConfirm(true)}
        />
      </div>

      {/* ── 6. Recent System Events ────────────────────────── */}
      <div className="mb-4">
        <SystemEventsCard events={events} loading={historyLoading} />
      </div>

      {/* ── Backup confirm dialog ──────────────────────────── */}
      <ConfirmDialog
        open={backupConfirm}
        title="Create Backup"
        message="This will create a new backup of all Jarvis databases and configuration files."
        confirmLabel="Create Backup"
        onConfirm={handleBackup}
        onCancel={() => setBackupConfirm(false)}
      />
    </div>
  )
}

/* ── Section Components ──────────────────────────────────── */

function DaemonCard() {
  const { daemon } = useDashboardStore()
  const running = daemon?.running ?? false
  const activeRuns = daemon?.active_runs?.length ?? 0

  return (
    <DataCard variant={running ? 'success' : 'error'} hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Daemon</h2>
        <span className="relative flex h-2.5 w-2.5">
          {running && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${running ? 'bg-emerald-500' : 'bg-red-500'}`} />
        </span>
      </div>

      {/* Status line */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`text-lg font-bold ${running ? 'text-emerald-400' : 'text-red-400'}`}>
          {running ? 'Connected' : 'Offline'}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatItem label="PID" value={daemon?.pid != null ? String(daemon.pid) : '--'} />
        <StatItem label="Uptime" value={formatUptime(daemon?.uptime_seconds ?? null)} />
        <StatItem label="Agents" value={String(daemon?.agents_registered ?? 0)} />
        <StatItem label="Schedules" value={String(daemon?.schedules_active ?? 0)} />
      </div>

      {activeRuns > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
          </span>
          <span className="text-xs text-amber-300 font-medium">
            {activeRuns} active run{activeRuns !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </DataCard>
  )
}

function SafeModeCard() {
  const { safeMode } = useDashboardStore()
  const active = safeMode?.safe_mode_recommended ?? false
  const reasons = safeMode?.reasons ?? []

  return (
    <DataCard variant={active ? 'error' : 'success'} hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Safe Mode</h2>
        {active ? (
          <span className="text-red-400"><IconWarning size={18} /></span>
        ) : (
          <span className="text-emerald-400"><IconCheck size={18} /></span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className={`text-lg font-bold ${active ? 'text-red-400' : 'text-emerald-400'}`}>
          {active ? 'Recommended' : 'Normal Operation'}
        </span>
      </div>

      {active ? (
        <>
          <p className="text-xs text-red-300/60 mb-3">
            Outbound actions are restricted until issues are resolved.
          </p>
          {reasons.length > 0 && (
            <ul className="space-y-1.5 mb-3">
              {reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-red-300/80">
                  <span className="text-red-500 mt-0.5 shrink-0"><IconError size={12} /></span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/recovery"
            className="inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            Open Recovery Center
          </Link>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          All systems operating within normal parameters. No restrictions active.
        </p>
      )}
    </DataCard>
  )
}

function ModelHealthCard({
  data, loading, error,
}: {
  data: ModelHealthReport | null
  loading: boolean
  error: string | null
}) {
  if (loading) return <DataCard hover={false}><LoadingSpinner message="Checking runtimes..." /></DataCard>

  if (error || !data) {
    return (
      <DataCard variant="error" hover={false}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Model Runtimes</h2>
          <StatusBadge status="critical" label="Unreachable" />
        </div>
        <p className="text-xs text-red-300/60">{error ?? 'Failed to fetch model health data.'}</p>
      </DataCard>
    )
  }

  const runtimes = data.runtimes ?? []

  return (
    <DataCard variant={data.degraded ? 'warning' : 'default'} hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Model Runtimes</h2>
        {data.degraded && <StatusBadge status="degraded" label="Degraded" />}
        {!data.degraded && runtimes.length > 0 && <StatusBadge status="healthy" label="All Connected" />}
      </div>

      {runtimes.length === 0 ? (
        <EmptyState title="No runtimes configured" subtitle="Add model runtimes to enable agent execution." />
      ) : (
        <div className="space-y-2">
          {runtimes.map((rt) => (
            <div
              key={rt.name}
              className="bg-slate-900/40 border border-white/5 rounded-lg px-4 py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${rt.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                </span>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-200 block truncate">{rt.name}</span>
                  <span className="text-[11px] text-slate-600 font-mono block truncate">{rt.url}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {rt.error ? (
                  <span className="text-[11px] text-red-400 max-w-[180px] truncate">{rt.error}</span>
                ) : (
                  <span className="text-xs text-slate-500 font-mono">
                    {rt.models.length} model{rt.models.length !== 1 ? 's' : ''}
                  </span>
                )}
                <StatusBadge
                  status={rt.connected ? 'ok' : 'critical'}
                  label={rt.connected ? 'Connected' : 'Down'}
                  size="sm"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </DataCard>
  )
}

function ServiceStatusCard({
  data, loading,
}: {
  data: ServiceStatusResponse | null
  loading: boolean
}) {
  if (loading) return <DataCard hover={false}><LoadingSpinner message="Checking services..." /></DataCard>

  const daemonOk = data?.daemon?.running ?? false
  const dashVersion = data?.dashboard?.version ?? '--'
  const dashUptime = data?.dashboard?.uptime_seconds ?? null

  return (
    <DataCard hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Services</h2>
      </div>

      <div className="space-y-3">
        {/* Daemon service */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className={`inline-flex rounded-full h-2 w-2 ${daemonOk ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-sm text-slate-200 font-medium">Daemon Process</span>
          </div>
          <div className="flex items-center gap-2">
            {data?.daemon?.pid && (
              <span className="text-xs text-slate-600 font-mono">PID {data.daemon.pid}</span>
            )}
            <StatusBadge
              status={daemonOk ? 'ok' : 'critical'}
              label={daemonOk ? 'Running' : 'Stopped'}
              size="sm"
            />
          </div>
        </div>

        <div className="border-t border-white/5" />

        {/* Dashboard service */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            <span className="text-sm text-slate-200 font-medium">Dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 font-mono">v{dashVersion}</span>
            <StatusBadge status="ok" label="Running" size="sm" />
          </div>
        </div>

        {dashUptime != null && (
          <div className="pt-2 border-t border-white/5">
            <span className="text-[11px] text-slate-600">
              Dashboard uptime: {formatUptime(dashUptime)}
            </span>
          </div>
        )}
      </div>
    </DataCard>
  )
}

function BackupCard({
  data, loading, running, onBackupRequest,
}: {
  data: BackupStatusResponse | null
  loading: boolean
  running: boolean
  onBackupRequest: () => void
}) {
  if (loading) return <DataCard hover={false}><LoadingSpinner message="Checking backups..." /></DataCard>

  const lastBackup = data?.last_backup ?? null
  const backupPath = data?.path ?? null
  const fileCount = data?.files?.length ?? 0
  const sizeBytes = data?.size ?? 0
  const sizeMb = sizeBytes > 0 ? (sizeBytes / (1024 * 1024)).toFixed(1) : '0'

  // Warn if no backup in 24h
  const stale = lastBackup
    ? (Date.now() - new Date(lastBackup).getTime()) > 24 * 60 * 60 * 1000
    : true

  return (
    <DataCard variant={stale ? 'warning' : 'default'} hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Backups</h2>
        {stale && <StatusBadge status="warning" label="Stale" size="sm" />}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Last Backup</span>
          <span className="text-sm text-slate-200 font-medium">{timeAgo(lastBackup)}</span>
        </div>

        {backupPath && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-xs text-slate-500 shrink-0">Path</span>
            <span className="text-[11px] text-slate-400 font-mono text-right truncate">{backupPath}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Files</span>
          <span className="text-xs text-slate-400 font-mono">{fileCount} files / {sizeMb} MB</span>
        </div>

        <div className="pt-3 border-t border-white/5">
          <button
            onClick={onBackupRequest}
            disabled={running}
            className="w-full text-sm px-4 py-2 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {running ? 'Creating Backup...' : 'Create Backup'}
          </button>
        </div>
      </div>
    </DataCard>
  )
}

function SystemEventsCard({ events, loading }: { events: HistoryEvent[]; loading: boolean }) {
  if (loading) return <DataCard hover={false}><LoadingSpinner message="Loading events..." /></DataCard>

  const typeIcon = (type: string) => {
    switch (type) {
      case 'system': return <IconClock size={14} />
      case 'backup': return <IconCheck size={14} />
      case 'recovery': return <IconWarning size={14} />
      default: return <IconClock size={14} />
    }
  }

  return (
    <DataCard hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Recent System Events</h2>
        <Link to="/history" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
        </Link>
      </div>

      {events.length === 0 ? (
        <EmptyState title="No recent system events" subtitle="System events will appear here as they occur." />
      ) : (
        <div className="mt-2">
          {events.map((event, i) => (
            <TimelineItem
              key={event.id}
              timestamp={event.timestamp}
              title={event.title}
              subtitle={event.subtitle}
              status={event.status}
              typeIcon={typeIcon(event.type)}
              typeLabel={event.type}
              last={i === events.length - 1}
            />
          ))}
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
