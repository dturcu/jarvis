import { useEffect, useState, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface PortalStatus {
  client_id: string
  company: string
  contact_name: string
  engagement_status: string
  stage: string | null
  last_updated: string | null
  notes_count: number
  tags?: string[]
}

interface PortalDocument {
  id: string
  title: string
  type: string
  file_path: string
  created_at: string
  size_bytes: number
}

interface PortalMilestone {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'overdue'
  due_date: string
  completed_at: string | null
  notes: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-500/20 text-green-400'
    case 'in_progress': return 'bg-blue-500/20 text-blue-400'
    case 'overdue': return 'bg-red-500/20 text-red-400'
    case 'pending': return 'bg-yellow-500/20 text-yellow-400'
    default: return 'bg-gray-500/20 text-gray-400'
  }
}

function stageLabel(stage: string | null): string {
  if (!stage) return 'Unknown'
  return stage.charAt(0).toUpperCase() + stage.slice(1)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Portal() {
  const [token, setToken] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('token') ?? ''
  })
  const [tokenInput, setTokenInput] = useState('')
  const [status, setStatus] = useState<PortalStatus | null>(null)
  const [documents, setDocuments] = useState<PortalDocument[]>([])
  const [milestones, setMilestones] = useState<PortalMilestone[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPortalData = useCallback((portalToken: string) => {
    if (!portalToken) return
    setLoading(true)
    setError(null)

    const headers = { Authorization: `Bearer ${portalToken}` }

    Promise.all([
      fetch('/portal/api/status', { headers }).then(r => {
        if (!r.ok) throw new Error('Authentication failed')
        return r.json()
      }),
      fetch('/portal/api/documents', { headers }).then(r => r.json()),
      fetch('/portal/api/milestones', { headers }).then(r => r.json()),
    ])
      .then(([s, d, m]: [PortalStatus, { documents: PortalDocument[] }, { milestones: PortalMilestone[] }]) => {
        setStatus(s)
        setDocuments(d.documents)
        setMilestones(m.milestones)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message ?? 'Failed to load portal data')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (token) fetchPortalData(token)
  }, [token, fetchPortalData])

  const handleTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setToken(tokenInput)
  }

  // ── Token input screen ─────────────────────────────────────────────────────

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
          <h1 className="text-xl font-bold text-white mb-2">Client Portal</h1>
          <p className="text-gray-400 text-sm mb-6">
            Enter your access token to view your engagement details.
          </p>
          <form onSubmit={handleTokenSubmit}>
            <input
              type="text"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Paste your portal token"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 mb-4"
            />
            <button
              type="submit"
              disabled={!tokenInput.trim()}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Access Portal
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <p className="text-gray-400">Loading portal data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="bg-gray-900 border border-red-800 rounded-xl p-8 w-full max-w-md text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => { setToken(''); setError(null) }}
            className="text-indigo-400 hover:text-indigo-300 text-sm"
          >
            Try a different token
          </button>
        </div>
      </div>
    )
  }

  // ── Portal dashboard ───────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Thinking in Code</h1>
            <p className="text-xs text-gray-500">Client Portal</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-white">{status?.company ?? ''}</p>
            <p className="text-xs text-gray-500">{status?.contact_name ?? ''}</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* Engagement Status Card */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Engagement Status
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-gray-500 mb-1">Stage</p>
              <p className="text-lg font-semibold text-white">{stageLabel(status?.stage ?? null)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                status?.engagement_status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
              }`}>
                {status?.engagement_status ?? 'Unknown'}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Last Updated</p>
              <p className="text-sm text-white">{formatDate(status?.last_updated ?? null)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Notes</p>
              <p className="text-lg font-semibold text-white">{status?.notes_count ?? 0}</p>
            </div>
          </div>
        </section>

        {/* Documents */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Deliverable Documents
          </h2>
          {documents.length === 0 ? (
            <p className="text-gray-500 text-sm">No documents available yet.</p>
          ) : (
            <div className="space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white">{doc.title}</p>
                    <p className="text-xs text-gray-500">{doc.type} - {formatBytes(doc.size_bytes)}</p>
                  </div>
                  <p className="text-xs text-gray-500">{formatDate(doc.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Milestones Timeline */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Milestones
          </h2>
          {milestones.length === 0 ? (
            <p className="text-gray-500 text-sm">No milestones recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {milestones.map(ms => (
                <div key={ms.id} className="flex items-start gap-4 bg-gray-800/50 rounded-lg px-4 py-3">
                  <div className="mt-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor(ms.status)}`}>
                      {ms.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{ms.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Due: {formatDate(ms.due_date)}
                      {ms.completed_at && ` | Completed: ${formatDate(ms.completed_at)}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
