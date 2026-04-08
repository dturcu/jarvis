import { useEffect, useState, useCallback } from 'react'
import PageHeader from '../shared/PageHeader.tsx'
import TabBar from '../shared/TabBar.tsx'
import DataCard from '../shared/DataCard.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { IconCheck, IconWarning, IconError } from '../shared/icons.tsx'
import { useMode } from '../context/ModeContext.tsx'
import { useApi, apiFetch } from '../hooks/useApi.ts'
import type {
  AgentSetting,
  WorkflowDefinition,
  RepairReport,
  RepairCheck,
  ModelHealthReport,
} from '../types/index.ts'

/* ── Types ───────────────────────────────────────────────── */

interface Model {
  id: string
  name?: string
}

interface BackupStatus {
  last_backup?: string | null
  last_backup_at?: string | null
  path?: string | null
  last_backup_path?: string | null
  size?: number | null
  size_mb?: number | null
}

interface RestartPolicy {
  max_retries: number
  restart_delay_ms: number
  description: string
}

interface IntegrationField {
  key: string
  label: string
  help: string
  sensitive?: boolean
}

interface IntegrationDefinition {
  key: string
  label: string
  icon: string
  description: string
  fields: readonly IntegrationField[]
}

/* ── Constants ───────────────────────────────────────────── */

const TABS = [
  'General', 'Workflows', 'Agents', 'Safety',
  'Models', 'Integrations', 'Backup', 'Repair', 'Advanced',
] as const
type SettingsTab = typeof TABS[number]

const LOG_LEVELS = ['debug', 'info', 'warn', 'error']

const INTEGRATIONS: readonly IntegrationDefinition[] = [
  {
    key: 'gmail', label: 'Gmail', icon: 'M',
    description: 'Email search, read, draft, and send via Gmail API.',
    fields: [
      { key: 'client_id', label: 'Client ID', help: 'From Google Cloud Console > Credentials' },
      { key: 'client_secret', label: 'Client Secret', help: 'Keep this private — never share it', sensitive: true },
      { key: 'redirect_uri', label: 'Redirect URI', help: 'Usually http://localhost:4242/auth/callback' },
    ],
  },
  {
    key: 'calendar', label: 'Google Calendar', icon: 'C',
    description: 'Read and manage calendar events.',
    fields: [
      { key: 'client_id', label: 'Client ID', help: 'From Google Cloud Console > Credentials' },
      { key: 'client_secret', label: 'Client Secret', help: 'Keep this private', sensitive: true },
      { key: 'redirect_uri', label: 'Redirect URI', help: 'Usually http://localhost:4242/auth/callback' },
    ],
  },
  {
    key: 'chrome', label: 'Chrome MCP', icon: 'B',
    description: 'Browser automation via Chrome DevTools Protocol.',
    fields: [
      { key: 'extension_id', label: 'Extension ID', help: 'Find in chrome://extensions with Developer mode on' },
      { key: 'debug_port', label: 'Debug Port', help: 'Default: 9222' },
    ],
  },
  {
    key: 'telegram', label: 'Telegram', icon: 'T',
    description: 'Send notifications and receive commands via Telegram bot.',
    fields: [
      { key: 'bot_token', label: 'Bot Token', help: 'Get from @BotFather on Telegram', sensitive: true },
      { key: 'chat_id', label: 'Chat ID', help: 'Your personal or group chat ID' },
    ],
  },
  {
    key: 'drive', label: 'Google Drive', icon: 'D',
    description: 'Watch shared drives for new or changed documents.',
    fields: [
      { key: 'client_id', label: 'Client ID', help: 'From Google Cloud Console > Credentials' },
      { key: 'client_secret', label: 'Client Secret', help: 'Keep this private', sensitive: true },
      { key: 'redirect_uri', label: 'Redirect URI', help: 'Usually http://localhost:4242/auth/callback' },
    ],
  },
]

/* ── Helpers ─────────────────────────────────────────────── */

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
      {children}
    </h2>
  )
}

function FieldLabel({ children }: { children: string }) {
  return <label className="text-xs text-slate-500 block mb-1.5">{children}</label>
}

function TextInput({
  value, onChange, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
    />
  )
}

