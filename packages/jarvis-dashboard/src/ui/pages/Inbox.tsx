import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import PageHeader from '../shared/PageHeader.tsx'
import TabBar from '../shared/TabBar.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import DataCard from '../shared/DataCard.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { IconWarning, IconError, IconCheck, IconClock, IconArrowRight } from '../shared/icons.tsx'
import { usePolling } from '../hooks/usePolling.ts'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import type { EnrichedApproval, Run, RunExplanation, RepairReport } from '../types/index.ts'
import { agentLabel, timeAgo, STATUS_COLORS } from '../types/index.ts'

/* ── Constants ───────────────────────────────────────────── */

const TABS = ['Approvals', 'Failures', 'Retries', 'Alerts'] as const
type Tab = (typeof TABS)[number]

const RISK_COLORS: Record<string, string> = {
  low: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  high: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const REPAIR_BANNER: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  healthy: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/15', text: 'text-emerald-300', dot: 'bg-emerald-500' },
  degraded: { bg: 'bg-amber-500/5', border: 'border-amber-500/15', text: 'text-amber-300', dot: 'bg-amber-400' },
  broken: { bg: 'bg-red-500/5', border: 'border-red-500/15', text: 'text-red-300', dot: 'bg-red-500' },
}

/* ── Main component ──────────────────────────────────────── */

