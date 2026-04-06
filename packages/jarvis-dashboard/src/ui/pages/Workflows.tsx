import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import PageHeader from '../shared/PageHeader.tsx'
import DataCard from '../shared/DataCard.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import { IconChevronLeft, IconArrowRight, IconCheck, IconWarning, IconError, IconClock } from '../shared/icons.tsx'
import type { WorkflowDefinition, WorkflowInput, WorkflowSafetyRules } from '../types/index.ts'
import { timeAgo } from '../types/index.ts'

/* ── Result types (API response shapes) ─────────────────────── */

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

/* ── Page views ─────────────────────────────────────────────── */

type View =
  | { kind: 'catalog' }
  | { kind: 'start'; workflowId: string }
  | { kind: 'results'; workflowId: string }

/* ── Main page ──────────────────────────────────────────────── */

export default function Workflows() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workflows, loading, error } = useApi<WorkflowDefinition[]>('/api/workflows')
  const [view, setView] = useState<View>({ kind: 'catalog' })

  // Handle ?start= query param on mount and when workflows load
  useEffect(() => {
    const startId = searchParams.get('start')
    if (startId && workflows) {
      const found = workflows.find(w => w.workflow_id === startId)
      if (found) {
        setView({ kind: 'start', workflowId: startId })
        // Clear param so back-nav doesn't re-trigger
        setSearchParams({}, { replace: true })
      }
    }
  }, [searchParams, workflows, setSearchParams])

  const navigateTo = useCallback((v: View) => {
    setView(v)
    // Clean up query params when navigating
    if (searchParams.has('start')) {
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  if (loading) return <LoadingSpinner message="Loading workflows..." />

  if (error) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader title="Workflows" subtitle="Launch and manage workflows" />
        <EmptyState
          icon={<IconError size={24} />}
          title="Failed to load workflows"
          subtitle={error}
        />
      </div>
    )
  }

  if (!workflows || workflows.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader title="Workflows" subtitle="Launch and manage workflows" />
        <EmptyState
          title="No workflows available"
          subtitle="Workflow definitions have not been configured yet."
        />
      </div>
    )
  }

  const activeWorkflow = view.kind !== 'catalog'
    ? workflows.find(w => w.workflow_id === view.workflowId) ?? null
    : null

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Workflows"
        subtitle="Launch and manage workflows"
        actions={view.kind !== 'catalog' ? (
          <button
            onClick={() => navigateTo({ kind: 'catalog' })}
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <IconChevronLeft />
            All workflows
          </button>
        ) : undefined}
      />

      {view.kind === 'catalog' && (
        <WorkflowCatalog workflows={workflows} onNavigate={navigateTo} />
      )}

      {view.kind === 'start' && activeWorkflow && (
        <StartForm workflow={activeWorkflow} onBack={() => navigateTo({ kind: 'catalog' })} />
      )}

      {view.kind === 'results' && activeWorkflow && (
        <ResultsView workflow={activeWorkflow} onBack={() => navigateTo({ kind: 'catalog' })} />
      )}
    </div>
  )
}

/* ── Catalog ────────────────────────────────────────────────── */

function WorkflowCatalog({
  workflows,
  onNavigate,
}: {
  workflows: WorkflowDefinition[]
  onNavigate: (v: View) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {workflows.map(wf => (
        <DataCard key={wf.workflow_id} className="flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-base font-semibold text-white leading-tight">{wf.name}</h3>
            <SafetyPostureBadge rules={wf.safety_rules} />
          </div>

          {/* Description */}
          <p className="text-sm text-slate-400 leading-relaxed mb-4 flex-1 line-clamp-3">
            {wf.description || wf.expected_output}
          </p>

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {wf.safety_rules.preview_available && (
              <span className="text-[10px] text-blue-400/70 bg-blue-500/10 border border-blue-500/15 px-2 py-0.5 rounded font-medium">
                Preview
              </span>
            )}
            {wf.safety_rules.retry_safe && (
              <span className="text-[10px] text-emerald-400/70 bg-emerald-500/10 border border-emerald-500/15 px-2 py-0.5 rounded font-medium">
                Retry safe
              </span>
            )}
          </div>

          {/* Approval summary */}
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            {wf.approval_summary}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-3 border-t border-white/5">
            <button
              onClick={() => onNavigate({ kind: 'start', workflowId: wf.workflow_id })}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-400 hover:text-white bg-indigo-600/10 hover:bg-indigo-600/30 border border-indigo-500/20 hover:border-indigo-500/40 px-4 py-2 rounded-lg transition-all duration-200 cursor-pointer"
            >
              Start
              <IconArrowRight />
            </button>
            <button
              onClick={() => onNavigate({ kind: 'results', workflowId: wf.workflow_id })}
              className="text-sm text-slate-500 hover:text-slate-300 px-3 py-2 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              Results
            </button>
          </div>
        </DataCard>
      ))}
    </div>
  )
}

