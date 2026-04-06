import { useEffect, useState, useCallback } from 'react'

interface AgentSetting {
  id: string
  label: string
  description: string
  schedule: string
  enabled: boolean
}

interface Model {
  id: string
  name?: string
}

const TABS = ['General', 'Models', 'Agents', 'Integrations', 'Social'] as const
type SettingsTab = typeof TABS[number]

const LOG_LEVELS = ['debug', 'info', 'warn', 'error']

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('General')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [agents, setAgents] = useState<AgentSetting[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/settings/agents').then(r => r.json()),
      fetch('/api/chat/models').then(r => r.json()).catch(() => ({ models: [] })),
    ]).then(([c, a, m]) => {
      setConfig(c ?? {})
      setAgents(a ?? [])
      const modelList = Array.isArray(m) ? m : (m?.models ?? []).map((id: string) => ({ id, name: id.split('/').pop() ?? id }))
      setModels(modelList)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const updateConfig = (key: string, value: unknown) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const updateNestedConfig = (section: string, key: string, value: unknown) => {
    setConfig(prev => ({
      ...prev,
      [section]: { ...((prev[section] as Record<string, unknown>) ?? {}), [key]: value }
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const resp = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      const data = await resp.json()
      setConfig(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
    setSaving(false)
  }

  const handleToggleAgent = async (agentId: string, enabled: boolean) => {
    await fetch(`/api/settings/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, enabled } : a))
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
  }

  const integrations = config.integrations as Record<string, Record<string, unknown>> | undefined
  const social = config.social as Record<string, unknown> | undefined
  const modelTiers = config.model_tiers as Record<string, string> | undefined
  const [editingIntegration, setEditingIntegration] = useState<string | null>(null)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`text-sm px-5 py-2 rounded-lg font-medium transition-colors ${
            saved
              ? 'bg-green-900 text-green-400'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
          }`}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-6">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors ${
              activeTab === tab
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'General' && (
        <div className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">General Configuration</h2>

            <div>
              <label className="text-xs text-gray-500 block mb-1.5">LM Studio URL</label>
              <input
                value={(config.lm_studio_url as string) ?? 'http://localhost:1234'}
                onChange={e => updateConfig('lm_studio_url', e.target.value)}
                className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="http://localhost:1234"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1.5">Log Level</label>
              <select
                value={(config.log_level as string) ?? 'info'}
                onChange={e => updateConfig('log_level', e.target.value)}
                className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-300 focus:outline-none focus:border-indigo-500"
              >
                {LOG_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1.5">
                Max Concurrent Agents: {(config.max_concurrent as number) ?? 2}
              </label>
              <input
                type="range"
                min="1"
                max="8"
                value={(config.max_concurrent as number) ?? 2}
                onChange={e => updateConfig('max_concurrent', Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>1</span>
                <span>8</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Models Tab */}
      {activeTab === 'Models' && (
        <div className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Model Configuration</h2>

            <div>
              <label className="text-xs text-gray-500 block mb-1.5">Default Model</label>
              <select
                value={(config.default_model as string) ?? ''}
                onChange={e => updateConfig('default_model', e.target.value)}
                className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select a model...</option>
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                ))}
              </select>
            </div>

            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider pt-2">Tier Mapping</h3>
            {['haiku', 'sonnet', 'opus'].map(tier => (
              <div key={tier}>
                <label className="text-xs text-gray-500 block mb-1.5 capitalize">{tier}</label>
                <select
                  value={modelTiers?.[tier] ?? ''}
                  onChange={e => updateNestedConfig('model_tiers', tier, e.target.value)}
                  className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Default</option>
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agents Tab */}
      {activeTab === 'Agents' && (
        <div className="space-y-2">
          {agents.map(agent => (
            <div
              key={agent.id}
              className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-sm font-medium text-white">{agent.label}</h3>
                  <span className="text-xs text-gray-600 font-mono">{agent.id}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{agent.description}</span>
                </div>
                <p className="text-xs text-gray-600 mt-0.5">{agent.schedule}</p>
              </div>
              <button
                onClick={() => handleToggleAgent(agent.id, !agent.enabled)}
                className={`shrink-0 w-12 h-6 rounded-full p-0.5 transition-colors ${
                  agent.enabled ? 'bg-indigo-600' : 'bg-gray-700'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                    agent.enabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'Integrations' && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { key: 'gmail', label: 'Gmail', icon: 'M', fields: ['client_id', 'client_secret', 'redirect_uri'] },
            { key: 'calendar', label: 'Google Calendar', icon: 'C', fields: ['client_id', 'client_secret', 'redirect_uri'] },
            { key: 'chrome', label: 'Chrome MCP', icon: 'B', fields: ['extension_id', 'debug_port'] },
            { key: 'telegram', label: 'Telegram', icon: 'T', fields: ['bot_token', 'chat_id'] },
            { key: 'drive', label: 'Google Drive', icon: 'D', fields: ['client_id', 'client_secret', 'redirect_uri'] },
          ].map(integration => {
            const integrationConfig = integrations?.[integration.key] ?? {}
            const isConfigured = Object.keys(integrationConfig).length > 0
            const isEditing = editingIntegration === integration.key
            return (
              <div
                key={integration.key}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                    isConfigured ? 'bg-indigo-900 text-indigo-400' : 'bg-gray-800 text-gray-600'
                  }`}>
                    {integration.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-white">{integration.label}</h3>
                    <span className={`text-xs ${isConfigured ? 'text-green-400' : 'text-gray-600'}`}>
                      {isConfigured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                  <button
                    onClick={() => setEditingIntegration(isEditing ? null : integration.key)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      isEditing
                        ? 'bg-gray-700 text-gray-300'
                        : isConfigured
                        ? 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {isEditing ? 'Cancel' : isConfigured ? 'Edit' : 'Configure'}
                  </button>
                </div>

                {/* Config display (read-only) */}
                {isConfigured && !isEditing && (
                  <div className="space-y-1">
                    {Object.entries(integrationConfig).map(([k, v]) => (
                      <div key={k} className="text-xs">
                        <span className="text-gray-600">{k}: </span>
                        <span className="text-gray-400 font-mono">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Config form (editing) */}
                {isEditing && (
                  <div className="space-y-2.5 mt-2 pt-3 border-t border-gray-800">
                    {integration.fields.map(field => (
                      <div key={field}>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">{field.replace(/_/g, ' ')}</label>
                        <input
                          value={String(integrationConfig[field] ?? '')}
                          onChange={e => {
                            const current = (config.integrations ?? {}) as Record<string, Record<string, unknown>>
                            const updated = {
                              ...current,
                              [integration.key]: { ...(current[integration.key] ?? {}), [field]: e.target.value }
                            }
                            setConfig(prev => ({ ...prev, integrations: updated }))
                          }}
                          placeholder={`Enter ${field.replace(/_/g, ' ')}`}
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => { handleSave(); setEditingIntegration(null) }}
                      className="w-full text-xs px-3 py-2 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors mt-1"
                    >
                      Save Integration
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Social Tab */}
      {activeTab === 'Social' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Social Engagement Limits</h2>
          <p className="text-xs text-gray-600">Rate limits per agent run to stay within platform guidelines.</p>

          {[
            { key: 'likes_per_run', label: 'Likes per run', defaultVal: 10 },
            { key: 'comments_per_run', label: 'Comments per run', defaultVal: 5 },
            { key: 'reposts_per_run', label: 'Reposts per run', defaultVal: 3 },
          ].map(field => (
            <div key={field.key}>
              <label className="text-xs text-gray-500 block mb-1.5">{field.label}</label>
              <input
                type="number"
                min="0"
                max="50"
                value={(social?.[field.key] as number) ?? field.defaultVal}
                onChange={e => updateNestedConfig('social', field.key, Number(e.target.value))}
                className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-300 focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
