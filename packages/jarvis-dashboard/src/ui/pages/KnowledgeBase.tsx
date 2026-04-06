import { useEffect, useState, useCallback } from 'react'
import DocumentViewer from '../components/DocumentViewer.tsx'

interface DocSummary {
  doc_id: string
  title: string
  collection: string
  created_at: string
  excerpt?: string
}

interface FullDocument {
  doc_id: string
  title: string
  content: string
  collection: string
  created_at: string
}

interface Playbook {
  playbook_id?: string | number
  name: string
  description?: string
  use_count?: number
  last_used_at?: string | null
  created_at?: string
  [key: string]: unknown
}

interface KnowledgeStats {
  total: number
  collections: Array<{ collection: string; count: number }>
  playbooks: number
}

const COLLECTIONS = ['all', 'lessons', 'playbooks', 'iso26262', 'contracts', 'proposals', 'case-studies', 'garden']

const COLLECTION_COLORS: Record<string, string> = {
  lessons: 'bg-blue-900 text-blue-300',
  playbooks: 'bg-purple-900 text-purple-300',
  iso26262: 'bg-orange-900 text-orange-300',
  contracts: 'bg-red-900 text-red-300',
  proposals: 'bg-green-900 text-green-300',
  'case-studies': 'bg-teal-900 text-teal-300',
  garden: 'bg-lime-900 text-lime-300'
}

const TABS = ['Documents', 'Recent', 'Playbooks'] as const
type Tab = typeof TABS[number]

/** Highlight matched terms in text by wrapping them in <strong> */
function highlightText(text: string, query: string): JSX.Element {
  if (!query.trim()) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <strong key={i} className="text-indigo-400 font-semibold">{part}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

export default function KnowledgeBase() {
  const [query, setQuery] = useState('')
  const [activeCol, setActiveCol] = useState('all')
  const [activeTab, setActiveTab] = useState<Tab>('Documents')
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [recentDocs, setRecentDocs] = useState<DocSummary[]>([])
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [stats, setStats] = useState<KnowledgeStats | null>(null)
  const [viewDoc, setViewDoc] = useState<FullDocument | null>(null)
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  // Fetch stats on mount
  useEffect(() => {
    fetch('/api/knowledge/stats')
      .then(r => r.json())
      .then((data: KnowledgeStats) => setStats(data))
      .catch(() => {})
  }, [])

  // Fetch playbooks on mount
  useEffect(() => {
    fetch('/api/knowledge/playbooks')
      .then(r => r.json())
      .then((data: Playbook[]) => setPlaybooks(data))
      .catch(() => {})
  }, [])

  // Fetch recent docs on mount
  useEffect(() => {
    fetch('/api/knowledge/recent')
      .then(r => r.json())
      .then((data: DocSummary[]) => setRecentDocs(data))
      .catch(() => {})
  }, [])

  const search = useCallback((q: string, col: string) => {
    if (!q.trim()) {
      // Load collection browse
      const url = col === 'all'
        ? '/api/knowledge/search?q=.'
        : `/api/knowledge/collection/${col}`
      setLoading(true)
      fetch(url)
        .then(r => r.json())
        .then((data: DocSummary[]) => { setDocs(data); setLoading(false) })
        .catch(() => setLoading(false))
      return
    }
    const url = `/api/knowledge/search?q=${encodeURIComponent(q)}${col !== 'all' ? `&col=${col}` : ''}`
    setLoading(true)
    fetch(url)
      .then(r => r.json())
      .then((data: DocSummary[]) => { setDocs(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (activeTab === 'Documents') {
      const t = setTimeout(() => search(query, activeCol), 300)
      return () => clearTimeout(t)
    }
  }, [query, activeCol, search, activeTab])

  const openDocument = (docId: string) => {
    fetch(`/api/knowledge/document/${docId}`)
      .then(r => r.json())
      .then((data: FullDocument) => setViewDoc(data))
      .catch(() => {})
  }

  const toggleExpand = (docId: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  const renderDocList = (docList: DocSummary[]) => (
    <div className="space-y-2">
      {docList.map(doc => {
        const badgeClass = COLLECTION_COLORS[doc.collection] ?? 'bg-gray-800 text-gray-400'
        const isExpanded = expandedDocs.has(doc.doc_id)
        return (
          <div
            key={doc.doc_id}
            className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3
                  className="text-sm font-medium text-white truncate cursor-pointer hover:text-indigo-400 transition-colors"
                  onClick={() => openDocument(doc.doc_id)}
                >
                  {query ? highlightText(doc.title, query) : doc.title}
                </h3>
                {doc.excerpt && (
                  <p className={`text-xs text-gray-500 mt-1 ${isExpanded ? '' : 'line-clamp-2'}`}>
                    {query ? highlightText(doc.excerpt, query) : doc.excerpt}
                  </p>
                )}
                {doc.excerpt && doc.excerpt.length > 100 && (
                  <button
                    onClick={() => toggleExpand(doc.doc_id)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 transition-colors"
                  >
                    {isExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
                  {doc.collection}
                </span>
                <span className="text-xs text-gray-600">
                  {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">Knowledge Base</h1>

      {/* Stats bar */}
      {stats && (
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
            <span className="text-xs text-gray-500">Total docs</span>
            <p className="text-sm font-semibold text-white">{stats.total}</p>
          </div>
          {stats.collections.map(c => (
            <div key={c.collection} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-500">{c.collection}</span>
              <p className="text-sm font-semibold text-white">{c.count}</p>
            </div>
          ))}
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
            <span className="text-xs text-gray-500">Playbooks</span>
            <p className="text-sm font-semibold text-white">{stats.playbooks}</p>
          </div>
        </div>
      )}

      {/* Search */}
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search documents..."
        className="w-full text-sm bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 mb-4"
      />

      {/* Top-level tabs */}
      <div className="flex gap-1.5 mb-4">
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

      {/* Documents tab */}
      {activeTab === 'Documents' && (
        <>
          {/* Collection tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 mb-5">
            {COLLECTIONS.map(col => (
              <button
                key={col}
                onClick={() => setActiveCol(col)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  activeCol === col
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {col}
              </button>
            ))}
          </div>

          {/* Document list */}
          {loading ? (
            <div className="text-gray-500 text-sm">Loading...</div>
          ) : docs.length === 0 ? (
            <div className="text-gray-600 text-sm">No documents found.</div>
          ) : (
            renderDocList(docs)
          )}
        </>
      )}

      {/* Recent tab */}
      {activeTab === 'Recent' && (
        <>
          {recentDocs.length === 0 ? (
            <div className="text-gray-600 text-sm">No recent documents.</div>
          ) : (
            renderDocList(recentDocs)
          )}
        </>
      )}

      {/* Playbooks tab */}
      {activeTab === 'Playbooks' && (
        <>
          {playbooks.length === 0 ? (
            <div className="text-gray-600 text-sm">No playbooks found.</div>
          ) : (
            <div className="space-y-2">
              {playbooks.map((pb, i) => (
                <div
                  key={pb.playbook_id ?? i}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-white">{pb.name}</h3>
                      {pb.description && (
                        <p className="text-xs text-gray-500 mt-1">{pb.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-900 text-purple-300">
                        playbook
                      </span>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        {pb.use_count != null && (
                          <span>{pb.use_count} uses</span>
                        )}
                        {pb.last_used_at && (
                          <span>Last: {new Date(pb.last_used_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Document viewer */}
      <DocumentViewer document={viewDoc} onClose={() => setViewDoc(null)} />
    </div>
  )
}
