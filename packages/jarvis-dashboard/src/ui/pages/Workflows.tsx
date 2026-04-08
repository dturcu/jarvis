import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import SectionCard from '../shared/SectionCard.tsx'
import StatusPill from '../shared/StatusPill.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import { IconChevronLeft, IconArrowRight, IconCheck, IconWarning, IconError, IconClock } from '../shared/icons.tsx'
import type { WorkflowDefinition, WorkflowInput, WorkflowSafetyRules } from '../types/index.ts'
import { agentLabel, timeAgo } from '../types/index.ts'

/* ═══════════════════════════════════════════════════════════════
   RECENTS (localStorage)
   ═══════════════════════════════════════════════════════════════ */

const RECENTS_KEY = 'jarvis-workflow-recents'
const MAX_RECENTS = 4

function getRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]') }
  catch { return [] }
}

function pushRecent(id: string) {
  const list = getRecents().filter(r => r !== id)
  list.unshift(id)
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS))) }
  catch { /* storage full */ }
}

/* ═══════════════════════════════════════════════════════════════
   WORKFLOW GROUPING
   ═══════════════════════════════════════════════════════════════ */

const AGENT_GROUPS: Record<string, string> = {
  'contract-reviewer': 'Review & Analysis',
  'evidence-auditor': 'Review & Analysis',
  'proposal-engine': 'Review & Analysis',
  'knowledge-curator': 'Intelligence',
  'regulatory-watch': 'Intelligence',
  'orchestrator': 'Coordination',
  'self-reflection': 'Coordination',
  'staffing-monitor': 'Coordination',
}

function groupWorkflows(workflows: WorkflowDefinition[]): Array<{ group: string; items: WorkflowDefinition[] }> {
  const grouped = new Map<string, WorkflowDefinition[]>()
  for (const wf of workflows) {
    const primaryAgent = wf.agent_ids[0] ?? ''
    const group = AGENT_GROUPS[primaryAgent] ?? 'Other'
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group)!.push(wf)
  }
  return Array.from(grouped.entries()).map(([group, items]) => ({ group, items }))
}

/* ═══════════════════════════════════════════════════════════════
   RESULT TYPES
   ═══════════════════════════════════════════════════════════════ */

interface WorkflowRunResult {
  run_id: string
  workflow_id: string
  status: string
  started_at: string
  completed_at?: string | null
  error?: string
  outputs?: Record<string, unknown>
}

interface RetryGuidance {
  retry_safe: boolean
  retry_requires_approval: boolean
  message: string
}

/* ═══════════════════════════════════════════════════════════════
   PAGE VIEWS
   ═══════════════════════════════════════════════════════════════ */

