import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import SectionCard from '../shared/SectionCard.tsx'
import StatusPill from '../shared/StatusPill.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { IconWarning, IconError, IconCheck, IconClock } from '../shared/icons.tsx'
import { usePolling } from '../hooks/usePolling.ts'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import type { EnrichedApproval, Run, RunExplanation, RepairReport, RepairCheck, FixAction } from '../types/index.ts'
import { agentLabel, timeAgo } from '../types/index.ts'

/* ═══════════════════════════════════════════════════════════════
   UNIFIED QUEUE — normalize all item types into one priority stream
   ═══════════════════════════════════════════════════════════════ */

type ItemKind = 'approval' | 'failure' | 'alert'

interface QueueItem {
  id: string
  kind: ItemKind
  priority: number          // lower = more urgent
  approval?: EnrichedApproval
  failure?: Run
  alert?: { check: RepairCheck; fix: FixAction | null }
}

function prioritize(approval: EnrichedApproval): number {
  if (approval.status !== 'pending') return 900
  const risk = approval.risk?.level ?? 'low'
  if (risk === 'high') return 100
  if (risk === 'medium') return 200
  return 300
}

function buildQueue(
  approvals: EnrichedApproval[] | null,
  failures: Run[] | null,
  repair: RepairReport | null,
): QueueItem[] {
  const items: QueueItem[] = []

  approvals?.forEach(a => {
    items.push({ id: `apr-${a.id}`, kind: 'approval', priority: prioritize(a), approval: a })
  })

  failures?.forEach(r => {
    items.push({ id: `fail-${r.run_id}`, kind: 'failure', priority: 150, failure: r })
  })

  repair?.checks
    .filter(c => c.status !== 'ok')
    .forEach(c => {
      const fix = repair.recommended_actions.find(a => a.check === c.name)?.action ?? null
      const pri = c.status === 'critical' ? 120 : 250
      items.push({ id: `alert-${c.name}`, kind: 'alert', priority: pri, alert: { check: c, fix } })
    })

  items.sort((a, b) => a.priority - b.priority)
  return items
}

/* ═══════════════════════════════════════════════════════════════
   FILTER CHIPS
   ═══════════════════════════════════════════════════════════════ */

type Filter = 'all' | 'approval' | 'failure' | 'alert'

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All', approval: 'Approvals', failure: 'Failures', alert: 'Alerts',
}

