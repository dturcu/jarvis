import React, { useState, useCallback } from 'react'
import { useDashboardStore } from '../stores/dashboard-store.ts'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import PageHeader from '../shared/PageHeader.tsx'
import DataCard from '../shared/DataCard.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { IconWarning, IconCheck, IconError, IconRecovery } from '../shared/icons.tsx'
import type { RepairReport, RepairCheck, FixAction, DaemonStatus } from '../types/index.ts'
import { formatUptime, timeAgo } from '../types/index.ts'

/* ── API response shapes (page-local) ────────────────────── */

interface SafeModeApiResponse {
  safe_mode: boolean
  reason: string
  checks: { databases_ok: boolean; config_ok: boolean; daemon_running: boolean }
}

interface BackupStatusResponse {
  last_backup: string | null
  path: string | null
  files: string[]
  size: number
}

interface SupportBundleResponse {
  generated_at: string
  system: Record<string, unknown>
  repair: Record<string, unknown>
  daemon: Record<string, unknown>
  [key: string]: unknown
}

/* ── Main Component ──────────────────────────────────────── */

export default function Recovery() {
  const { daemon } = useDashboardStore()

  const { data: repair, loading: repairLoading, error: repairError, refetch: refetchRepair } =
    useApi<RepairReport>('/api/repair')
  const { data: safeModeData, loading: safeModeLoading, refetch: refetchSafeMode } =
    useApi<SafeModeApiResponse>('/api/safemode')
  const { data: daemonStatus, loading: daemonLoading, refetch: refetchDaemon } =
    useApi<DaemonStatus>('/api/daemon/status')
  const { data: backupStatus, loading: backupLoading, refetch: refetchBackup } =
    useApi<BackupStatusResponse>('/api/backup/status')

  /* ── Dialog state ──────────────────────────────────────── */
  const [restartConfirm, setRestartConfirm] = useState(false)
  const [restartRunning, setRestartRunning] = useState(false)
  const [backupConfirm, setBackupConfirm] = useState(false)
  const [backupRunning, setBackupRunning] = useState(false)
  const [restoreConfirm, setRestoreConfirm] = useState(false)
  const [restoreRunning, setRestoreRunning] = useState(false)
  const [restorePath, setRestorePath] = useState('')
  const [exitSafeModeRunning, setExitSafeModeRunning] = useState(false)
  const [exitSafeModeResult, setExitSafeModeResult] = useState<string | null>(null)
  const [bundleData, setBundleData] = useState<SupportBundleResponse | null>(null)
  const [bundleLoading, setBundleLoading] = useState(false)
  const [bundleExpanded, setBundleExpanded] = useState(false)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})

  /* ── Handlers ──────────────────────────────────────────── */

  const handleRestartDaemon = useCallback(async () => {
    setRestartConfirm(false)
    setRestartRunning(true)
    setActionErrors(prev => ({ ...prev, restart: '' }))
    try {
      await apiFetch('/api/service/restart', { method: 'POST' })
      refetchDaemon()
      refetchRepair()
    } catch (err) {
      setActionErrors(prev => ({ ...prev, restart: err instanceof Error ? err.message : 'Restart failed' }))
    } finally {
      setRestartRunning(false)
    }
  }, [refetchDaemon, refetchRepair])

  const handleBackup = useCallback(async () => {
    setBackupConfirm(false)
    setBackupRunning(true)
    setActionErrors(prev => ({ ...prev, backup: '' }))
    try {
      await apiFetch('/api/backup', { method: 'POST' })
      refetchBackup()
      refetchRepair()
    } catch (err) {
      setActionErrors(prev => ({ ...prev, backup: err instanceof Error ? err.message : 'Backup failed' }))
    } finally {
      setBackupRunning(false)
    }
  }, [refetchBackup, refetchRepair])

  const handleRestore = useCallback(async () => {
    setRestoreConfirm(false)
    setRestoreRunning(true)
    setActionErrors(prev => ({ ...prev, restore: '' }))
    try {
      await apiFetch('/api/backup/restore', { method: 'POST', body: { backup_path: restorePath } })
      refetchRepair()
      refetchDaemon()
      refetchBackup()
    } catch (err) {
      setActionErrors(prev => ({ ...prev, restore: err instanceof Error ? err.message : 'Restore failed' }))
    } finally {
      setRestoreRunning(false)
    }
  }, [restorePath, refetchRepair, refetchDaemon, refetchBackup])

  const handleExitSafeMode = useCallback(async () => {
    setExitSafeModeRunning(true)
    setExitSafeModeResult(null)
    try {
      const result = await apiFetch<{ ok: boolean; message?: string }>('/api/safemode/exit', { method: 'POST' })
      setExitSafeModeResult(result.ok ? 'Safe mode exited successfully.' : (result.message ?? 'Validation failed.'))
      refetchSafeMode()
      refetchRepair()
    } catch (err) {
      setExitSafeModeResult(err instanceof Error ? err.message : 'Failed to exit safe mode.')
    } finally {
      setExitSafeModeRunning(false)
    }
  }, [refetchSafeMode, refetchRepair])

  const handleExportBundle = useCallback(async () => {
    setBundleLoading(true)
    try {
      const data = await apiFetch<SupportBundleResponse>('/api/support/bundle', { method: 'GET' })
      setBundleData(data)
      setBundleExpanded(true)
      // Trigger download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jarvis-support-bundle-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Silent — user sees empty state
    } finally {
      setBundleLoading(false)
    }
  }, [])

  const refetchAll = useCallback(() => {
    refetchRepair()
    refetchSafeMode()
    refetchDaemon()
    refetchBackup()
  }, [refetchRepair, refetchSafeMode, refetchDaemon, refetchBackup])

  /* ── Derived ───────────────────────────────────────────── */

  const overallStatus = repair?.status ?? 'healthy'
  const checks = repair?.checks ?? []
  const recommendedActions = repair?.recommended_actions ?? []
  const isSafeMode = safeModeData?.safe_mode ?? repair?.safe_mode ?? false
  const issueCount = checks.filter(c => c.status !== 'ok').length

  if (repairLoading && safeModeLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader title="Recovery" subtitle="Repair and recovery tools" />
        <LoadingSpinner message="Running diagnostics..." />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Recovery"
        subtitle="Repair and recovery tools"
        actions={
          <button
            onClick={refetchAll}
            className="text-xs px-3 py-1.5 rounded-lg font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/5 transition-colors cursor-pointer"
          >
            Re-scan
          </button>
        }
      />

      {/* ── 1. Overall Status Banner ─────────────────────────── */}
      <OverallStatusBanner
        status={overallStatus}
        issueCount={issueCount}
        loading={repairLoading}
        error={repairError}
      />

      {/* ── 2. Safe Mode Status ──────────────────────────────── */}
      <div className="mt-4">
        <SafeModeSection
          data={safeModeData}
          active={isSafeMode}
          loading={safeModeLoading}
          exiting={exitSafeModeRunning}
          exitResult={exitSafeModeResult}
          onExit={handleExitSafeMode}
        />
      </div>

      {/* ── 3. Repair Checks ─────────────────────────────────── */}
      {checks.length > 0 && (
        <div className="mt-4">
          <SectionHeading title="Repair Checks" count={checks.length} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {checks.map(check => (
              <RepairCheckCard
                key={check.name}
                check={check}
                onRestartDaemon={() => setRestartConfirm(true)}
                restartRunning={restartRunning}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 4. Recommended Actions ───────────────────────────── */}
      {recommendedActions.length > 0 && (
        <div className="mt-4">
          <RecommendedActionsSection actions={recommendedActions} />
        </div>
      )}

      {/* ── 5. Daemon Control ────────────────────────────────── */}
      <div className="mt-4">
        <DaemonControlSection
          daemon={daemonStatus ?? daemon ?? null}
          loading={daemonLoading}
          restartRunning={restartRunning}
          restartError={actionErrors.restart}
          onRestart={() => setRestartConfirm(true)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* ── 6. Backup / Restore ──────────────────────────────── */}
        <BackupRestoreSection
          backup={backupStatus}
          loading={backupLoading}
          backupRunning={backupRunning}
          restoreRunning={restoreRunning}
          restorePath={restorePath}
          backupError={actionErrors.backup}
          restoreError={actionErrors.restore}
          onBackup={() => setBackupConfirm(true)}
          onRestorePathChange={setRestorePath}
          onRestore={() => setRestoreConfirm(true)}
        />

        {/* ── 7. Support Bundle ────────────────────────────────── */}
        <SupportBundleSection
          data={bundleData}
          loading={bundleLoading}
          expanded={bundleExpanded}
          onExport={handleExportBundle}
          onToggleExpand={() => setBundleExpanded(v => !v)}
        />
      </div>

      {/* ── Confirmation Dialogs ────────────────────────────── */}
      <ConfirmDialog
        open={restartConfirm}
        title="Restart Daemon"
        message="This will restart the Jarvis daemon process. Active runs will be interrupted."
        warning="Any currently executing agent runs will be terminated."
        confirmLabel="Restart Daemon"
        variant="warning"
        onConfirm={handleRestartDaemon}
        onCancel={() => setRestartConfirm(false)}
      />
      <ConfirmDialog
        open={backupConfirm}
        title="Create Backup"
        message="This will create a new backup of all Jarvis databases and configuration files."
        confirmLabel="Create Backup"
        onConfirm={handleBackup}
        onCancel={() => setBackupConfirm(false)}
      />
      <ConfirmDialog
        open={restoreConfirm}
        title="Restore from Backup"
        message={`This will restore Jarvis state from the backup at: ${restorePath || '(no path specified)'}`}
        warning="This is a destructive operation. Current databases will be overwritten with the backup contents. This cannot be undone."
        confirmLabel="Restore Backup"
        variant="danger"
        onConfirm={handleRestore}
        onCancel={() => setRestoreConfirm(false)}
      />
    </div>
  )
}

/* ── Section Components ──────────────────────────────────── */

function SectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{title}</h2>
      {count != null && (
        <span className="text-[10px] text-slate-600 font-mono bg-slate-800 px-1.5 py-0.5 rounded">
          {count}
        </span>
      )}
    </div>
  )
}

/* ── 1. Overall Status Banner ────────────────────────────── */

function OverallStatusBanner({
  status, issueCount, loading, error,
}: {
  status: string
  issueCount: number
  loading: boolean
  error: string | null
}) {
  if (loading) {
    return (
      <DataCard hover={false}>
        <LoadingSpinner message="Running diagnostics..." />
      </DataCard>
    )
  }

  if (error) {
    return (
      <DataCard variant="error" hover={false}>
        <div className="flex items-center gap-3 py-2">
          <span className="text-red-400"><IconError size={24} /></span>
          <div>
            <p className="text-lg font-bold text-red-400">Diagnostics Unavailable</p>
            <p className="text-xs text-red-300/60 mt-0.5">{error}</p>
          </div>
        </div>
      </DataCard>
    )
  }

  const configs: Record<string, { color: string; bg: string; border: string; icon: React.ReactNode; label: string; sub: string }> = {
    healthy: {
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/5',
      border: 'border-emerald-500/20',
      icon: <IconCheck size={28} />,
      label: 'All Systems Operational',
      sub: 'All repair checks passed. No issues detected.',
    },
    degraded: {
      color: 'text-amber-400',
      bg: 'bg-amber-500/5',
      border: 'border-amber-500/20',
      icon: <IconWarning size={28} />,
      label: 'Degraded',
      sub: `${issueCount} issue${issueCount !== 1 ? 's' : ''} need${issueCount === 1 ? 's' : ''} attention.`,
    },
    broken: {
      color: 'text-red-400',
      bg: 'bg-red-500/5',
      border: 'border-red-500/20',
      icon: <IconError size={28} />,
      label: 'System Broken',
      sub: `${issueCount} critical issue${issueCount !== 1 ? 's' : ''} detected. Immediate action required.`,
    },
  }

  const cfg = configs[status] ?? configs.healthy

  return (
    <div className={`${cfg.bg} border ${cfg.border} rounded-xl px-6 py-5 flex items-center gap-4`}>
      <span className={cfg.color}>{cfg.icon}</span>
      <div>
        <p className={`text-xl font-bold ${cfg.color}`}>{cfg.label}</p>
        <p className="text-sm text-slate-400 mt-0.5">{cfg.sub}</p>
      </div>
      <div className="ml-auto">
        <StatusBadge status={status} size="md" />
      </div>
    </div>
  )
}

/* ── 2. Safe Mode Status ─────────────────────────────────── */

function SafeModeSection({
  data, active, loading, exiting, exitResult, onExit,
}: {
  data: SafeModeApiResponse | null
  active: boolean
  loading: boolean
  exiting: boolean
  exitResult: string | null
  onExit: () => void
}) {
  if (loading) {
    return <DataCard hover={false}><LoadingSpinner message="Checking safe mode..." /></DataCard>
  }

  const checks = data?.checks

  if (active) {
    return (
      <DataCard variant="error" hover={false}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Safe Mode</h2>
          <StatusBadge status="critical" label="Active" pulse />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-red-400"><IconWarning size={20} /></span>
          <span className="text-lg font-bold text-red-400">Safe Mode Active</span>
        </div>

        {data?.reason && (
          <p className="text-xs text-red-300/70 mb-4">{data.reason}</p>
        )}

        {/* Individual checks */}
        {checks && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <SafeModeCheckItem label="Databases" ok={checks.databases_ok} />
            <SafeModeCheckItem label="Config" ok={checks.config_ok} />
            <SafeModeCheckItem label="Daemon" ok={checks.daemon_running} />
          </div>
        )}

        {exitResult && (
          <div className={`text-xs px-3 py-2 rounded-lg mb-3 ${
            exitResult.includes('success') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}>
            {exitResult}
          </div>
        )}

        <button
          onClick={onExit}
          disabled={exiting}
          className="text-sm px-4 py-2 rounded-lg font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {exiting ? 'Validating...' : 'Validate & Exit Safe Mode'}
        </button>
      </DataCard>
    )
  }

  return (
    <DataCard variant="success" hover={false}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Safe Mode</h2>
        <span className="text-emerald-400"><IconCheck size={18} /></span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg font-bold text-emerald-400">Normal Operation</span>
      </div>
      {checks && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <SafeModeCheckItem label="Databases" ok={checks.databases_ok} />
          <SafeModeCheckItem label="Config" ok={checks.config_ok} />
          <SafeModeCheckItem label="Daemon" ok={checks.daemon_running} />
        </div>
      )}
      {!checks && (
        <p className="text-xs text-slate-500">All systems operating normally. No restrictions active.</p>
      )}
    </DataCard>
  )
}

function SafeModeCheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 border ${
      ok ? 'bg-emerald-500/5 border-emerald-500/15' : 'bg-red-500/5 border-red-500/15'
    }`}>
      <div className="flex items-center gap-1.5">
        <span className={ok ? 'text-emerald-400' : 'text-red-400'}>
          {ok ? <IconCheck size={12} /> : <IconError size={12} />}
        </span>
        <span className={`text-xs font-medium ${ok ? 'text-emerald-300' : 'text-red-300'}`}>
          {label}
        </span>
      </div>
      <span className={`text-[10px] ${ok ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
        {ok ? 'OK' : 'Failed'}
      </span>
    </div>
  )
}

/* ── 3. Repair Check Card ────────────────────────────────── */

function RepairCheckCard({
  check, onRestartDaemon, restartRunning,
}: {
  check: RepairCheck
  onRestartDaemon: () => void
  restartRunning: boolean
}) {
  const statusIcon = {
    ok: <span className="text-emerald-400"><IconCheck size={18} /></span>,
    warning: <span className="text-amber-400"><IconWarning size={18} /></span>,
    critical: <span className="text-red-400"><IconError size={18} /></span>,
  }

  const variant = check.status === 'ok' ? 'default' as const
    : check.status === 'warning' ? 'warning' as const
    : 'error' as const

  const severityLabel = check.severity <= 1 ? 'Low' : check.severity <= 3 ? 'Medium' : check.severity <= 5 ? 'High' : 'Critical'
  const severityColor = check.severity <= 1 ? 'text-slate-500'
    : check.severity <= 3 ? 'text-amber-400'
    : check.severity <= 5 ? 'text-orange-400'
    : 'text-red-400'

  // Determine if this check has an actionable button
  const isDaemonCheck = check.name.toLowerCase().includes('daemon')
  const hasFixAction = check.fix_action != null

  return (
    <DataCard variant={variant} hover={false}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{statusIcon[check.status]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-medium text-slate-200 truncate">{check.name}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] font-mono ${severityColor}`}>
                SEV {check.severity}
              </span>
              <StatusBadge status={check.status} size="sm" />
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-2">{check.message}</p>

          {hasFixAction && (
            <div className="bg-slate-900/40 border border-white/5 rounded-lg px-3 py-2 mt-2">
              <p className="text-[11px] text-slate-500 mb-1">
                <span className="text-slate-400 font-medium">Fix:</span>{' '}
                {check.fix_action!.description}
              </p>
              {check.fix_action!.example && (
                <code className="text-[10px] text-indigo-400 font-mono bg-indigo-500/5 px-1.5 py-0.5 rounded">
                  {check.fix_action!.example}
                </code>
              )}
            </div>
          )}

          {/* Actionable button for daemon-related checks */}
          {isDaemonCheck && check.status !== 'ok' && (
            <button
              onClick={onRestartDaemon}
              disabled={restartRunning}
              className="mt-2 text-xs px-3 py-1.5 rounded-lg font-medium bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {restartRunning ? 'Restarting...' : 'Restart Daemon'}
            </button>
          )}
        </div>
      </div>
    </DataCard>
  )
}

/* ── 4. Recommended Actions ──────────────────────────────── */

function RecommendedActionsSection({
  actions,
}: {
  actions: string[]
}) {
  return (
    <DataCard variant="warning" hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Recommended Actions</h2>
        <span className="text-[10px] text-amber-400 font-mono bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
          {actions.length} action{actions.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-3">
        {actions.map((action, i) => (
          <div
            key={i}
            className="bg-slate-900/40 border border-white/5 rounded-lg px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <span className="text-amber-400 mt-0.5 shrink-0">
                <IconWarning size={14} />
              </span>
              <p className="text-xs text-slate-300">{action}</p>
            </div>
          </div>
        ))}
      </div>
    </DataCard>
  )
}

/* ── 5. Daemon Control ───────────────────────────────────── */

function DaemonControlSection({
  daemon, loading, restartRunning, restartError, onRestart,
}: {
  daemon: DaemonStatus | null
  loading: boolean
  restartRunning: boolean
  restartError?: string
  onRestart: () => void
}) {
  if (loading) {
    return <DataCard hover={false}><LoadingSpinner message="Checking daemon..." /></DataCard>
  }

  const running = daemon?.running ?? false

  return (
    <DataCard variant={running ? 'default' : 'error'} hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Daemon Control</h2>
        <StatusBadge
          status={running ? 'ok' : 'critical'}
          label={running ? 'Running' : 'Stopped'}
          pulse={running}
          variant="dot"
          size="md"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <StatItem label="Status" value={running ? 'Online' : 'Offline'} />
          <StatItem label="PID" value={daemon?.pid != null ? String(daemon.pid) : '--'} />
          <StatItem label="Uptime" value={formatUptime(daemon?.uptime_seconds ?? null)} />
        </div>
        <div className="shrink-0">
          <button
            onClick={onRestart}
            disabled={restartRunning}
            className="text-sm px-4 py-2 rounded-lg font-medium bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {restartRunning ? 'Restarting...' : 'Restart Daemon'}
          </button>
        </div>
      </div>

      {restartError && (
        <div className="mt-3 text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
          {restartError}
        </div>
      )}
    </DataCard>
  )
}

/* ── 6. Backup / Restore ─────────────────────────────────── */

function BackupRestoreSection({
  backup, loading, backupRunning, restoreRunning, restorePath,
  backupError, restoreError,
  onBackup, onRestorePathChange, onRestore,
}: {
  backup: BackupStatusResponse | null
  loading: boolean
  backupRunning: boolean
  restoreRunning: boolean
  restorePath: string
  backupError?: string
  restoreError?: string
  onBackup: () => void
  onRestorePathChange: (v: string) => void
  onRestore: () => void
}) {
  if (loading) {
    return <DataCard hover={false}><LoadingSpinner message="Checking backups..." /></DataCard>
  }

  const lastBackup = backup?.last_backup ?? null
  const backupPath = backup?.path ?? null
  const fileCount = backup?.files?.length ?? 0
  const sizeBytes = backup?.size ?? 0
  const sizeMb = sizeBytes > 0 ? (sizeBytes / (1024 * 1024)).toFixed(1) : '0'

  const stale = lastBackup
    ? (Date.now() - new Date(lastBackup).getTime()) > 24 * 60 * 60 * 1000
    : true

  return (
    <DataCard variant={stale ? 'warning' : 'default'} hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Backup / Restore</h2>
        {stale && <StatusBadge status="warning" label="Stale" size="sm" />}
      </div>

      {/* Backup info */}
      <div className="space-y-2 mb-4">
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
          <span className="text-xs text-slate-500">Size</span>
          <span className="text-xs text-slate-400 font-mono">{fileCount} files / {sizeMb} MB</span>
        </div>
      </div>

      {/* Create backup button */}
      <button
        onClick={onBackup}
        disabled={backupRunning}
        className="w-full text-sm px-4 py-2 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        {backupRunning ? 'Creating Backup...' : 'Create Backup'}
      </button>

      {backupError && (
        <div className="mt-2 text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
          {backupError}
        </div>
      )}

      {/* Restore section */}
      <div className="mt-4 pt-4 border-t border-white/5">
        <span className="text-xs text-slate-500 block mb-2">Restore from Backup</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={restorePath}
            onChange={e => onRestorePathChange(e.target.value)}
            placeholder="Backup file path..."
            className="flex-1 text-xs px-3 py-2 rounded-lg bg-slate-900/60 border border-white/5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30 font-mono"
          />
          <button
            onClick={onRestore}
            disabled={restoreRunning || !restorePath.trim()}
            className="text-xs px-3 py-2 rounded-lg font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
          >
            {restoreRunning ? 'Restoring...' : 'Restore'}
          </button>
        </div>
        {restoreError && (
          <div className="mt-2 text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
            {restoreError}
          </div>
        )}
      </div>
    </DataCard>
  )
}

/* ── 7. Support Bundle ───────────────────────────────────── */

function SupportBundleSection({
  data, loading, expanded, onExport, onToggleExpand,
}: {
  data: SupportBundleResponse | null
  loading: boolean
  expanded: boolean
  onExport: () => void
  onToggleExpand: () => void
}) {
  return (
    <DataCard hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Support Bundle</h2>
        <span className="text-slate-600"><IconRecovery /></span>
      </div>

      <p className="text-xs text-slate-500 mb-4">
        Export a diagnostic snapshot for troubleshooting. Includes system state, repair checks, daemon info, and configuration.
      </p>

      <button
        onClick={onExport}
        disabled={loading}
        className="w-full text-sm px-4 py-2 rounded-lg font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer border border-white/5"
      >
        {loading ? 'Generating...' : 'Export Support Bundle'}
      </button>

      {data && (
        <div className="mt-3">
          <button
            onClick={onToggleExpand}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
          >
            {expanded ? 'Hide details' : 'Show diagnostic summary'}
          </button>

          {expanded && (
            <div className="mt-2 bg-slate-900/60 border border-white/5 rounded-lg p-3 max-h-64 overflow-y-auto">
              <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(data, null, 2).slice(0, 3000)}
                {JSON.stringify(data, null, 2).length > 3000 && '\n... (truncated)'}
              </pre>
            </div>
          )}

          {data.generated_at && (
            <span className="text-[10px] text-slate-600 mt-2 block">
              Generated {timeAgo(data.generated_at)}
            </span>
          )}
        </div>
      )}

      {!data && !loading && (
        <p className="text-[11px] text-slate-600 mt-3">
          No bundle generated yet. Click export to create one.
        </p>
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
