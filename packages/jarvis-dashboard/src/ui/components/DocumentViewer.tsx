interface DocumentViewerProps {
  document: {
    title: string
    content: string
    collection: string
    created_at: string
  } | null
  onClose: () => void
}

const COLLECTION_COLORS: Record<string, string> = {
  lessons: 'bg-blue-900 text-blue-300',
  playbooks: 'bg-purple-900 text-purple-300',
  iso26262: 'bg-orange-900 text-orange-300',
  contracts: 'bg-red-900 text-red-300',
  proposals: 'bg-green-900 text-green-300',
  'case-studies': 'bg-teal-900 text-teal-300',
  garden: 'bg-lime-900 text-lime-300'
}

export default function DocumentViewer({ document, onClose }: DocumentViewerProps) {
  if (!document) return null

  const badgeClass = COLLECTION_COLORS[document.collection] ?? 'bg-gray-800 text-gray-400'
  const formattedDate = new Date(document.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-gray-800">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-white leading-tight">{document.title}</h2>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
                {document.collection}
              </span>
              <span className="text-xs text-gray-500">{formattedDate}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
            {document.content}
          </pre>
        </div>
      </div>
    </div>
  )
}