function FilterChip({ filter, active, count, onClick }: {
  filter: Filter; active: boolean; count: number; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`text-[11px] px-3 py-1.5 font-semibold uppercase tracking-wide transition-colors cursor-pointer border ${
        active
          ? 'text-j-accent bg-j-accent-glow border-j-accent/20'
          : 'text-j-text-secondary bg-j-surface border-j-border hover:text-j-text hover:border-j-border-active'
      }`}
    >
      {FILTER_LABELS[filter]}
      {count > 0 && (
        <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center inline-block leading-none ${
          active ? 'bg-j-accent/20 text-j-accent' : 'bg-j-hover text-j-text-muted'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════
   INBOX PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function Inbox() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlFilter = searchParams.get('filter') as Filter | null
  // Support legacy ?tab=Failures links
  const urlTab = searchParams.get('tab')
  const initialFilter: Filter = urlFilter
    ?? (urlTab === 'Failures' ? 'failure' : urlTab === 'Alerts' ? 'alert' : 'all')
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [showResolved, setShowResolved] = useState(false)

  // Data
  const approvalsUrl = showResolved ? '/api/approvals' : '/api/approvals?status=pending'
  const { data: approvals, loading: loadingApprovals, refetch: refetchApprovals } = usePolling<EnrichedApproval[]>(approvalsUrl, 10_000)
  const { data: failedRuns, loading: loadingFailures, refetch: refetchFailures } = useApi<Run[]>('/api/runs/failed')
  const { data: repair, loading: loadingRepair } = useApi<RepairReport>('/api/repair')

  const loading = (loadingApprovals && !approvals) && (loadingFailures && !failedRuns) && (loadingRepair && !repair)

  // Build + filter queue
  const queue = useMemo(() => buildQueue(approvals, failedRuns, repair), [approvals, failedRuns, repair])
  const filtered = useMemo(
    () => filter === 'all' ? queue : queue.filter(i => i.kind === filter),
    [queue, filter],
  )

  // Counts
  const counts = useMemo(() => ({
    all: queue.length,
    approval: queue.filter(i => i.kind === 'approval').length,
    failure: queue.filter(i => i.kind === 'failure').length,
    alert: queue.filter(i => i.kind === 'alert').length,
  }), [queue])

  const handleFilter = useCallback((f: Filter) => {
    setFilter(f)
    setSearchParams(f === 'all' ? {} : { filter: f })
  }, [setSearchParams])

  // Sync from URL changes
  useEffect(() => {
    const f = searchParams.get('filter') as Filter | null
    if (f && f !== filter) setFilter(f)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const refetchAll = useCallback(() => {
    refetchApprovals()
    refetchFailures()
  }, [refetchApprovals, refetchFailures])

  if (loading) return <LoadingSpinner message="Loading inbox..." />

  return (
    <div className="p-6 max-w-[1100px]">
      {/* Summary strip */}
      <div className="bg-j-elevated border border-j-border px-5 py-3 flex items-center justify-between mb-4">
        <div className="flex items-center gap-4 text-[11px] font-mono">
          {counts.approval > 0 && (
            <span className="text-amber-400">{counts.approval} approval{counts.approval !== 1 ? 's' : ''}</span>
          )}
          {counts.failure > 0 && (
            <span className="text-red-400">{counts.failure} failure{counts.failure !== 1 ? 's' : ''}</span>
          )}
          {counts.alert > 0 && (
            <span className="text-j-accent">{counts.alert} alert{counts.alert !== 1 ? 's' : ''}</span>
          )}
          {counts.all === 0 && (
            <span className="text-emerald-400">All clear</span>
          )}
        </div>
        <button
          onClick={() => setShowResolved(!showResolved)}
          className={`text-[10px] font-medium transition-colors cursor-pointer ${
            showResolved ? 'text-j-accent' : 'text-j-text-muted hover:text-j-text-secondary'
          }`}
        >
          {showResolved ? 'Hide resolved' : 'Show resolved'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 mb-5" role="group" aria-label="Filter inbox items">
        {(['all', 'approval', 'failure', 'alert'] as Filter[]).map(f => (
          <FilterChip key={f} filter={f} active={filter === f} count={counts[f]} onClick={() => handleFilter(f)} />
        ))}
      </div>

      {/* Queue */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<IconCheck size={28} />}
          title={filter === 'all' ? 'Inbox clear' : `No ${FILTER_LABELS[filter].toLowerCase()}`}
          subtitle="Nothing needs your attention right now."
        />
      ) : (
        <div className="flex flex-col gap-3" role="list" aria-label="Inbox items">
          {filtered.map(item => (
            <div key={item.id} role="listitem">
              {item.kind === 'approval' && item.approval && (
                <ApprovalItem approval={item.approval} onAction={refetchAll} />
              )}
              {item.kind === 'failure' && item.failure && (
                <FailureItem run={item.failure} onRetry={refetchAll} />
              )}
              {item.kind === 'alert' && item.alert && (
                <AlertItem check={item.alert.check} fix={item.alert.fix} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   APPROVAL ITEM
   ═══════════════════════════════════════════════════════════════ */

function ApprovalItem({ approval, onAction }: { approval: EnrichedApproval; onAction: () => void }) {
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [explanation, setExplanation] = useState<RunExplanation | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)

  const isPending = approval.status === 'pending'
  const riskLevel = approval.risk?.level ?? 'low'
  const accent = riskLevel === 'high' ? 'error' as const : riskLevel === 'medium' ? 'warn' as const : 'default' as const

  const handleAction = useCallback(async (action: 'approve' | 'reject') => {
    setActing(action)
    try { await apiFetch(`/api/approvals/${approval.id}/${action}`) }
    catch { /* refetch shows state */ }
    finally { setActing(null); onAction() }
  }, [approval.id, onAction])

  const handleInspect = useCallback(async () => {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (explanation || !approval.linked_run) return
    setExplainLoading(true)
    try {
      setExplanation(await apiFetch<RunExplanation>(`/api/runs/${approval.linked_run.run_id}/explain`, { method: 'GET' }))
    } catch { /* ignore */ }
    finally { setExplainLoading(false) }
  }, [expanded, approval.linked_run, explanation])

  return (
    <SectionCard accent={accent}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Type + action */}
          <div className="flex items-center gap-2.5 mb-2">
            <span className={riskLevel === 'high' ? 'text-red-400' : riskLevel === 'medium' ? 'text-amber-400' : 'text-j-text-secondary'}>
              <IconWarning size={14} />
            </span>
            <StatusPill status={isPending ? 'awaiting_approval' : approval.status} label={isPending ? 'Approval' : undefined} />
            <h3 className="text-[13px] font-semibold text-j-text tracking-tight truncate">{approval.action}</h3>
            {!isPending && <StatusPill status={approval.status} />}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 ml-6 mb-2 text-[11px]">
            <span className={`font-semibold ${
              riskLevel === 'high' ? 'text-red-400' : riskLevel === 'medium' ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {riskLevel} risk
            </span>
            {approval.risk && (
              <span className={approval.risk.reversible ? 'text-emerald-400/60' : 'text-red-400/60'}>
                {approval.risk.reversible ? 'reversible' : 'irreversible'}
              </span>
            )}
            <span className="text-j-text-muted">·</span>
            <span className="text-j-text-secondary">{agentLabel(approval.agent)}</span>
            {approval.created_at && (
              <>
                <span className="text-j-text-muted">·</span>
                <span className="text-j-text-muted font-mono">{timeAgo(approval.created_at)}</span>
              </>
            )}
          </div>

          {/* Linked run */}
          {approval.linked_run && (
            <p className="text-[11px] text-j-text-muted ml-6 mb-2 font-mono">
              Run: {approval.linked_run.goal ?? approval.linked_run.run_id}
              {approval.linked_run.total_steps != null && approval.linked_run.current_step != null && (
                <span className="ml-2">step {approval.linked_run.current_step}/{approval.linked_run.total_steps}</span>
              )}
            </p>
          )}

          {/* Timeout consequence */}
          {isPending && approval.what_happens_if_nothing && (
            <div className="bg-j-surface border border-j-border px-3 py-2 ml-6 mt-1">
              <p className="text-[11px] text-j-text-secondary">
                <span className="text-j-text-muted font-medium">If no action: </span>
                {approval.what_happens_if_nothing}
              </p>
            </div>
          )}
        </div>

        {/* Right: timer + actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          {isPending && approval.time_remaining_ms != null && (
            <TimeRemaining ms={approval.time_remaining_ms} />
          )}
          {isPending ? (
            <div className="flex items-center gap-2">
              <button onClick={handleInspect} className="j-btn-secondary">{expanded ? 'Collapse' : 'Inspect'}</button>
              <button onClick={() => handleAction('reject')} disabled={!!acting} className="j-btn-danger">
                {acting === 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
              <button onClick={() => handleAction('approve')} disabled={!!acting} className="j-btn-primary">
                {acting === 'approve' ? 'Approving...' : 'Approve'}
              </button>
            </div>
          ) : (
            <button onClick={handleInspect} className="j-btn-secondary">{expanded ? 'Collapse' : 'Inspect'}</button>
          )}
        </div>
      </div>

      {/* Expandable */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-j-border ml-6">
          {explainLoading ? <Spinner /> : explanation ? <ExplanationPanel explanation={explanation} /> : (
            <p className="text-[11px] text-j-text-muted">No run data available.</p>
          )}
        </div>
      )}
    </SectionCard>
  )
}

/* ═══════════════════════════════════════════════════════════════
   FAILURE ITEM
   ═══════════════════════════════════════════════════════════════ */

function FailureItem({ run, onRetry }: { run: Run; onRetry: () => void }) {
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
    try { setExplanation(await apiFetch<RunExplanation>(`/api/runs/${run.run_id}/explain`, { method: 'GET' })) }
    catch { /* ignore */ }
    finally { setExplainLoading(false) }
  }, [expanded, run.run_id, explanation])

  const handleRetry = useCallback(async () => {
    if (explanation?.failure?.outbound_effects_may_have_occurred && !confirmRetry) {
      setConfirmRetry(true)
      return
    }
    setRetrying(true)
    setConfirmRetry(false)
    try { await apiFetch(`/api/runs/${run.run_id}/retry`) }
    catch { /* ignore */ }
    finally { setRetrying(false); onRetry() }
  }, [run.run_id, onRetry, explanation, confirmRetry])

  return (
    <>
      <SectionCard accent="error">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-red-400"><IconError size={14} /></span>
              <StatusPill status="failed" />
              <h3 className="text-[13px] font-semibold text-j-text tracking-tight truncate">{agentLabel(run.agent_id)}</h3>
            </div>

            {run.goal && (
              <p className="text-[11px] text-j-text-secondary ml-6 mb-2">{run.goal}</p>
            )}

            {run.error && (
              <div className="bg-red-500/5 border border-red-500/10 px-3 py-2 ml-6">
                <p className="text-[11px] text-red-300/80 font-mono break-all">{run.error}</p>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className="text-[10px] font-mono text-j-text-muted">{timeAgo(run.started_at)}</span>
            <div className="flex items-center gap-2">
              <button onClick={handleInspect} className="j-btn-secondary">{expanded ? 'Collapse' : 'Inspect'}</button>
              <button onClick={handleRetry} disabled={retrying} className="j-btn-primary">
                {retrying ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-j-border ml-6">
            {explainLoading ? <Spinner /> : explanation ? <ExplanationPanel explanation={explanation} /> : (
              <p className="text-[11px] text-j-text-muted">No explanation available.</p>
            )}
          </div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={confirmRetry}
        title="Retry with caution"
        message="This run may have produced outbound effects before failing. Retrying could cause duplicate actions."
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

/* ═══════════════════════════════════════════════════════════════
   ALERT ITEM
   ═══════════════════════════════════════════════════════════════ */

function AlertItem({ check, fix }: { check: RepairCheck; fix: FixAction | null }) {
  const [expanded, setExpanded] = useState(false)
  const isCritical = check.status === 'critical'

  return (
    <SectionCard accent={isCritical ? 'error' : 'warn'}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-2">
            <span className={isCritical ? 'text-red-400' : 'text-amber-400'}>
              {isCritical ? <IconError size={14} /> : <IconWarning size={14} />}
            </span>
            <StatusPill status={check.status} />
            <h3 className="text-[13px] font-semibold text-j-text tracking-tight">{check.name}</h3>
          </div>
          <p className="text-[11px] text-j-text-secondary ml-6">{check.message}</p>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-[10px] font-mono text-j-text-muted">severity {check.severity}</span>
          <div className="flex items-center gap-2">
            {fix && (
              <button onClick={() => setExpanded(!expanded)} className="j-btn-secondary">
                {expanded ? 'Collapse' : 'Fix'}
              </button>
            )}
            <Link to="/recovery" className="j-btn-secondary">Recovery</Link>
          </div>
        </div>
      </div>

      {expanded && fix && (
        <div className="mt-4 pt-4 border-t border-j-border ml-6">
          <p className="text-[11px] text-j-text-secondary mb-1 font-medium">Suggested fix</p>
          <p className="text-[11px] text-j-text">{fix.description}</p>
          {fix.example && (
            <pre className="text-[10px] text-j-accent/80 mt-1.5 font-mono overflow-x-auto">{fix.example}</pre>
          )}
        </div>
      )}
    </SectionCard>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SHARED SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function ExplanationPanel({ explanation }: { explanation: RunExplanation }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-j-text">{explanation.summary}</p>

      {/* Stats */}
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
          <p className="text-[10px] text-j-text-muted font-medium mb-1 uppercase tracking-wider">Data sources</p>
          <div className="flex flex-wrap gap-1.5">
            {explanation.data_sources.map(src => (
              <span key={src} className="text-[10px] text-j-text-secondary bg-j-surface border border-j-border px-2 py-0.5">
                {src}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Failure */}
      {explanation.failure && (
        <div className="bg-red-500/5 border border-red-500/10 px-3 py-2.5">
          <p className="text-[10px] text-red-300/80 font-medium mb-1">Probable cause</p>
          <p className="text-[11px] text-red-300/60">{explanation.failure.probable_cause}</p>
          {explanation.failure.outbound_effects_may_have_occurred && (
            <div className="flex items-center gap-1.5 mt-2">
              <IconWarning size={12} />
              <span className="text-[10px] text-amber-300/80">Outbound effects may have occurred</span>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] text-j-text-muted">Retry:</span>
            <span className={`text-[10px] font-medium ${
              explanation.failure.retry_recommendation === 'safe' ? 'text-emerald-400'
              : explanation.failure.retry_recommendation === 'caution' ? 'text-amber-400'
              : 'text-red-400'
            }`}>{explanation.failure.retry_recommendation}</span>
          </div>
        </div>
      )}

      {/* Preview mode */}
      {explanation.preview_mode?.enabled && (
        <div className="bg-blue-500/5 border border-blue-500/10 px-3 py-2">
          <p className="text-[10px] text-blue-300/80 font-medium mb-1">Preview mode</p>
          {explanation.preview_mode.skipped_actions.length > 0 && (
            <p className="text-[10px] text-blue-300/60">Skipped: {explanation.preview_mode.skipped_actions.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: 'red' | 'emerald' }) {
  return (
    <div>
      <p className="text-[10px] text-j-text-muted uppercase tracking-wider">{label}</p>
      <p className={`text-[11px] font-medium ${
        highlight === 'red' ? 'text-red-400' : highlight === 'emerald' ? 'text-emerald-400' : 'text-j-text'
      }`}>{value}</p>
    </div>
  )
}

function TimeRemaining({ ms }: { ms: number }) {
  const [remaining, setRemaining] = useState(ms)

  useEffect(() => {
    setRemaining(ms)
    const interval = setInterval(() => setRemaining(prev => Math.max(0, prev - 1000)), 1000)
    return () => clearInterval(interval)
  }, [ms])

  const totalSecs = Math.max(0, Math.floor(remaining / 1000))
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  const isUrgent = totalSecs < 60

  return (
    <div className={`flex items-center gap-1.5 ${isUrgent ? 'text-red-400' : 'text-j-text-muted'}`} aria-label={`${mins} minutes ${secs} seconds remaining`}>
      <IconClock size={12} />
      <span className="text-[11px] font-mono tabular-nums">{mins}:{secs.toString().padStart(2, '0')}</span>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="size-3 border-2 border-j-accent/30 border-t-j-accent rounded-full animate-spin" />
      <span className="text-[11px] text-j-text-muted">Loading...</span>
    </div>
  )
}
