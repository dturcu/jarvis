import { useState, useCallback, useEffect } from 'react'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import PageHeader from '../shared/PageHeader.tsx'
import DataCard from '../shared/DataCard.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import { IconWarning } from '../shared/icons.tsx'
import type { ModelInfo, ModelHealthReport, AvailableModel } from '../types/index.ts'
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
  const { data: health, loading: healthLoading, error: healthError, refetch: refetchHealth } =
    useApi<ModelHealthReport>('/api/models/health')
  const { data: mappings, loading: mappingsLoading } =
    useApi<WorkflowMapping[]>('/api/models/workflow-mapping')

  const [toggling, setToggling] = useState<string | null>(null)
  const [loadModalRuntime, setLoadModalRuntime] = useState<string | null>(null)

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

  const handleModelLoaded = useCallback(() => {
    refetchHealth()
    refetchModels()
  }, [refetchHealth, refetchModels])

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
        <RuntimeHealthSection
          runtimes={runtimes}
          error={healthError}
          onLoadModel={setLoadModalRuntime}
          onModelChanged={handleModelLoaded}
        />
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

      {/* ── Model Load Modal ────────────────────────────────── */}
      {loadModalRuntime && (
        <ModelLoadModal
          runtime={loadModalRuntime}
          onClose={() => setLoadModalRuntime(null)}
          onLoaded={handleModelLoaded}
        />
      )}
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
  onLoadModel,
  onModelChanged,
}: {
  runtimes: ModelHealthReport['runtimes']
  error: string | null
  onLoadModel: (runtime: string) => void
  onModelChanged: () => void
}) {
  const [unloading, setUnloading] = useState<string | null>(null)

  const handleUnload = useCallback(async (runtime: string, model: string) => {
    const key = `${runtime}/${model}`
    setUnloading(key)
    try {
      await apiFetch(`/api/runtimes/${encodeURIComponent(runtime)}/unload`, {
        method: 'POST',
        body: { model },
      })
      onModelChanged()
    } catch {
      // unload failed silently
    } finally {
      setUnloading(null)
    }
  }, [onModelChanged])

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                <div className="flex items-center gap-2">
                  {rt.connected && (
                    <button
                      onClick={() => onLoadModel(rt.name)}
                      className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/50 rounded-md px-2 py-0.5 transition-colors cursor-pointer"
                    >
                      Load Model
                    </button>
                  )}
                  <StatusBadge
                    status={rt.connected ? 'ok' : 'critical'}
                    label={rt.connected ? 'Connected' : 'Down'}
                    size="sm"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-600 font-mono mb-2 truncate">{rt.url}</p>

              {rt.error && (
                <p className="text-[11px] text-red-400 mb-2 truncate">{rt.error}</p>
              )}

              {(rt.models ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {(rt.models ?? []).map(m => {
                    const key = `${rt.name}/${m}`
                    const isUnloading = unloading === key
                    return (
                      <span
                        key={m}
                        className="group text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-mono inline-flex items-center gap-1"
                      >
                        {m}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnload(rt.name, m); }}
                          disabled={isUnloading}
                          className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity ml-0.5 cursor-pointer disabled:cursor-not-allowed"
                          title="Unload model"
                        >
                          {isUnloading ? (
                            <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="20" strokeDashoffset="10" /></svg>
                          ) : (
                            <svg className="w-2.5 h-2.5" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                          )}
                        </button>
                      </span>
                    )
                  })}
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

/* ── Model Load Modal ────────────────────────────────────── */

function ModelLoadModal({
  runtime,
  onClose,
  onLoaded,
}: {
  runtime: string
  onClose: () => void
  onLoaded: () => void
}) {
  const [models, setModels] = useState<AvailableModel[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingModel, setLoadingModel] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    apiFetch<{ ok: boolean; models: AvailableModel[]; error?: string }>(
      `/api/runtimes/${encodeURIComponent(runtime)}/available-models`
    )
      .then(res => {
        setModels(res.models ?? [])
      })
      .catch(err => {
        setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [runtime])

  const handleLoad = useCallback(async (model: AvailableModel) => {
    const modelRef = model.path ?? model.id
    setLoadingModel(model.id)
    setLoadError(null)
    try {
      await apiFetch(`/api/runtimes/${encodeURIComponent(runtime)}/load`, {
        method: 'POST',
        body: { model: modelRef },
      })
      onLoaded()
      onClose()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingModel(null)
    }
  }, [runtime, onLoaded, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      {/* modal */}
      <div
        className="relative bg-slate-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Load Model</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Select a model to load into <span className="font-mono text-slate-400">{runtime}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer">
            <svg className="w-4 h-4" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loadError && (
            <div className="mb-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
              {loadError}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner message="Scanning available models..." />
            </div>
          ) : !models || models.length === 0 ? (
            <EmptyState
              title="No models found"
              subtitle={runtime === 'ollama' ? 'Pull models with: ollama pull <model>' : 'No GGUF files found in configured directories.'}
            />
          ) : (
            <div className="space-y-1.5">
              {models.map(model => {
                const isLoading = loadingModel === model.id
                return (
                  <div
                    key={model.path ?? model.id}
                    className="flex items-center justify-between bg-slate-800/40 hover:bg-slate-800/70 border border-white/5 rounded-lg px-3 py-2.5 transition-colors"
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <p className="text-xs text-slate-200 font-mono truncate">{model.id}</p>
                      {model.size && (
                        <p className="text-[10px] text-slate-500 mt-0.5">{model.size}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleLoad(model)}
                      disabled={!!loadingModel}
                      className="shrink-0 text-[10px] font-medium text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 rounded-md px-3 py-1 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                    >
                      {isLoading ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="20" strokeDashoffset="10" /></svg>
                          Loading...
                        </>
                      ) : (
                        'Load'
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Table Components ────────────────────────────────────── */

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
                  <tr key={key} className="border-b border-white/[0.03] last:border-0">
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
