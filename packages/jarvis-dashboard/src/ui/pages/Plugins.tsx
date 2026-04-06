import { useState, useEffect, useCallback } from 'react'

interface ConfigStatus {
  integration: string
  configured: boolean
}

interface PluginData {
  id: string
  name: string
  version: string
  description: string
  agent: { agent_id?: string; label?: string }
  config_requirements?: string[]
  config_status: ConfigStatus[]
  installed_at: string
}

export default function Plugins() {
  const [plugins, setPlugins] = useState<PluginData[]>([])
  const [loading, setLoading] = useState(true)
  const [showInstall, setShowInstall] = useState(false)
  const [installPath, setInstallPath] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [uninstalling, setUninstalling] = useState<string | null>(null)

  const fetchPlugins = useCallback(() => {
    fetch('/api/plugins')
      .then(r => r.json())
      .then((data: PluginData[]) => {
        setPlugins(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchPlugins()
  }, [fetchPlugins])

  const handleInstall = async () => {
    if (!installPath.trim()) return
    setInstalling(true)
    setInstallError(null)

    try {
      const res = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: installPath.trim() }),
      })
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) {
        setInstallError(data.error ?? 'Install failed')
      } else {
        setInstallPath('')
        setShowInstall(false)
        fetchPlugins()
      }
    } catch {
      setInstallError('Network error')
    } finally {
      setInstalling(false)
    }
  }

  const handleUninstall = async (pluginId: string) => {
    setUninstalling(pluginId)
    try {
      await fetch(`/api/plugins/${pluginId}`, { method: 'DELETE' })
      fetchPlugins()
    } finally {
      setUninstalling(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading...
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-white">Plugins</h1>
        <button
          onClick={() => { setShowInstall(!showInstall); setInstallError(null) }}
          className="text-sm px-4 py-2 rounded-lg font-medium bg-indigo-700 hover:bg-indigo-600 text-white transition-colors"
        >
          {showInstall ? 'Cancel' : 'Install Plugin'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {plugins.length} plugin{plugins.length !== 1 ? 's' : ''} installed.
        Plugins extend Jarvis with additional agents and capabilities.
      </p>

      {/* Install modal */}
      {showInstall && (
        <div className="mb-6 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-3">Install from local path</h3>
          <p className="text-xs text-gray-500 mb-3">
            Enter the path to a plugin directory containing a manifest.json file.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={installPath}
              onChange={e => setInstallPath(e.target.value)}
              placeholder="/path/to/plugin"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              onKeyDown={e => { if (e.key === 'Enter') handleInstall() }}
            />
            <button
              onClick={handleInstall}
              disabled={installing || !installPath.trim()}
              className="text-sm px-4 py-2 rounded-lg font-medium bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {installing ? 'Installing...' : 'Install'}
            </button>
          </div>
          {installError && (
            <p className="mt-2 text-xs text-red-400">{installError}</p>
          )}
        </div>
      )}

      {/* Plugin list */}
      {plugins.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-8 text-center">
          <p className="text-gray-500 text-sm">No plugins installed yet.</p>
          <p className="text-gray-600 text-xs mt-1">
            Click "Install Plugin" to add one from a local directory.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {plugins.map(plugin => (
            <div
              key={plugin.id}
              className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-medium text-white">{plugin.name}</h3>
                    <span className="text-xs text-gray-600 font-mono">v{plugin.version}</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">{plugin.description}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    {plugin.agent?.agent_id && (
                      <span>Agent: <span className="text-gray-400 font-mono">{plugin.agent.agent_id}</span></span>
                    )}
                    <span>Installed: <span className="text-gray-400">{new Date(plugin.installed_at).toLocaleDateString()}</span></span>
                  </div>
                  {/* Config requirements badges */}
                  {plugin.config_status.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {plugin.config_status.map(cs => (
                        <span
                          key={cs.integration}
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            cs.configured
                              ? 'bg-green-900/50 text-green-400 border border-green-800/50'
                              : 'bg-red-900/50 text-red-400 border border-red-800/50'
                          }`}
                        >
                          {cs.integration}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleUninstall(plugin.id)}
                  disabled={uninstalling === plugin.id}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium bg-red-900/50 hover:bg-red-800/60 text-red-400 border border-red-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uninstalling === plugin.id ? 'Removing...' : 'Uninstall'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