/* ── Start Form ─────────────────────────────────────────────── */

interface FormState {
  values: Record<string, string | boolean>
  errors: Record<string, string>
  submitting: boolean
  submitted: boolean
  submitError: string | null
  result: WorkflowRunResult | null
}

function StartForm({
  workflow,
  onBack,
}: {
  workflow: WorkflowDefinition
  onBack: () => void
}) {
  const [form, setForm] = useState<FormState>({
    values: buildInitialValues(workflow.inputs),
    errors: {},
    submitting: false,
    submitted: false,
    submitError: null,
    result: null,
  })
  const [previewMode, setPreviewMode] = useState(workflow.safety_rules.preview_recommended)

  function buildInitialValues(inputs: WorkflowInput[]): Record<string, string | boolean> {
    const vals: Record<string, string | boolean> = {}
    for (const input of inputs) {
      const key = inputFieldKey(input)
      vals[key] = input.type === 'checkbox' ? false : ''
    }
    return vals
  }

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
      const key = inputFieldKey(input)
      const val = form.values[key]
      if (input.required) {
        if (input.type === 'checkbox') {
          // checkboxes are optional regardless
        } else if (!val || (typeof val === 'string' && val.trim() === '')) {
          errs[key] = `${input.label} is required`
        }
      }
    }
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setForm(prev => ({ ...prev, errors: errs }))
      return
    }

    setForm(prev => ({ ...prev, submitting: true, submitError: null }))

    try {
      const body: Record<string, unknown> = {
        inputs: form.values,
        preview: previewMode,
      }
      const result = await apiFetch<WorkflowRunResult>(
        `/api/workflows/${workflow.workflow_id}/start`,
        { body }
      )
      setForm(prev => ({ ...prev, submitting: false, submitted: true, result }))
    } catch (err) {
      setForm(prev => ({
        ...prev,
        submitting: false,
        submitError: err instanceof Error ? err.message : 'Workflow failed to start',
      }))
    }
  }

  // Success state
  if (form.submitted && form.result) {
    return (
      <div className="max-w-2xl">
        <DataCard variant="success">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-emerald-400"><IconCheck size={20} /></span>
            <h3 className="text-lg font-semibold text-white">Workflow Started</h3>
          </div>
          <div className="space-y-3">
            <InfoRow label="Workflow" value={workflow.name} />
            <InfoRow label="Run ID" value={form.result.run_id} mono />
            <InfoRow label="Status" value={form.result.status} />
            {previewMode && (
              <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg px-4 py-2.5 mt-3">
                <p className="text-xs text-blue-300">
                  Running in preview mode -- no outbound actions will be executed.
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 mt-6 pt-4 border-t border-white/5">
            <button
              onClick={onBack}
              className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              Back to workflows
            </button>
            <button
              onClick={() => setForm({
                values: buildInitialValues(workflow.inputs),
                errors: {},
                submitting: false,
                submitted: false,
                submitError: null,
                result: null,
              })}
              className="text-sm text-indigo-400 hover:text-white px-4 py-2 rounded-lg hover:bg-indigo-600/20 transition-colors cursor-pointer"
            >
              Start another
            </button>
          </div>
        </DataCard>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      {/* Workflow header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-xl font-bold text-white">{workflow.name}</h2>
          <SafetyPostureBadge rules={workflow.safety_rules} />
        </div>
        <p className="text-sm text-slate-400">{workflow.description || workflow.expected_output}</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <DataCard>
          <div className="space-y-5">
            {workflow.inputs.map(input => {
              const key = inputFieldKey(input)
              return (
                <FormField
                  key={key}
                  input={input}
                  value={form.values[key]}
                  error={form.errors[key]}
                  onChange={(val) => handleChange(key, val)}
                />
              )
            })}

            {/* Preview toggle */}
            {workflow.safety_rules.preview_available && (
              <div className="pt-3 border-t border-white/5">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={previewMode}
                      onChange={e => setPreviewMode(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-700 peer-checked:bg-indigo-600 rounded-full transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                      Preview mode
                    </span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Dry run without outbound actions
                    </p>
                  </div>
                  {workflow.safety_rules.preview_recommended && (
                    <span className="text-[10px] text-amber-400/70 bg-amber-500/10 border border-amber-500/15 px-2 py-0.5 rounded font-medium ml-auto">
                      Recommended
                    </span>
                  )}
                </label>
              </div>
            )}
          </div>
        </DataCard>

        {/* Safety summary bar */}
        <SafetySummaryBar rules={workflow.safety_rules} previewMode={previewMode} />

        {/* Submit error */}
        {form.submitError && (
          <div className="bg-red-500/5 border border-red-500/15 rounded-xl px-5 py-3 mt-4 flex items-center gap-3">
            <span className="text-red-400 shrink-0"><IconError /></span>
            <p className="text-sm text-red-300">{form.submitError}</p>
          </div>
        )}

        {/* Submit button */}
        <div className="flex items-center gap-3 mt-6">
          <button
            type="submit"
            disabled={form.submitting}
            className="inline-flex items-center gap-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:text-white/50 px-6 py-2.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {form.submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Starting...
              </>
            ) : (
              <>
                Start Workflow
                <IconArrowRight />
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2.5 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

/* ── Form Field ─────────────────────────────────────────────── */

function FormField({
  input,
  value,
  error,
  onChange,
}: {
  input: WorkflowInput
  value: string | boolean | undefined
  error?: string
  onChange: (val: string | boolean) => void
}) {
  const key = inputFieldKey(input)
  const baseInputClasses =
    'w-full bg-slate-900/60 border rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/60 transition-colors'
  const errorBorder = error ? 'border-red-500/40' : 'border-white/10'

  if (input.type === 'checkbox') {
    return (
      <label className="flex items-center gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={!!value}
          onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 rounded border-white/20 bg-slate-900/60 text-indigo-600 focus:ring-indigo-500/40 focus:ring-offset-0 cursor-pointer"
        />
        <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">
          {input.label}
        </span>
        {input.required && <span className="text-red-400 text-xs">*</span>}
      </label>
    )
  }

  if (input.type === 'select') {
    return (
      <div>
        <label htmlFor={key} className="block text-sm font-medium text-slate-300 mb-1.5">
          {input.label}
          {input.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <select
          id={key}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          className={`${baseInputClasses} ${errorBorder} cursor-pointer`}
        >
          <option value="" className="bg-slate-900">
            {input.placeholder || `Select ${input.label.toLowerCase()}...`}
          </option>
          {input.options?.map(opt => (
            <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
          ))}
        </select>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    )
  }

  if (input.type === 'date') {
    return (
      <div>
        <label htmlFor={key} className="block text-sm font-medium text-slate-300 mb-1.5">
          {input.label}
          {input.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <input
          id={key}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          className={`${baseInputClasses} ${errorBorder}`}
        />
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    )
  }

  // text, file (rendered as text input for file path)
  return (
    <div>
      <label htmlFor={key} className="block text-sm font-medium text-slate-300 mb-1.5">
        {input.label}
        {input.required && <span className="text-red-400 ml-0.5">*</span>}
        {input.type === 'file' && (
          <span className="text-xs text-slate-600 ml-2 font-normal">File path</span>
        )}
      </label>
      <input
        id={key}
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={e => onChange(e.target.value)}
        placeholder={input.placeholder}
        className={`${baseInputClasses} ${errorBorder}`}
      />
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}

/* ── Safety Summary Bar ─────────────────────────────────────── */

function SafetySummaryBar({
  rules,
  previewMode,
}: {
  rules: WorkflowSafetyRules
  previewMode: boolean
}) {
  const items: Array<{ icon: React.ReactNode; text: string; color: string }> = []

  if (previewMode) {
    items.push({
      icon: <IconCheck size={14} />,
      text: 'Preview mode -- no outbound actions',
      color: 'text-blue-400',
    })
  } else {
    const outboundLabels = {
      draft: 'Outbound actions create drafts only',
      send: 'Outbound actions will execute live',
      blocked: 'Outbound actions are blocked',
    }
    const outboundColors = { draft: 'text-emerald-400', send: 'text-amber-400', blocked: 'text-red-400' }
    const outboundIcons = {
      draft: <IconCheck size={14} />,
      send: <IconWarning size={14} />,
      blocked: <IconError size={14} />,
    }
    items.push({
      icon: outboundIcons[rules.outbound_default],
      text: outboundLabels[rules.outbound_default],
      color: outboundColors[rules.outbound_default],
    })
  }

  if (rules.retry_safe) {
    items.push({ icon: <IconCheck size={14} />, text: 'Safe to retry', color: 'text-emerald-400' })
  }
  if (rules.retry_requires_approval) {
    items.push({ icon: <IconWarning size={14} />, text: 'Retry requires approval', color: 'text-amber-400' })
  }

  return (
    <div className="bg-slate-800/30 border border-white/5 rounded-xl px-5 py-3 mt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {items.map((item, i) => (
          <span key={i} className={`inline-flex items-center gap-1.5 text-xs ${item.color}`}>
            {item.icon}
            {item.text}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Results View ───────────────────────────────────────────── */

function ResultsView({
  workflow,
  onBack,
}: {
  workflow: WorkflowDefinition
  onBack: () => void
}) {
  const { data: results, loading, error } = useApi<WorkflowRunResult[]>(
    `/api/workflows/${workflow.workflow_id}/results`
  )
  const { data: retryGuidance } = useApi<RetryGuidance>(
    `/api/workflows/${workflow.workflow_id}/retry-guidance`
  )

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white mb-1">{workflow.name}</h2>
        <p className="text-sm text-slate-500">Recent runs and results</p>
      </div>

      {/* Retry guidance */}
      {retryGuidance && (
        <div className={`border rounded-xl px-5 py-3 mb-5 backdrop-blur-sm ${
          retryGuidance.retry_safe
            ? 'bg-emerald-500/5 border-emerald-500/15'
            : 'bg-amber-500/5 border-amber-500/15'
        }`}>
          <div className="flex items-center gap-2">
            <span className={retryGuidance.retry_safe ? 'text-emerald-400' : 'text-amber-400'}>
              {retryGuidance.retry_safe ? <IconCheck size={14} /> : <IconWarning size={14} />}
            </span>
            <span className={`text-xs font-medium ${
              retryGuidance.retry_safe ? 'text-emerald-300' : 'text-amber-300'
            }`}>
              {retryGuidance.message}
            </span>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && <LoadingSpinner message="Loading results..." />}

      {/* Error */}
      {error && (
        <EmptyState
          icon={<IconError size={24} />}
          title="Failed to load results"
          subtitle={error}
        />
      )}

      {/* Empty */}
      {!loading && !error && (!results || results.length === 0) && (
        <EmptyState
          title="No runs yet"
          subtitle={`${workflow.name} has not been started yet.`}
          action={
            <button
              onClick={onBack}
              className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
            >
              Back to workflows
            </button>
          }
        />
      )}

      {/* Results list */}
      {results && results.length > 0 && (
        <div className="space-y-3">
          {results.map(run => (
            <RunCard key={run.run_id} run={run} outputFields={workflow.output_fields} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Run Card ───────────────────────────────────────────────── */

function RunCard({
  run,
  outputFields,
}: {
  run: WorkflowRunResult
  outputFields: WorkflowDefinition['output_fields']
}) {
  const [expanded, setExpanded] = useState(false)

  const hasOutputs = run.outputs && Object.keys(run.outputs).length > 0

  return (
    <DataCard
      variant={run.status === 'failed' ? 'error' : run.status === 'completed' ? 'success' : 'default'}
      hover={false}
    >
      <div
        className={`flex items-center justify-between ${hasOutputs ? 'cursor-pointer' : ''}`}
        onClick={() => hasOutputs && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <StatusBadge status={run.status} />
          <span className="text-xs text-slate-500 font-mono">{run.run_id.slice(0, 12)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <IconClock size={12} />
              {timeAgo(run.started_at)}
            </span>
          </span>
          {hasOutputs && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className={`text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            >
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>

      {/* Error message */}
      {run.status === 'failed' && run.error && (
        <div className="mt-3 bg-red-500/5 border border-red-500/10 rounded-lg px-3.5 py-2.5">
          <p className="text-xs text-red-400">{run.error}</p>
        </div>
      )}

      {/* Expanded outputs */}
      {expanded && hasOutputs && (
        <div className="mt-4 pt-4 border-t border-white/5 space-y-2.5">
          {outputFields.length > 0 ? (
            outputFields.map(field => {
              const val = run.outputs?.[field.field]
              if (val === undefined) return null
              return (
                <InfoRow
                  key={field.field}
                  label={field.label}
                  value={typeof val === 'string' ? val : JSON.stringify(val)}
                />
              )
            })
          ) : (
            Object.entries(run.outputs!).map(([k, v]) => (
              <InfoRow
                key={k}
                label={k}
                value={typeof v === 'string' ? v : JSON.stringify(v)}
              />
            ))
          )}
        </div>
      )}
    </DataCard>
  )
}

/* ── Shared sub-components ──────────────────────────────────── */

function SafetyPostureBadge({ rules }: { rules: WorkflowSafetyRules }) {
  const styles = {
    draft: 'text-emerald-400/80 bg-emerald-500/10 border-emerald-500/15',
    send: 'text-amber-400/80 bg-amber-500/10 border-amber-500/15',
    blocked: 'text-red-400/80 bg-red-500/10 border-red-500/15',
  }
  const labels = { draft: 'Draft', send: 'Live', blocked: 'Blocked' }

  return (
    <span className={`text-[10px] font-medium border px-2 py-0.5 rounded ${styles[rules.outbound_default]}`}>
      {labels[rules.outbound_default]}
    </span>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-slate-500 w-24 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm text-slate-300 break-all ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  )
}

/* ── Utilities ──────────────────────────────────────────────── */

/** Handle both `field` and `name` on WorkflowInput. Runtime uses `name`, types declare `field`. */
function inputFieldKey(input: WorkflowInput): string {
  return input.field || (input as unknown as { name: string }).name || 'unknown'
}