function SelectInput({
  value, onChange, options, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Toggle({
  checked, onChange, label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 cursor-pointer"
    >
      <div className={`shrink-0 w-10 h-5 rounded-full p-0.5 transition-colors ${
        checked ? 'bg-indigo-600' : 'bg-slate-700'
      }`}>
        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`} />
      </div>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </button>
  )
}

function SaveButton({
  saving, saved, onClick,
}: {
  saving: boolean
  saved: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={`text-sm px-5 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
        saved
          ? 'bg-emerald-900/60 text-emerald-400 border border-emerald-500/20'
          : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
      }`}
    >
      {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
    </button>
  )
}

function RepairStatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <span className="text-emerald-400"><IconCheck size={18} /></span>
  if (status === 'warning') return <span className="text-amber-400"><IconWarning size={18} /></span>
  return <span className="text-red-400"><IconError size={18} /></span>
}

/* ── Main Component ──────────────────────────────────────── */

export default function Settings() {
  const { mode, setMode } = useMode()
  const [activeTab, setActiveTab] = useState<SettingsTab>('General')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [agents, setAgents] = useState<AgentSetting[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editingIntegration, setEditingIntegration] = useState<string | null>(null)

  // Backup / Restore state
  const [restorePath, setRestorePath] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    message: string
    warning?: string
    variant: 'danger' | 'warning' | 'default'
    onConfirm: () => void
  }>({ open: false, title: '', message: '', variant: 'default', onConfirm: () => {} })

  // Secondary API data (loaded per-tab)
  const { data: workflows } = useApi<WorkflowDefinition[]>(
    activeTab === 'Workflows' || activeTab === 'Safety' ? '/api/workflows' : null
  )
  const { data: modelHealth, refetch: refetchModelHealth } = useApi<ModelHealthReport>(
    activeTab === 'Models' ? '/api/models/health' : null
  )
  const { data: backupStatus, refetch: refetchBackup } = useApi<BackupStatus>(
    activeTab === 'Backup' ? '/api/backup/status' : null
  )
  const { data: repairReport, refetch: refetchRepair } = useApi<RepairReport>(
    activeTab === 'Repair' ? '/api/repair' : null
  )
  const { data: restartPolicy } = useApi<RestartPolicy>(
    activeTab === 'Advanced' ? '/api/service/restart-policy' : null
  )

  /* ── Data fetching ───────────────────────────────────────── */

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/settings/agents').then(r => r.json()),
      fetch('/api/chat/models').then(r => r.json()).catch(() => ({ models: [] })),
    ]).then(([c, a, m]) => {
      setConfig(c ?? {})
      setAgents(a ?? [])
      const modelList = Array.isArray(m)
        ? m
        : (m?.models ?? []).map((id: string) => ({ id, name: id.split('/').pop() ?? id }))
      setModels(modelList)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  /* ── Config helpers ──────────────────────────────────────── */

  const updateConfig = (key: string, value: unknown) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const updateNestedConfig = (section: string, key: string, value: unknown) => {
    setConfig(prev => ({
      ...prev,
      [section]: { ...((prev[section] as Record<string, unknown>) ?? {}), [key]: value },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const resp = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await resp.json()
      setConfig(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* swallow */ }
    setSaving(false)
  }

  const handleToggleAgent = async (agentId: string, enabled: boolean) => {
    await fetch(`/api/settings/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, enabled } : a))
  }

  /* ── Derived ─────────────────────────────────────────────── */

  const legacyIntegrations = config.integrations as Record<string, Record<string, unknown>> | undefined
  const integrations = Object.fromEntries(
    INTEGRATIONS.map(integration => [
      integration.key,
      (config[integration.key] as Record<string, unknown> | undefined) ?? legacyIntegrations?.[integration.key] ?? {},
    ])
  ) as Record<string, Record<string, unknown>>
  const social = config.social as Record<string, unknown> | undefined
  const modelTiers = config.model_tiers as Record<string, string> | undefined
  const backupDate = backupStatus?.last_backup_at ?? backupStatus?.last_backup ?? null
  const backupPath = backupStatus?.last_backup_path ?? backupStatus?.path ?? null
  const backupSizeMb = backupStatus?.size_mb
    ?? (typeof backupStatus?.size === 'number' ? Number((backupStatus.size / (1024 * 1024)).toFixed(2)) : null)

  /* ── Loading ─────────────────────────────────────────────── */

  if (loading) {
    return <LoadingSpinner message="Loading settings..." />
  }

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Settings"
        subtitle="Configure how Jarvis behaves"
        actions={
          <SaveButton saving={saving} saved={saved} onClick={handleSave} />
        }
      />

      <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} variant="pill" />

      {/* ────────────── 1. General ────────────── */}
      {activeTab === 'General' && (
        <div className="space-y-5">
          <DataCard>
            <div className="space-y-5">
              <SectionTitle>General Configuration</SectionTitle>

              {/* UI Mode toggle */}
              <div>
                <FieldLabel>UI Mode</FieldLabel>
                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={() => setMode('simple')}
                    className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                      mode === 'simple'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                    }`}
                  >
                    Simple
                  </button>
                  <button
                    onClick={() => setMode('expert')}
                    className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                      mode === 'expert'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                    }`}
                  >
                    Expert
                  </button>
                </div>
                <p className="text-xs text-slate-600 mt-1.5">
                  Simple mode shows essential pages. Expert mode unlocks all pages.
                </p>
              </div>

              {/* LM Studio URL */}
              <div>
                <FieldLabel>LM Studio URL</FieldLabel>
                <TextInput
                  value={(config.lmstudio_url as string) ?? (config.lm_studio_url as string) ?? 'http://localhost:1234'}
                  onChange={v => setConfig(prev => {
                    const next = { ...prev, lmstudio_url: v } as Record<string, unknown> & { lm_studio_url?: unknown }
                    delete next.lm_studio_url
                    return next
                  })}
                  placeholder="http://localhost:1234"
                />
              </div>

              {/* Log Level */}
              <div>
                <FieldLabel>Log Level</FieldLabel>
                <SelectInput
                  value={(config.log_level as string) ?? 'info'}
                  onChange={v => updateConfig('log_level', v)}
                  options={LOG_LEVELS.map(l => ({ value: l, label: l }))}
                />
              </div>

              {/* Max Concurrent */}
              <div>
                <FieldLabel>
                  {`Max Concurrent Agents: ${(config.max_concurrent as number) ?? 2}`}
                </FieldLabel>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={(config.max_concurrent as number) ?? 2}
                  onChange={e => updateConfig('max_concurrent', Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
                <div className="flex justify-between text-xs text-slate-600 mt-1">
                  <span>1</span>
                  <span>8</span>
                </div>
              </div>
            </div>
          </DataCard>
        </div>
      )}

      {/* ────────────── 2. Workflows ────────────── */}
      {activeTab === 'Workflows' && (
        <div className="space-y-3">
          {!workflows || workflows.length === 0 ? (
            <DataCard>
              <p className="text-sm text-slate-500">No workflow definitions found.</p>
            </DataCard>
          ) : (
            workflows.map(wf => (
              <DataCard key={wf.workflow_id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <h3 className="text-sm font-medium text-white">{wf.name}</h3>
                      <span className="text-xs text-slate-600 font-mono">{wf.workflow_id}</span>
                    </div>
                    {wf.description && (
                      <p className="text-xs text-slate-500 mb-2">{wf.description}</p>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      <StatusBadge
                        status={wf.safety_rules.outbound_default === 'blocked' ? 'critical' : wf.safety_rules.outbound_default === 'draft' ? 'warning' : 'ok'}
                        label={`Outbound: ${wf.safety_rules.outbound_default}`}
                        size="sm"
                      />
                      {wf.safety_rules.preview_recommended && (
                        <span className="text-xs text-slate-500">Preview recommended</span>
                      )}
                      {wf.safety_rules.retry_safe && (
                        <span className="text-xs text-emerald-500/70">Retry safe</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-xs text-slate-600">
                      {wf.agent_ids.length} agent{wf.agent_ids.length !== 1 ? 's' : ''}
                    </span>
                    {wf.safety_rules.preview_available && (
                      <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full px-2 py-0.5">
                        Preview
                      </span>
                    )}
                  </div>
                </div>
              </DataCard>
            ))
          )}
          <p className="text-xs text-slate-600 mt-2">
            Workflow definitions are managed in code. This view is read-only.
          </p>
        </div>
      )}

      {/* ────────────── 3. Agents ────────────── */}
      {activeTab === 'Agents' && (
        <div className="space-y-3">
          <DataCard>
            <p className="text-xs text-slate-500">
              Enable or disable individual agents. Disabled agents will not run on schedule or be triggered by workflows.
            </p>
          </DataCard>
          {agents.length === 0 ? (
            <DataCard>
              <p className="text-sm text-slate-500">No agents registered.</p>
            </DataCard>
          ) : (
            agents.map(agent => (
              <DataCard key={agent.id} variant={agent.enabled ? 'default' : 'default'}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex rounded-full h-2 w-2 shrink-0 ${agent.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                      <h3 className="text-sm font-medium text-white">{agent.label}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        agent.enabled
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          : 'text-slate-500 bg-slate-500/10 border-slate-500/20'
                      }`}>
                        {agent.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">{agent.description}</p>
                    <div className="flex items-center gap-4 text-[11px]">
                      <span className="text-slate-600">
                        <span className="text-slate-500">Schedule:</span> {agent.schedule || 'On demand'}
                      </span>
                    </div>
                    {/* Actions row */}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
                      <a
                        href={`/history?agent=${agent.id}`}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        View history
                      </a>
                      <a
                        href={`/runs?agent=${agent.id}`}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        View runs
                      </a>
                      <a
                        href={`/inbox`}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        Pending approvals
                      </a>
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <Toggle
                      checked={agent.enabled}
                      onChange={v => handleToggleAgent(agent.id, v)}
                    />
                  </div>
                </div>
              </DataCard>
            ))
          )}
        </div>
      )}

      {/* ────────────── 4. Safety ────────────── */}
      {activeTab === 'Safety' && (
        <div className="space-y-5">
          <DataCard>
            <div className="space-y-4">
              <SectionTitle>Safety Rules</SectionTitle>
              <p className="text-xs text-slate-500">
                Safety rules are defined per-workflow in code. This is a read-only summary of the current posture.
              </p>
            </div>
          </DataCard>

          {!workflows || workflows.length === 0 ? (
            <DataCard>
              <p className="text-sm text-slate-500">No workflow definitions loaded.</p>
            </DataCard>
          ) : (
            <>
              {/* Outbound defaults summary */}
              <DataCard>
                <SectionTitle>Outbound Defaults</SectionTitle>
                <div className="mt-3 space-y-2.5">
                  {workflows.map(wf => (
                    <div key={wf.workflow_id} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{wf.name}</span>
                      <StatusBadge
                        status={
                          wf.safety_rules.outbound_default === 'blocked' ? 'critical'
                            : wf.safety_rules.outbound_default === 'draft' ? 'warning'
                            : 'ok'
                        }
                        label={wf.safety_rules.outbound_default}
                        size="sm"
                      />
                    </div>
                  ))}
                </div>
              </DataCard>

              {/* Preview recommendations */}
              <DataCard>
                <SectionTitle>Preview Recommendations</SectionTitle>
                <div className="mt-3 space-y-2.5">
                  {workflows.map(wf => (
                    <div key={wf.workflow_id} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{wf.name}</span>
                      <div className="flex items-center gap-2">
                        {wf.safety_rules.preview_available ? (
                          <span className="text-xs text-emerald-400">Available</span>
                        ) : (
                          <span className="text-xs text-slate-600">N/A</span>
                        )}
                        {wf.safety_rules.preview_recommended && (
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5">
                            Recommended
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </DataCard>

              {/* Retry policies */}
              <DataCard>
                <SectionTitle>Retry Policies</SectionTitle>
                <div className="mt-3 space-y-2.5">
                  {workflows.map(wf => (
                    <div key={wf.workflow_id} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{wf.name}</span>
                      <div className="flex items-center gap-2">
                        {wf.safety_rules.retry_safe ? (
                          <span className="text-xs text-emerald-400">Retry safe</span>
                        ) : (
                          <span className="text-xs text-red-400">Not retry safe</span>
                        )}
                        {wf.safety_rules.retry_requires_approval && (
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5">
                            Needs approval
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </DataCard>
            </>
          )}
        </div>
      )}

      {/* ────────────── 5. Models ────────────── */}
      {activeTab === 'Models' && (
        <div className="space-y-5">
          <DataCard>
            <div className="space-y-4">
              <SectionTitle>Model Configuration</SectionTitle>

              <div>
                <FieldLabel>Default Model</FieldLabel>
                <SelectInput
                  value={(config.default_model as string) ?? ''}
                  onChange={v => updateConfig('default_model', v)}
                  options={models.map(m => ({ value: m.id, label: m.name ?? m.id }))}
                  placeholder="Select a model..."
                />
              </div>

              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider pt-2">
                Inference Tiers
              </h3>
              <p className="text-xs text-slate-600 mb-2">
                Assign a model to each performance tier. Workflows select tiers based on task complexity.
              </p>
              {([
                { key: 'haiku', label: 'Fast', desc: 'Quick tasks, low cost — summaries, lookups, simple checks' },
                { key: 'sonnet', label: 'Standard', desc: 'Most workflows — analysis, drafting, monitoring' },
                { key: 'opus', label: 'Powerful', desc: 'Complex reasoning — contract review, compliance, proposals' },
              ] as const).map(tier => (
                <div key={tier.key}>
                  <FieldLabel>{tier.label}</FieldLabel>
                  <p className="text-[10px] text-slate-600 mb-1">{tier.desc}</p>
                  <SelectInput
                    value={modelTiers?.[tier.key] ?? ''}
                    onChange={v => updateNestedConfig('model_tiers', tier.key, v)}
                    options={models.map(m => ({ value: m.id, label: m.name ?? m.id }))}
                    placeholder="Default"
                  />
                </div>
              ))}
            </div>
          </DataCard>

          {/* Model Health */}
          <DataCard>
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Model Health</SectionTitle>
              <button
                onClick={() => refetchModelHealth()}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                Refresh
              </button>
            </div>
            {!modelHealth ? (
              <p className="text-sm text-slate-500">Unable to load model health.</p>
            ) : (
              <div className="space-y-3">
                {modelHealth.degraded && (
                  <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-4 py-2.5">
                    <p className="text-xs text-amber-300">One or more runtimes are degraded.</p>
                  </div>
                )}
                {modelHealth.runtimes.map(rt => (
                  <div key={rt.name} className="bg-slate-900/50 border border-white/5 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-white">{rt.name}</h4>
                        <StatusBadge
                          status={rt.connected ? 'ok' : 'critical'}
                          label={rt.connected ? 'Connected' : 'Disconnected'}
                          size="sm"
                        />
                      </div>
                      <span className="text-xs text-slate-600 font-mono">{rt.url}</span>
                    </div>
                    {rt.error && (
                      <p className="text-xs text-red-400 mb-2">{rt.error}</p>
                    )}
                    <p className="text-xs text-slate-500">
                      {rt.models.length} model{rt.models.length !== 1 ? 's' : ''} available
                    </p>
                    {rt.models.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {rt.models.map(m => (
                          <span key={m} className="text-[10px] bg-slate-800 text-slate-400 border border-white/5 rounded px-2 py-0.5 font-mono">
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </DataCard>
        </div>
      )}

      {/* ────────────── 6. Integrations ────────────── */}
      {activeTab === 'Integrations' && (
        <div className="space-y-4">
          <DataCard>
            <p className="text-xs text-slate-500">
              Connect Jarvis to external services. Each integration requires credentials — keep secrets private.
            </p>
          </DataCard>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {INTEGRATIONS.map(integration => {
              const integrationConfig = integrations?.[integration.key] ?? {}
              const isConfigured = Object.values(integrationConfig).some(value => String(value ?? '').trim().length > 0)
              const isEditing = editingIntegration === integration.key
              return (
                <DataCard key={integration.key}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold ${
                      isConfigured ? 'bg-indigo-900/60 text-indigo-400' : 'bg-slate-800 text-slate-600'
                    }`}>
                      {integration.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-white">{integration.label}</h3>
                      <span className={`text-xs ${isConfigured ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {isConfigured ? 'Connected' : 'Not set up'}
                      </span>
                    </div>
                    <button
                      onClick={() => setEditingIntegration(isEditing ? null : integration.key)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                        isEditing
                          ? 'bg-slate-700 text-slate-300'
                          : isConfigured
                          ? 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      {isEditing ? 'Cancel' : isConfigured ? 'Edit' : 'Set up'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-600 mb-3">{integration.description}</p>

                  {/* Config display (read-only) */}
                  {isConfigured && !isEditing && (
                    <div className="bg-slate-900/50 rounded-lg p-3 space-y-1.5">
                      {integration.fields.map(field => {
                        const val = String(integrationConfig[field.key] ?? '')
                        const masked = field.sensitive && val ? val.slice(0, 4) + '****' + val.slice(-4) : val
                        return (
                          <div key={field.key} className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">{field.label}</span>
                            <span className="text-slate-400 font-mono text-[11px] truncate max-w-[200px]">
                              {masked || '—'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Config form (editing) */}
                  {isEditing && (
                    <div className="space-y-3 mt-2 pt-3 border-t border-white/5">
                      {integration.fields.map(field => (
                        <div key={field.key}>
                          <label className="text-xs text-slate-400 block mb-1 font-medium">
                            {field.label}
                          </label>
                          <input
                            type={field.sensitive ? 'password' : 'text'}
                            value={String(integrationConfig[field.key] ?? '')}
                            onChange={e => {
                              setConfig(prev => ({
                                ...prev,
                                [integration.key]: {
                                  ...((prev[integration.key] as Record<string, unknown> | undefined) ?? {}),
                                  [field.key]: e.target.value,
                                },
                              }))
                            }}
                            placeholder={field.help}
                            className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                          />
                          <p className="text-[10px] text-slate-600 mt-1">{field.help}</p>
                        </div>
                      ))}
                      <button
                        onClick={() => { handleSave(); setEditingIntegration(null) }}
                        className="w-full text-xs px-3 py-2.5 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors mt-1 cursor-pointer"
                      >
                        Save {integration.label}
                      </button>
                    </div>
                  )}
                </DataCard>
              )
            })}
          </div>
        </div>
      )}

      {/* ────────────── 7. Backup & Recovery ────────────── */}
      {activeTab === 'Backup' && (
        <div className="space-y-5">
          {/* Last backup info */}
          <DataCard>
            <SectionTitle>Last Backup</SectionTitle>
            <div className="mt-3 space-y-2">
              {backupStatus ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Date</span>
                    <span className="text-sm text-slate-300">
                      {backupDate
                        ? new Date(backupDate).toLocaleString()
                        : 'Never'}
                    </span>
                  </div>
                  {backupPath && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Path</span>
                      <span className="text-xs text-slate-400 font-mono truncate max-w-[300px]">
                        {backupPath}
                      </span>
                    </div>
                  )}
                  {backupSizeMb != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Size</span>
                      <span className="text-sm text-slate-300">{backupSizeMb} MB</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No backup information available.</p>
              )}
            </div>
            <div className="mt-4">
              <button
                onClick={() => {
                  setConfirmDialog({
                    open: true,
                    title: 'Create Backup',
                    message: 'This will create a full backup of all Jarvis state databases.',
                    variant: 'default',
                    onConfirm: async () => {
                      setConfirmDialog(prev => ({ ...prev, open: false }))
                      setBackupBusy(true)
                      try {
                        await apiFetch('/api/backup', { method: 'POST' })
                        refetchBackup()
                      } catch { /* swallow */ }
                      setBackupBusy(false)
                    },
                  })
                }}
                disabled={backupBusy}
                className="text-sm px-4 py-2 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors cursor-pointer"
              >
                {backupBusy ? 'Creating...' : 'Create Backup'}
              </button>
            </div>
          </DataCard>

          {/* Restore */}
          <DataCard>
            <SectionTitle>Restore from Backup</SectionTitle>
            <p className="text-xs text-slate-500 mt-1 mb-3">
              Provide the path to a backup directory to restore. This will overwrite current state.
            </p>
            <div className="flex gap-3">
              <div className="flex-1">
                <TextInput
                  value={restorePath}
                  onChange={setRestorePath}
                  placeholder="/path/to/backup-directory"
                />
              </div>
              <button
                onClick={() => {
                  if (!restorePath.trim()) return
                  setConfirmDialog({
                    open: true,
                    title: 'Restore Backup',
                    message: `Restore from: ${restorePath}`,
                    warning: 'This will replace all current databases with the backup contents. This action cannot be undone.',
                    variant: 'danger',
                    onConfirm: async () => {
                      setConfirmDialog(prev => ({ ...prev, open: false }))
                      setBackupBusy(true)
                      try {
                        await apiFetch('/api/backup/restore', {
                          method: 'POST',
                          body: { backup_path: restorePath },
                        })
                        setRestorePath('')
                        fetchData()
                        refetchBackup()
                      } catch { /* swallow */ }
                      setBackupBusy(false)
                    },
                  })
                }}
                disabled={backupBusy || !restorePath.trim()}
                className="text-sm px-4 py-2 rounded-lg font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors cursor-pointer shrink-0"
              >
                {backupBusy ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </DataCard>
        </div>
      )}

      {/* ────────────── 8. Repair ────────────── */}
      {activeTab === 'Repair' && (
        <div className="space-y-5">
          {/* Overall status banner */}
          {repairReport ? (
            <>
              <DataCard
                variant={
                  repairReport.status === 'healthy' ? 'success'
                    : repairReport.status === 'degraded' ? 'warning'
                    : 'error'
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <RepairStatusIcon status={repairReport.status === 'healthy' ? 'ok' : repairReport.status === 'degraded' ? 'warning' : 'critical'} />
                    <div>
                      <h3 className="text-sm font-medium text-white">
                        System {repairReport.status.charAt(0).toUpperCase() + repairReport.status.slice(1)}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {repairReport.checks.filter(c => c.status === 'ok').length} / {repairReport.checks.length} checks passing
                        {repairReport.safe_mode && ' -- Safe mode active'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => refetchRepair()}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  >
                    Re-check
                  </button>
                </div>
              </DataCard>

              {/* Individual checks */}
              <div className="space-y-2">
                {repairReport.checks.map((check: RepairCheck) => (
                  <DataCard key={check.name}>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        <RepairStatusIcon status={check.status} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h4 className="text-sm font-medium text-white">{check.name}</h4>
                          <StatusBadge status={check.status} size="sm" />
                        </div>
                        <p className="text-xs text-slate-500">{check.message}</p>
                        {check.fix_action && (
                          <div className="mt-2 bg-slate-900/60 border border-white/5 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Fix</p>
                            <p className="text-xs text-slate-400">{check.fix_action.description}</p>
                            {check.fix_action.example && (
                              <p className="text-xs text-slate-600 font-mono mt-1">{check.fix_action.example}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </DataCard>
                ))}
              </div>

              {/* Recommended actions */}
              {repairReport.recommended_actions.length > 0 && (
                <DataCard variant="warning">
                  <SectionTitle>Recommended Actions</SectionTitle>
                  <div className="mt-3 space-y-3">
                    {repairReport.recommended_actions.map((ra, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className="text-xs text-amber-400 font-mono shrink-0 mt-0.5">{i + 1}.</span>
                        <div>
                          <p className="text-sm text-slate-300">{ra.check}</p>
                          <p className="text-xs text-slate-500">{ra.action.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </DataCard>
              )}
            </>
          ) : (
            <DataCard>
              <p className="text-sm text-slate-500">Unable to load repair report.</p>
            </DataCard>
          )}
        </div>
      )}

      {/* ────────────── 9. Advanced ────────────── */}
      {activeTab === 'Advanced' && (
        <div className="space-y-5">
          {/* Social limits */}
          <DataCard>
            <SectionTitle>Social Engagement Limits</SectionTitle>
            <p className="text-xs text-slate-600 mt-1 mb-4">
              Rate limits per agent run to stay within platform guidelines.
            </p>
            {[
              { key: 'likes_per_run', label: 'Likes per run', defaultVal: 10 },
              { key: 'comments_per_run', label: 'Comments per run', defaultVal: 5 },
              { key: 'reposts_per_run', label: 'Reposts per run', defaultVal: 3 },
            ].map(field => (
              <div key={field.key} className="mb-3">
                <FieldLabel>{field.label}</FieldLabel>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={(social?.[field.key] as number) ?? field.defaultVal}
                  onChange={e => updateNestedConfig('social', field.key, Number(e.target.value))}
                  className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            ))}
          </DataCard>

          {/* Restart policy */}
          <DataCard>
            <SectionTitle>Restart Policy</SectionTitle>
            {restartPolicy ? (
              <div className="mt-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Max retries</span>
                  <span className="text-sm text-slate-300">{restartPolicy.max_retries}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Restart delay</span>
                  <span className="text-sm text-slate-300">{restartPolicy.restart_delay_ms} ms</span>
                </div>
                {restartPolicy.description && (
                  <p className="text-xs text-slate-500 mt-2 pt-2 border-t border-white/5">
                    {restartPolicy.description}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 mt-2">Unable to load restart policy.</p>
            )}
          </DataCard>
        </div>
      )}

      {/* ── Confirm Dialog ─────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        warning={confirmDialog.warning}
        variant={confirmDialog.variant}
        confirmLabel={confirmDialog.variant === 'danger' ? 'Restore' : 'Confirm'}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
      />
    </div>
  )
}