type View =
  | { kind: 'catalog' }
  | { kind: 'launch'; workflowId: string }
  | { kind: 'results'; workflowId: string }

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function Workflows() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workflows, loading, error } = useApi<WorkflowDefinition[]>('/api/workflows')
  const [view, setView] = useState<View>({ kind: 'catalog' })

  useEffect(() => {
    const startId = searchParams.get('start')
    if (startId && workflows?.find(w => w.workflow_id === startId)) {
      setView({ kind: 'launch', workflowId: startId })
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, workflows, setSearchParams])

  const navigateTo = useCallback((v: View) => {
    setView(v)
    if (searchParams.has('start')) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  if (loading) return <LoadingSpinner message="Loading workflows..." />
  if (error || !workflows?.length) {
    return (
      <div className="p-6 max-w-[1100px]">
        <EmptyState
          icon={<IconError size={24} />}
          title={error ? 'Failed to load workflows' : 'No workflows available'}
          subtitle={error || 'Workflow definitions have not been configured.'}
        />
      </div>
    )
  }

  const activeWorkflow = view.kind !== 'catalog'
    ? workflows.find(w => w.workflow_id === view.workflowId) ?? null
    : null

  return (
    <div className="p-6 max-w-[1100px]">
      {/* Back nav for sub-views */}
      {view.kind !== 'catalog' && (
        <button
          onClick={() => navigateTo({ kind: 'catalog' })}
          className="inline-flex items-center gap-1.5 text-[12px] text-j-text-secondary hover:text-j-text transition-colors cursor-pointer mb-5"
        >
          <IconChevronLeft />
          All workflows
        </button>
      )}

      {view.kind === 'catalog' && <Catalog workflows={workflows} onNavigate={navigateTo} />}
      {view.kind === 'launch' && activeWorkflow && <LaunchForm workflow={activeWorkflow} onBack={() => navigateTo({ kind: 'catalog' })} />}
      {view.kind === 'results' && activeWorkflow && <ResultsView workflow={activeWorkflow} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   CATALOG
   ═══════════════════════════════════════════════════════════════ */

function Catalog({ workflows, onNavigate }: { workflows: WorkflowDefinition[]; onNavigate: (v: View) => void }) {
  const [search, setSearch] = useState('')
  const recents = getRecents()

  const recentWorkflows = useMemo(
    () => recents.map(id => workflows.find(w => w.workflow_id === id)).filter(Boolean) as WorkflowDefinition[],
    [recents, workflows],
  )

  const filtered = useMemo(
    () => search.trim()
      ? workflows.filter(wf => wf.name.toLowerCase().includes(search.toLowerCase()) || wf.expected_output.toLowerCase().includes(search.toLowerCase()))
      : workflows,
    [workflows, search],
  )

  const groups = useMemo(() => groupWorkflows(filtered), [filtered])

  return (
    <>
      {/* Search */}
      <div className="mb-5">
        <div className="bg-j-elevated border border-j-border flex items-center gap-2.5 px-4 py-2.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-j-text-muted shrink-0" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" /><path d="M9.5 9.5L13 13" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search workflows..."
            className="flex-1 bg-transparent text-[13px] text-j-text placeholder-j-text-muted outline-none font-sans"
            aria-label="Search workflows"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-j-text-muted hover:text-j-text cursor-pointer" aria-label="Clear search">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Recents */}
      {!search && recentWorkflows.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[11px] text-j-text-muted uppercase tracking-wider font-semibold mb-3 px-1">Recent</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {recentWorkflows.map(wf => (
              <button
                key={wf.workflow_id}
                onClick={() => onNavigate({ kind: 'launch', workflowId: wf.workflow_id })}
                className="bg-j-elevated border border-j-border hover:border-j-border-active px-4 py-3 text-left transition-colors cursor-pointer group"
              >
                <p className="text-[12px] font-semibold text-j-text truncate group-hover:text-j-accent transition-colors">{wf.name}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <SafetyBadge rules={wf.safety_rules} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grouped workflows */}
      {groups.map(({ group, items }) => (
        <div key={group} className="mb-6">
          <h3 className="text-[11px] text-j-text-muted uppercase tracking-wider font-semibold mb-3 px-1">{group}</h3>
          <div className="flex flex-col gap-2">
            {items.map(wf => (
              <WorkflowRow key={wf.workflow_id} workflow={wf} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <EmptyState title="No workflows match" subtitle={`No results for "${search}"`} />
      )}
    </>
  )
}

/* ── Workflow row ──────────────────────────────────────────── */

function WorkflowRow({ workflow: wf, onNavigate }: { workflow: WorkflowDefinition; onNavigate: (v: View) => void }) {
  return (
    <div className="bg-j-elevated border border-j-border hover:border-j-border-active transition-colors group">
      <div className="flex items-center gap-4 px-5 py-3.5">
        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <h4 className="text-[13px] font-semibold text-j-text truncate">{wf.name}</h4>
            <SafetyBadge rules={wf.safety_rules} />
            {wf.safety_rules.preview_available && (
              <span className="text-[10px] text-blue-400/60 bg-blue-500/8 border border-blue-500/12 px-1.5 py-0.5 font-medium">Preview</span>
            )}
          </div>
          <p className="text-[11px] text-j-text-secondary truncate">{wf.description || wf.expected_output}</p>
          <p className="text-[10px] text-j-text-muted mt-1 font-mono">
            {wf.agent_ids.map(id => agentLabel(id)).join(' · ')}
          </p>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onNavigate({ kind: 'results', workflowId: wf.workflow_id })}
            className="j-btn-secondary"
          >
            Results
          </button>
          <button
            onClick={() => onNavigate({ kind: 'launch', workflowId: wf.workflow_id })}
            className="j-btn-primary flex items-center gap-1.5"
          >
            Launch
            <IconArrowRight />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   LAUNCH FORM
   ═══════════════════════════════════════════════════════════════ */

interface FormState {
  values: Record<string, string | boolean>
  errors: Record<string, string>
  submitting: boolean
  submitted: boolean
  submitError: string | null
  result: WorkflowRunResult | null
}

function LaunchForm({ workflow, onBack }: { workflow: WorkflowDefinition; onBack: () => void }) {
  const initialValues = buildInitialValues(workflow.inputs)
  const [form, setForm] = useState<FormState>({
    values: initialValues, errors: {}, submitting: false, submitted: false, submitError: null, result: null,
  })
  const [previewMode, setPreviewMode] = useState(workflow.safety_rules.preview_recommended)

  function handleChange(key: string, value: string | boolean) {
    setForm(prev => ({
      ...prev,
      values: { ...prev.values, [key]: value },
      errors: { ...prev.errors, [key]: '' },
    }))
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    for (const input of workflow.inputs) {
      const key = fieldKey(input)
      const val = form.values[key]
      if (input.required && input.type !== 'checkbox' && (!val || (typeof val === 'string' && !val.trim()))) {
        errs[key] = `${input.label} is required`
      }
    }
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setForm(prev => ({ ...prev, errors: errs })); return }

    setForm(prev => ({ ...prev, submitting: true, submitError: null }))
    try {
      const result = await apiFetch<WorkflowRunResult>(
        `/api/workflows/${workflow.workflow_id}/start`,
        { body: { inputs: form.values, preview: previewMode } },
      )
      pushRecent(workflow.workflow_id)
      setForm(prev => ({ ...prev, submitting: false, submitted: true, result }))
    } catch (err) {
      setForm(prev => ({ ...prev, submitting: false, submitError: err instanceof Error ? err.message : 'Failed to start' }))
    }
  }

  // Success
  if (form.submitted && form.result) {
    return (
      <SectionCard accent="success">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-emerald-400"><IconCheck size={18} /></span>
          <h3 className="text-[14px] font-semibold text-j-text">Workflow launched</h3>
        </div>
        <div className="flex flex-col gap-2 ml-7">
          <InfoRow label="Workflow" value={workflow.name} />
          <InfoRow label="Run ID" value={form.result.run_id} mono />
          <InfoRow label="Status" value={form.result.status} />
          {previewMode && (
            <div className="bg-blue-500/5 border border-blue-500/10 px-3 py-2 mt-2">
              <p className="text-[11px] text-blue-300">Preview mode — no outbound actions executed.</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-j-border ml-7">
          <button onClick={onBack} className="j-btn-secondary">Back to workflows</button>
          <button
            onClick={() => setForm({ values: initialValues, errors: {}, submitting: false, submitted: false, submitError: null, result: null })}
            className="j-btn-secondary"
          >
            Launch another
          </button>
        </div>
      </SectionCard>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      {/* Mission briefing */}
      <div className="mb-5">
        <div className="flex items-center gap-3 mb-1.5">
          <h2 className="text-[16px] font-bold text-j-text tracking-tight">{workflow.name}</h2>
          <SafetyBadge rules={workflow.safety_rules} />
        </div>
        <p className="text-[12px] text-j-text-secondary">{workflow.description || workflow.expected_output}</p>
        <p className="text-[10px] text-j-text-muted mt-1 font-mono">
          Agents: {workflow.agent_ids.map(id => agentLabel(id)).join(' · ')}
        </p>
      </div>

      {/* Safety briefing */}
      <SectionCard title="Safety" className="mb-4" compact>
        <SafetyBriefing rules={workflow.safety_rules} previewMode={previewMode} />
      </SectionCard>

      {/* Inputs */}
      <SectionCard title="Inputs" className="mb-4">
        <div className="flex flex-col gap-5">
          {workflow.inputs.map(input => (
            <FormField
              key={fieldKey(input)}
              input={input}
              value={form.values[fieldKey(input)]}
              error={form.errors[fieldKey(input)]}
              onChange={val => handleChange(fieldKey(input), val)}
            />
          ))}

          {/* Preview toggle */}
          {workflow.safety_rules.preview_available && (
            <div className="pt-3 border-t border-j-border">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input type="checkbox" checked={previewMode} onChange={e => setPreviewMode(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-j-hover peer-checked:bg-j-accent rounded-full transition-colors" />
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                </div>
                <div>
                  <span className="text-[12px] font-medium text-j-text group-hover:text-j-accent transition-colors">Preview mode</span>
                  <p className="text-[10px] text-j-text-muted mt-0.5">Dry run — no outbound actions</p>
                </div>
                {workflow.safety_rules.preview_recommended && (
                  <StatusPill status="warning" label="Recommended" />
                )}
              </label>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Submit error */}
      {form.submitError && (
        <div className="bg-red-500/5 border border-red-500/15 px-4 py-3 mb-4 flex items-center gap-3">
          <span className="text-red-400 shrink-0"><IconError /></span>
          <p className="text-[12px] text-red-300">{form.submitError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={form.submitting}
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-6 py-2.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {form.submitting ? (
            <>
              <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Launching...
            </>
          ) : (
            <>
              Launch Workflow
              <IconArrowRight />
            </>
          )}
        </button>
        <button type="button" onClick={onBack} className="j-btn-secondary">Cancel</button>
      </div>
    </form>
  )
}

/* ═══════════════════════════════════════════════════════════════
   RESULTS VIEW
   ═══════════════════════════════════════════════════════════════ */

function ResultsView({ workflow }: { workflow: WorkflowDefinition }) {
  const { data: results, loading, error } = useApi<WorkflowRunResult[]>(`/api/workflows/${workflow.workflow_id}/results`)
  const { data: retryGuidance } = useApi<RetryGuidance>(`/api/workflows/${workflow.workflow_id}/retry-guidance`)

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold text-j-text tracking-tight mb-0.5">{workflow.name}</h2>
        <p className="text-[11px] text-j-text-muted">Recent runs and results</p>
      </div>

      {retryGuidance && (
        <div className={`border px-4 py-3 mb-4 flex items-center gap-2 ${
          retryGuidance.retry_safe ? 'bg-emerald-500/5 border-emerald-500/15' : 'bg-amber-500/5 border-amber-500/15'
        }`}>
          <span className={retryGuidance.retry_safe ? 'text-emerald-400' : 'text-amber-400'}>
            {retryGuidance.retry_safe ? <IconCheck size={14} /> : <IconWarning size={14} />}
          </span>
          <span className={`text-[11px] font-medium ${retryGuidance.retry_safe ? 'text-emerald-300' : 'text-amber-300'}`}>
            {retryGuidance.message}
          </span>
        </div>
      )}

      {loading && <LoadingSpinner message="Loading results..." />}
      {error && <EmptyState icon={<IconError size={24} />} title="Failed to load results" subtitle={error} />}

      {!loading && !error && (!results || results.length === 0) && (
        <EmptyState title="No runs yet" subtitle={`${workflow.name} has not been launched yet.`} />
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-2">
          {results.map(run => (
            <RunRow key={run.run_id} run={run} outputFields={workflow.output_fields} />
          ))}
        </div>
      )}
    </div>
  )
}

function RunRow({ run, outputFields }: { run: WorkflowRunResult; outputFields: WorkflowDefinition['output_fields'] }) {
  const [expanded, setExpanded] = useState(false)
  const hasOutputs = run.outputs && Object.keys(run.outputs).length > 0
  const accent = run.status === 'failed' ? 'error' as const : run.status === 'completed' ? 'success' as const : 'default' as const

  return (
    <SectionCard accent={accent}>
      <div
        className={`flex items-center justify-between ${hasOutputs ? 'cursor-pointer' : ''}`}
        onClick={() => hasOutputs && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <StatusPill status={run.status} />
          <span className="text-[10px] text-j-text-muted font-mono">{run.run_id.slice(0, 12)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-j-text-muted font-mono flex items-center gap-1">
            <IconClock size={11} />{timeAgo(run.started_at)}
          </span>
          {hasOutputs && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`text-j-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true">
              <path d="M2.5 4l3.5 3.5L9.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          )}
        </div>
      </div>

      {run.status === 'failed' && run.error && (
        <div className="mt-3 bg-red-500/5 border border-red-500/10 px-3 py-2">
          <p className="text-[11px] text-red-400 font-mono">{run.error}</p>
        </div>
      )}

      {expanded && hasOutputs && (
        <div className="mt-3 pt-3 border-t border-j-border flex flex-col gap-2">
          {outputFields.length > 0
            ? outputFields.map(f => {
                const val = run.outputs?.[f.field]
                return val !== undefined ? <InfoRow key={f.field} label={f.label} value={typeof val === 'string' ? val : JSON.stringify(val)} /> : null
              })
            : Object.entries(run.outputs!).map(([k, v]) => (
                <InfoRow key={k} label={k} value={typeof v === 'string' ? v : JSON.stringify(v)} />
              ))
          }
        </div>
      )}
    </SectionCard>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function SafetyBadge({ rules }: { rules: WorkflowSafetyRules }) {
  const styles = {
    draft: 'text-emerald-400 bg-emerald-500/8 border-emerald-500/15',
    send: 'text-amber-400 bg-amber-500/8 border-amber-500/15',
    blocked: 'text-red-400 bg-red-500/8 border-red-500/15',
  }
  const labels = { draft: 'Draft', send: 'Live', blocked: 'Blocked' }

  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide border px-2 py-0.5 ${styles[rules.outbound_default]}`}>
      {labels[rules.outbound_default]}
    </span>
  )
}

function SafetyBriefing({ rules, previewMode }: { rules: WorkflowSafetyRules; previewMode: boolean }) {
  const items: Array<{ icon: React.ReactNode; text: string; color: string }> = []

  if (previewMode) {
    items.push({ icon: <IconCheck size={13} />, text: 'Preview mode — no outbound actions', color: 'text-blue-400' })
  } else {
    const labels = { draft: 'Creates drafts only', send: 'Live execution — outbound actions will fire', blocked: 'Outbound actions blocked' }
    const colors = { draft: 'text-emerald-400', send: 'text-amber-400', blocked: 'text-red-400' }
    const icons = { draft: <IconCheck size={13} />, send: <IconWarning size={13} />, blocked: <IconError size={13} /> }
    items.push({ icon: icons[rules.outbound_default], text: labels[rules.outbound_default], color: colors[rules.outbound_default] })
  }

  if (rules.retry_safe) items.push({ icon: <IconCheck size={13} />, text: 'Safe to retry', color: 'text-emerald-400' })
  if (rules.retry_requires_approval) items.push({ icon: <IconWarning size={13} />, text: 'Retry requires approval', color: 'text-amber-400' })

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <span key={i} className={`inline-flex items-center gap-2 text-[11px] font-medium ${item.color}`}>
          {item.icon}{item.text}
        </span>
      ))}
    </div>
  )
}

function FormField({ input, value, error, onChange }: {
  input: WorkflowInput; value: string | boolean | undefined; error?: string; onChange: (val: string | boolean) => void
}) {
  const key = fieldKey(input)
  const inputCls = `w-full bg-j-surface border ${error ? 'border-red-500/30' : 'border-j-border'} px-3.5 py-2.5 text-[13px] text-j-text placeholder-j-text-muted outline-none transition-colors focus:border-j-accent/50`

  if (input.type === 'checkbox') {
    return (
      <label className="flex items-center gap-3 cursor-pointer group">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 border-j-border bg-j-surface text-j-accent focus:ring-j-accent/40 focus:ring-offset-0 cursor-pointer" />
        <span className="text-[12px] text-j-text-secondary group-hover:text-j-text transition-colors">{input.label}</span>
      </label>
    )
  }

  if (input.type === 'select') {
    return (
      <div>
        <label htmlFor={key} className="block text-[12px] font-medium text-j-text mb-1.5">
          {input.label}{input.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <select id={key} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)} className={`${inputCls} cursor-pointer`}>
          <option value="" className="bg-j-surface">{input.placeholder || `Select ${input.label.toLowerCase()}...`}</option>
          {input.options?.map(opt => <option key={opt} value={opt} className="bg-j-surface">{opt}</option>)}
        </select>
        {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <label htmlFor={key} className="block text-[12px] font-medium text-j-text mb-1.5">
        {input.label}{input.required && <span className="text-red-400 ml-0.5">*</span>}
        {input.type === 'file' && <span className="text-[10px] text-j-text-muted ml-2 font-normal">File path</span>}
      </label>
      <input id={key} type={input.type === 'date' ? 'date' : 'text'}
        value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)}
        placeholder={input.placeholder} className={inputCls} />
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-[10px] text-j-text-muted w-24 shrink-0 pt-0.5 uppercase tracking-wider">{label}</span>
      <span className={`text-[12px] text-j-text break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  )
}

function buildInitialValues(inputs: WorkflowInput[]): Record<string, string | boolean> {
  const vals: Record<string, string | boolean> = {}
  for (const input of inputs) vals[fieldKey(input)] = input.type === 'checkbox' ? false : ''
  return vals
}

function fieldKey(input: WorkflowInput): string {
  return input.field || (input as unknown as { name: string }).name || 'unknown'
}