export default function Inbox() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) || 'Approvals'
  const [activeTab, setActiveTab] = useState<Tab>(TABS.includes(initialTab) ? initialTab : 'Approvals')
  const [filterPending, setFilterPending] = useState(true)

  // Approvals: poll every 10s
  const approvalsUrl = filterPending ? '/api/approvals?status=pending' : '/api/approvals'
  const { data: approvals, loading: loadingApprovals, refetch: refetchApprovals } = usePolling<EnrichedApproval[]>(approvalsUrl, 10_000)

  // Failures: single fetch + manual refetch
  const { data: failedRuns, loading: loadingFailures, refetch: refetchFailures } = useApi<Run[]>('/api/runs/failed')

  // Repair: single fetch
  const { data: repair, loading: loadingRepair } = useApi<RepairReport>('/api/repair')

  // Tab badges
  const pendingCount = approvals?.filter(a => a.status === 'pending').length ?? 0
  const failureCount = failedRuns?.length ?? 0
  const retryCount = failedRuns?.length ?? 0
  const alertCount = repair?.recommended_actions?.length ?? 0

  const badges: Partial<Record<Tab, number>> = {
    Approvals: pendingCount,
    Failures: failureCount,
    Retries: retryCount,
    Alerts: alertCount,
  }

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab)
    setSearchParams(tab === 'Approvals' ? {} : { tab })
  }, [setSearchParams])

  // Sync from URL on mount/navigation
  useEffect(() => {
    const urlTab = searchParams.get('tab') as Tab
    if (urlTab && TABS.includes(urlTab) && urlTab !== activeTab) {
      setActiveTab(urlTab)
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Inbox"
        subtitle="Decisions that need you — approvals, failures, and system alerts"
      />

      <TabBar
        tabs={TABS}
        active={activeTab}
        onChange={handleTabChange}
        badges={badges}
      />

      {activeTab === 'Approvals' && (
        <ApprovalsTab
          approvals={approvals}
          loading={loadingApprovals}
          filterPending={filterPending}
          onToggleFilter={() => setFilterPending(f => !f)}
          onActionComplete={refetchApprovals}
        />
      )}
      {activeTab === 'Failures' && (
        <FailuresTab runs={failedRuns} loading={loadingFailures} onRetry={refetchFailures} />
      )}
      {activeTab === 'Retries' && (
        <RetriesTab runs={failedRuns} loading={loadingFailures} />
      )}
      {activeTab === 'Alerts' && (
        <AlertsTab repair={repair} loading={loadingRepair} />
      )}
    </div>
  )
}

/* ── Approvals Tab ───────────────────────────────────────── */

function ApprovalsTab({
  approvals, loading, filterPending, onToggleFilter, onActionComplete,
}: {
  approvals: EnrichedApproval[] | null
  loading: boolean
  filterPending: boolean
  onToggleFilter: () => void
  onActionComplete: () => void
}) {
  if (loading && !approvals) return <LoadingSpinner message="Loading approvals..." />

  return (
    <div>
      {/* Filter toggle */}
      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={onToggleFilter}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors cursor-pointer ${
            filterPending
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
              : 'bg-slate-800 text-slate-400 border border-white/5 hover:text-white'
          }`}
        >
          Pending
        </button>
        <button
          onClick={onToggleFilter}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors cursor-pointer ${
            !filterPending
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800 text-slate-400 border border-white/5 hover:text-white'
          }`}
        >
          All
        </button>
      </div>

      {!approvals?.length ? (
        <EmptyState
          icon={<IconCheck size={28} />}
          title="No pending approvals"
          subtitle="All agent actions are resolved. Jarvis is running autonomously."
        />
      ) : (
        <div className="space-y-3">
          {approvals.map(approval => (
            <ApprovalCard key={approval.id} approval={approval} onActionComplete={onActionComplete} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Single approval card ────────────────────────────────── */

function ApprovalCard({
  approval, onActionComplete,
}: {
  approval: EnrichedApproval
  onActionComplete: () => void
}) {
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [explanation, setExplanation] = useState<RunExplanation | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)

  const isPending = approval.status === 'pending'
  const riskLevel = approval.risk?.level ?? 'low'
  const riskColor = RISK_COLORS[riskLevel] ?? RISK_COLORS.low

  const handleAction = useCallback(async (action: 'approve' | 'reject') => {
    setActing(action)
    try {
      await apiFetch(`/api/approvals/${approval.id}/${action}`)
      onActionComplete()
    } catch {
      // swallow -- the refetch will show current state
    } finally {
      setActing(null)
    }
  }, [approval.id, onActionComplete])

  const handleInspect = useCallback(async () => {
    if (expanded) { setExpanded(false); return }
    if (!approval.linked_run) { setExpanded(true); return }
    setExpanded(true)
    if (explanation) return // already loaded
    setExplainLoading(true)
    try {
      const data = await apiFetch<RunExplanation>(`/api/runs/${approval.linked_run.run_id}/explain`, { method: 'GET' })
      setExplanation(data)
    } catch { /* ignore */ }
    finally { setExplainLoading(false) }
  }, [expanded, approval.linked_run, explanation])

  const variant = riskLevel === 'high' ? 'error' as const
    : riskLevel === 'medium' ? 'warning' as const
    : 'default' as const

  return (
    <DataCard variant={variant} hover={false}>
      <div className="flex items-start justify-between gap-4">
        {/* Left: content */}
        <div className="flex-1 min-w-0">
          {/* Action name + status */}
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-base font-semibold text-slate-100 tracking-tight truncate">
              {approval.action}
            </h3>
            {!isPending && <StatusBadge status={approval.status} />}
          </div>

          {/* Risk + reversibility + agent */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`inline-flex items-center border rounded-full text-xs font-medium px-2 py-0.5 ${riskColor}`}>
              {riskLevel} risk
            </span>
            {approval.risk && (
              <span className={`text-xs font-medium ${approval.risk.reversible ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                {approval.risk.reversible ? 'Reversible' : 'Irreversible'}
              </span>
            )}
            <span className="text-xs text-slate-500">
              {agentLabel(approval.agent)}
            </span>
            {approval.created_at && (
              <span className="text-xs text-slate-600">{timeAgo(approval.created_at)}</span>
            )}
          </div>

          {/* Linked run */}
          {approval.linked_run && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-500">Run:</span>
              <span className="text-xs text-slate-400 font-medium">{approval.linked_run.goal ?? approval.linked_run.run_id}</span>
              {approval.linked_run.total_steps != null && approval.linked_run.current_step != null && (
                <span className="text-xs text-slate-600 font-mono tabular-nums">
                  Step {approval.linked_run.current_step}/{approval.linked_run.total_steps}
                </span>
              )}
            </div>
          )}

          {/* Timeout consequence */}
          {isPending && approval.what_happens_if_nothing && (
            <div className="bg-slate-900/50 border border-white/5 rounded-lg px-3 py-2 mt-2">
              <p className="text-xs text-slate-400">
                <span className="text-slate-500 font-medium">If no action: </span>
                {approval.what_happens_if_nothing}
              </p>
            </div>
          )}
        </div>

        {/* Right: actions + countdown */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          {/* Time remaining */}
          {isPending && approval.time_remaining_ms != null && (
            <TimeRemaining ms={approval.time_remaining_ms} />
          )}

          {/* Buttons */}
          {isPending ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleInspect}
                className="text-xs px-3 py-1.5 rounded-lg font-medium bg-slate-700/50 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer border border-white/5"
              >
                Inspect
              </button>
              <button
                onClick={() => handleAction('reject')}
                disabled={!!acting}
                className="text-xs px-3 py-1.5 rounded-lg font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
              >
                {acting === 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
              <button
                onClick={() => handleAction('approve')}
                disabled={!!acting}
                className="text-xs px-3.5 py-1.5 rounded-lg font-medium bg-emerald-600 text-white hover:bg-emerald-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                {acting === 'approve' ? 'Approving...' : 'Approve'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleInspect}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-slate-700/50 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer border border-white/5"
            >
              {expanded ? 'Collapse' : 'Inspect'}
            </button>
          )}
        </div>
      </div>

      {/* Expandable explanation */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-white/5">
          {explainLoading ? (
            <div className="flex items-center gap-2 py-2">
              <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
              <span className="text-xs text-slate-500">Loading explanation...</span>
            </div>
          ) : explanation ? (
            <ExplanationPanel explanation={explanation} />
          ) : (
            <p className="text-xs text-slate-500">No run data available for this approval.</p>
          )}
        </div>
      )}
    </DataCard>
  )
}

/* ── Failures Tab ────────────────────────────────────────── */

function FailuresTab({
  runs, loading, onRetry,
}: {
  runs: Run[] | null
  loading: boolean
  onRetry: () => void
}) {
  if (loading && !runs) return <LoadingSpinner message="Loading failed runs..." />

  if (!runs?.length) {
    return (
      <EmptyState
        icon={<IconCheck size={28} />}
        title="No recent failures"
        subtitle="All agent runs completed successfully."
      />
    )
  }

  return (
    <div className="space-y-3">
      {runs.map(run => (
        <FailureCard key={run.run_id} run={run} onRetryComplete={onRetry} />
      ))}
    </div>
  )
}

function FailureCard({
  run, onRetryComplete,
}: {
  run: Run
  onRetryComplete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [explanation, setExplanation] = useState<RunExplanation | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [confirmRetry, setConfirmRetry] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const handleInspect = useCallback(async () => {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (explanation) return
    setExplainLoading(true)
    try {
      const data = await apiFetch<RunExplanation>(`/api/runs/${run.run_id}/explain`, { method: 'GET' })
      setExplanation(data)
    } catch { /* ignore */ }
    finally { setExplainLoading(false) }
  }, [expanded, run.run_id, explanation])

  const handleRetry = useCallback(async () => {
    // If we have explanation and outbound effects occurred, require confirmation
    if (explanation?.failure?.outbound_effects_may_have_occurred && !confirmRetry) {
      setConfirmRetry(true)
      return
    }
    setRetrying(true)
    setConfirmRetry(false)
    try {
      await apiFetch(`/api/runs/${run.run_id}/retry`)
      onRetryComplete()
    } catch { /* ignore */ }
    finally { setRetrying(false) }
  }, [run.run_id, onRetryComplete, explanation, confirmRetry])

  return (
    <>
      <DataCard variant="error" hover={false}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Agent + goal */}
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-red-400 shrink-0"><IconError size={16} /></span>
              <h3 className="text-sm font-semibold text-slate-100 tracking-tight truncate">
                {agentLabel(run.agent_id)}
              </h3>
              <StatusBadge status="failed" />
            </div>
            {run.goal && (
              <p className="text-xs text-slate-400 mb-2 ml-7">{run.goal}</p>
            )}

            {/* Error message */}
            {run.error && (
              <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2 ml-7">
                <p className="text-xs text-red-300/80 font-mono break-all">{run.error}</p>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className="text-xs text-slate-600">{timeAgo(run.started_at)}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleInspect}
                className="text-xs px-3 py-1.5 rounded-lg font-medium bg-slate-700/50 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer border border-white/5"
              >
                {expanded ? 'Collapse' : 'Inspect'}
              </button>
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="text-xs px-3 py-1.5 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                {retrying ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          </div>
        </div>

        {/* Expandable explanation */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-white/5 ml-7">
            {explainLoading ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                <span className="text-xs text-slate-500">Loading explanation...</span>
              </div>
            ) : explanation ? (
              <ExplanationPanel explanation={explanation} />
            ) : (
              <p className="text-xs text-slate-500">No explanation available.</p>
            )}
          </div>
        )}
      </DataCard>

      <ConfirmDialog
        open={confirmRetry}
        title="Retry with caution"
        message={`This run may have produced outbound effects before failing. Retrying could cause duplicate actions.`}
        warning={explanation?.failure?.probable_cause}
        confirmLabel="Retry anyway"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={handleRetry}
        onCancel={() => setConfirmRetry(false)}
      />
    </>
  )
}

/* ── Retries Tab ─────────────────────────────────────────── */

function RetriesTab({ runs, loading }: { runs: Run[] | null; loading: boolean }) {
  if (loading && !runs) return <LoadingSpinner message="Loading retry guidance..." />

  if (!runs?.length) {
    return (
      <EmptyState
        icon={<IconCheck size={28} />}
        title="Nothing to retry"
        subtitle="No failed runs require retry assessment."
      />
    )
  }

  return (
    <div className="space-y-3">
      {runs.map(run => (
        <RetryCard key={run.run_id} run={run} />
      ))}
    </div>
  )
}

function RetryCard({ run }: { run: Run }) {
  const [explanation, setExplanation] = useState<RunExplanation | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiFetch<RunExplanation>(`/api/runs/${run.run_id}/explain`, { method: 'GET' })
      .then(setExplanation)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [run.run_id])

  const failure = explanation?.failure
  const hasOutbound = failure?.outbound_effects_may_have_occurred

  return (
    <DataCard variant={hasOutbound ? 'warning' : 'default'} hover={false}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold text-slate-100 tracking-tight truncate">
              {agentLabel(run.agent_id)}
            </h3>
            {run.goal && (
              <span className="text-xs text-slate-500 truncate">{run.goal}</span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-1">
              <div className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
              <span className="text-xs text-slate-500">Assessing...</span>
            </div>
          ) : failure ? (
            <div className="space-y-2">
              {/* Probable cause */}
              <div className="bg-slate-900/50 border border-white/5 rounded-lg px-3 py-2">
                <p className="text-xs text-slate-500 font-medium mb-0.5">Probable cause</p>
                <p className="text-xs text-slate-300">{failure.probable_cause}</p>
              </div>

              {/* Outbound effects warning */}
              {hasOutbound && (
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2 flex items-start gap-2">
                  <span className="text-amber-400 shrink-0 mt-0.5"><IconWarning size={14} /></span>
                  <p className="text-xs text-amber-300/80">
                    Outbound effects may have occurred before failure. Retry with caution.
                  </p>
                </div>
              )}

              {/* Retry recommendation */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Recommendation:</span>
                <span className={`text-xs font-medium ${
                  failure.retry_recommendation === 'safe'
                    ? 'text-emerald-400'
                    : failure.retry_recommendation === 'caution'
                    ? 'text-amber-400'
                    : 'text-red-400'
                }`}>
                  {failure.retry_recommendation}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No retry guidance available for this run.</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-xs text-slate-600">{timeAgo(run.started_at)}</span>
          {failure && (
            <span className={`inline-flex items-center border rounded-full text-xs font-medium px-2 py-0.5 ${
              hasOutbound
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}>
              {hasOutbound ? 'Has side effects' : 'Safe to retry'}
            </span>
          )}
        </div>
      </div>
    </DataCard>
  )
}

/* ── Alerts Tab ──────────────────────────────────────────── */

function AlertsTab({ repair, loading }: { repair: RepairReport | null; loading: boolean }) {
  if (loading && !repair) return <LoadingSpinner message="Loading system health..." />

  if (!repair) {
    return (
      <EmptyState
        icon={<IconCheck size={28} />}
        title="No repair data"
        subtitle="Could not load system health information."
      />
    )
  }

  const banner = REPAIR_BANNER[repair.status] ?? REPAIR_BANNER.healthy

  return (
    <div>
      {/* Status banner */}
      <div className={`${banner.bg} border ${banner.border} rounded-xl px-5 py-4 mb-5 backdrop-blur-sm`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              {repair.status !== 'healthy' && (
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${banner.dot} opacity-75`} />
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${banner.dot}`} />
            </span>
            <span className={`text-sm font-semibold ${banner.text} tracking-tight`}>
              System {repair.status}
            </span>
            <span className="text-xs text-slate-500">
              {repair.checks.length} check{repair.checks.length !== 1 ? 's' : ''} evaluated
            </span>
          </div>
          <Link
            to="/recovery"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Full recovery view
          </Link>
        </div>
      </div>

      {/* Safe mode warning */}
      {repair.safe_mode && (
        <div className="bg-red-500/5 border border-red-500/15 rounded-xl px-5 py-3 mb-5 flex items-center gap-3">
          <span className="text-red-400 shrink-0"><IconWarning size={18} /></span>
          <div>
            <p className="text-sm text-red-300 font-medium">Safe mode active</p>
            <p className="text-xs text-red-400/60 mt-0.5">
              Autonomous operations are paused. Resolve critical checks to resume.
            </p>
          </div>
        </div>
      )}

      {/* Repair checks */}
      {repair.checks.length === 0 ? (
        <EmptyState
          icon={<IconCheck size={28} />}
          title="All checks passed"
          subtitle="No issues detected."
        />
      ) : (
        <div className="space-y-3">
          {repair.checks.map(check => {
            const checkColors = STATUS_COLORS[check.status] ?? STATUS_COLORS.ok
            const fixAction = repair.recommended_actions.find(a => a.check === check.name)

            return (
              <DataCard
                key={check.name}
                variant={check.status === 'critical' ? 'error' : check.status === 'warning' ? 'warning' : 'default'}
                hover={false}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className={check.status === 'ok' ? 'text-emerald-400' : check.status === 'warning' ? 'text-amber-400' : 'text-red-400'}>
                        {check.status === 'ok' ? <IconCheck size={16} /> : check.status === 'warning' ? <IconWarning size={16} /> : <IconError size={16} />}
                      </span>
                      <h3 className="text-sm font-semibold text-slate-100 tracking-tight">
                        {check.name}
                      </h3>
                      <StatusBadge status={check.status} />
                    </div>
                    <p className="text-xs text-slate-400 ml-7 mb-1">{check.message}</p>

                    {/* Fix action */}
                    {fixAction && (
                      <div className="bg-slate-900/50 border border-white/5 rounded-lg px-3 py-2 mt-2 ml-7">
                        <p className="text-xs text-slate-500 font-medium mb-0.5">Suggested fix</p>
                        <p className="text-xs text-slate-300">{fixAction.action.description}</p>
                        {fixAction.action.example && (
                          <pre className="text-[11px] text-indigo-400/80 mt-1 font-mono overflow-x-auto">
                            {fixAction.action.example}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0">
                    <span className={`inline-flex items-center border rounded-full text-xs font-medium px-2 py-0.5 ${checkColors}`}>
                      severity {check.severity}
                    </span>
                  </div>
                </div>
              </DataCard>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Shared sub-components ───────────────────────────────── */

function ExplanationPanel({ explanation }: { explanation: RunExplanation }) {
  return (
    <div className="space-y-3">
      {/* Summary */}
      <p className="text-sm text-slate-200">{explanation.summary}</p>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4">
        <Stat label="Trigger" value={explanation.trigger} />
        <Stat label="Steps" value={`${explanation.steps_completed}/${explanation.steps_total}`} />
        <Stat label="Decisions" value={String(explanation.decisions_made)} />
        <Stat label="Approvals" value={String(explanation.approvals_required)} />
        <Stat label="Outcome" value={explanation.outcome} highlight={explanation.outcome === 'failed' ? 'red' : explanation.outcome === 'completed' ? 'emerald' : undefined} />
      </div>

      {/* Data sources */}
      {explanation.data_sources.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-1">Data sources</p>
          <div className="flex flex-wrap gap-1.5">
            {explanation.data_sources.map(src => (
              <span key={src} className="text-[11px] text-slate-400 bg-slate-800 border border-white/5 px-2 py-0.5 rounded">
                {src}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Failure details */}
      {explanation.failure && (
        <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2.5">
          <p className="text-xs text-red-300/80 font-medium mb-1">Probable cause</p>
          <p className="text-xs text-red-300/60">{explanation.failure.probable_cause}</p>
          {explanation.failure.outbound_effects_may_have_occurred && (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-amber-400"><IconWarning size={12} /></span>
              <span className="text-[11px] text-amber-300/80">Outbound effects may have occurred</span>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[11px] text-slate-500">Retry:</span>
            <span className={`text-[11px] font-medium ${
              explanation.failure.retry_recommendation === 'safe' ? 'text-emerald-400'
              : explanation.failure.retry_recommendation === 'caution' ? 'text-amber-400'
              : 'text-red-400'
            }`}>
              {explanation.failure.retry_recommendation}
            </span>
          </div>
        </div>
      )}

      {/* Preview mode */}
      {explanation.preview_mode?.enabled && (
        <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg px-3 py-2">
          <p className="text-xs text-blue-300/80 font-medium mb-1">Preview mode</p>
          {explanation.preview_mode.skipped_actions.length > 0 && (
            <p className="text-xs text-blue-300/60">
              Skipped: {explanation.preview_mode.skipped_actions.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({
  label, value, highlight,
}: {
  label: string; value: string; highlight?: 'red' | 'emerald'
}) {
  const valueColor = highlight === 'red' ? 'text-red-400'
    : highlight === 'emerald' ? 'text-emerald-400'
    : 'text-slate-200'

  return (
    <div>
      <p className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</p>
      <p className={`text-xs font-medium ${valueColor}`}>{value}</p>
    </div>
  )
}

function TimeRemaining({ ms }: { ms: number }) {
  const [remaining, setRemaining] = useState(ms)

  useEffect(() => {
    setRemaining(ms)
    const interval = setInterval(() => {
      setRemaining(prev => Math.max(0, prev - 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [ms])

  const totalSecs = Math.max(0, Math.floor(remaining / 1000))
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  const isUrgent = totalSecs < 60

  return (
    <div className={`flex items-center gap-1.5 ${isUrgent ? 'text-red-400' : 'text-slate-500'}`}>
      <IconClock size={12} />
      <span className="text-xs font-mono tabular-nums">
        {mins}:{secs.toString().padStart(2, '0')}
      </span>
    </div>
  )
}
