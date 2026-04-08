import { useState, useCallback } from 'react'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import PageHeader from '../shared/PageHeader.tsx'
import DataCard from '../shared/DataCard.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import { IconWarning } from '../shared/icons.tsx'
import type { ModelInfo, ModelHealthReport } from '../types/index.ts'
import { timeAgo } from '../types/index.ts'

/* ── Page-local types ────────────────────────────────────── */

interface WorkflowMapping {
  workflow_id: string
  agent_id: string
  inference_tier: string
}

/* ── Main Component ──────────────────────────────────────── */

export default function Models() {
  const { data: models, loading: modelsLoading, refetch: refetchModels } =
    useApi<ModelInfo[]>('/api/models')
  const { data: health, loading: healthLoading, error: healthError } =
    useApi<ModelHealthReport>('/api/models/health')
  const { data: mappings, loading: mappingsLoading } =
    useApi<WorkflowMapping[]>('/api/models/workflow-mapping')

  const [toggling, setToggling] = useState<string | null>(null)

  const handleToggle = useCallback(async (model: ModelInfo) => {
    if (!model.runtime) return
    const key = `${model.runtime}/${model.id}`
    setToggling(key)
    try {
      await apiFetch(`/api/models/${encodeURIComponent(model.runtime)}/${encodeURIComponent(model.id)}`, {
        method: 'PATCH',
        body: { enabled: !model.enabled },
      })
      refetchModels()
    } catch {
      // toggle failed silently — user sees stale state until next refetch
    } finally {
      setToggling(null)
    }
  }, [refetchModels])

  const loading = modelsLoading || healthLoading || mappingsLoading
  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader title="Models" subtitle="Model registry and runtime health" />
        <LoadingSpinner message="Loading model data..." />
      </div>
    )
  }

  const degraded = health?.degraded ?? false
  const runtimes = health?.runtimes ?? []
  const modelList = models ?? []
  const workflowMappings = mappings ?? []

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Models"
        subtitle="Model registry and runtime health"
        actions={
          <StatusBadge
            status={degraded ? 'degraded' : 'healthy'}
            label={degraded ? 'Degraded' : 'All Healthy'}
            pulse={degraded}
            variant="dot"
            size="md"
          />
        }
      />

      {/* ── Degradation Banner ───────────────────────────────── */}
      {degraded && <DegradationBanner runtimes={runtimes} />}

      {/* ── Runtime Health ───────────────────────────────────── */}
      <div className="mb-6">
        <RuntimeHealthSection runtimes={runtimes} error={healthError} />
      </div>

      {/* ── Model Registry ───────────────────────────────────── */}
      <div className="mb-6">
        <ModelRegistryTable
          models={modelList}
          toggling={toggling}
          onToggle={handleToggle}
        />
      </div>

      {/* ── Workflow Mapping ─────────────────────────────────── */}
      <div className="mb-6">
        <WorkflowMappingTable mappings={workflowMappings} />
      </div>
    </div>
  )
}

/* ── Section Components ──────────────────────────────────── */

function DegradationBanner({ runtimes }: { runtimes: ModelHealthReport['runtimes'] }) {
  const disconnected = runtimes.filter(r => !r.connected)
  return (
    <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-4 flex items-start gap-3">
      <span className="text-amber-400 mt-0.5 shrink-0"><IconWarning size={18} /></span>
      <div>
        <p className="text-sm font-medium text-amber-300">Model service degraded</p>
        <p className="text-xs text-amber-300/60 mt-1">
          {disconnected.length} runtime{disconnected.length !== 1 ? 's' : ''} disconnected
          {disconnected.length > 0 && `: ${disconnected.map(r => r.name).join(', ')}`}
        </p>
      </div>
    </div>
  )
}

function RuntimeHealthSection({
  runtimes,
  error,
}: {
  runtimes: ModelHealthReport['runtimes']
  error: string | null
}) {
  return (
    <DataCard hover={false}>
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
        Runtime Health
      </h2>

      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : runtimes.length === 0 ? (
        <EmptyState title="No runtimes configured" subtitle="Add model runtimes to enable agent execution." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {runtimes.map(rt => (
            <div
              key={rt.name}
              className="bg-slate-900/40 border border-white/5 rounded-lg px-4 py-3"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2 w-2 shrink-0">
                    {rt.connected && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${rt.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  </span>
                  <span className="text-sm font-medium text-slate-200 truncate">{rt.name}</span>
                </div>
                <StatusBadge
                  status={rt.connected ? 'ok' : 'critical'}
                  label={rt.connected ? 'Connected' : 'Down'}
                  size="sm"
                />
              </div>

              <p className="text-[11px] text-slate-600 font-mono mb-2 truncate">{rt.url}</p>

              {rt.error && (
                <p className="text-[11px] text-red-400 mb-2 truncate">{rt.error}</p>
              )}

              {(rt.models ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {(rt.models ?? []).map(m => (
                    <span
                      key={m}
                      className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-mono"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-600">No models loaded</p>
              )}
            </div>
          ))}
        </div>
      )}
    </DataCard>
  )
}

function ModelRegistryTable({
  models,
  toggling,
  onToggle,
}: {
  models: ModelInfo[]
  toggling: string | null
  onToggle: (model: ModelInfo) => void
}) {
  return (
    <DataCard hover={false}>
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
        Model Registry
      </h2>

      {models.length === 0 ? (
        <EmptyState title="No models registered" subtitle="Models appear here when runtimes report them." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Model ID</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Runtime</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Tags</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Last Seen</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 text-right">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {models.map(model => {
                const key = `${model.runtime ?? ''}/${model.id}`
                const isToggling = toggling === key
                return (
                  <tr key={model.id} className="border-b border-white/[0.03] last:border-0">
                    <td className="py-2.5 pr-4">
                      <span className="text-sm text-slate-200 font-mono">{model.id}</span>
                      {model.name && model.name !== model.id && (
                        <span className="text-[11px] text-slate-600 ml-2">{model.name}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-xs text-slate-400 font-mono">{model.runtime ?? '--'}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {(model.capabilities ?? []).map(tag => (
                          <span
                            key={tag}
                            className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded-md"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-xs text-slate-500">{timeAgo(model.last_seen_at ?? null)}</span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => onToggle(model)}
                        disabled={isToggling || !model.runtime}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        style={{ backgroundColor: model.enabled ? 'rgb(16 185 129 / 0.6)' : 'rgb(51 65 85 / 0.6)' }}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            model.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </DataCard>
  )
}

function WorkflowMappingTable({ mappings }: { mappings: WorkflowMapping[] }) {
  const tierColors: Record<string, string> = {
    opus: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    sonnet: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    haiku: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  }

  return (
    <DataCard hover={false}>
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
        Workflow Mapping
      </h2>

      {mappings.length === 0 ? (
        <EmptyState title="No workflow mappings" subtitle="Workflow-to-model tier mappings will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Workflow</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2 pr-4">Agent</th>
                <th className="text-[10px] text-slate-600 uppercase tracking-wider pb-2">Inference Tier</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map(m => (
                <tr key={`${m.workflow_id}-${m.agent_id}`} className="border-b border-white/[0.03] last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="text-sm text-slate-200 font-mono">{m.workflow_id}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-xs text-slate-400">{m.agent_id}</span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex items-center text-[10px] font-medium border rounded-full px-2 py-0.5 ${
                      tierColors[m.inference_tier] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>
                      {m.inference_tier}
                    </span>
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
