import { useRef, useEffect, useState } from 'react'
import { useGodmodeStore } from '../../stores/godmode-store.ts'
import { CopyButton } from './shared.tsx'

export default function ArtifactPanel() {
  const artifact = useGodmodeStore(s => s.currentArtifact)
  const artifactHistory = useGodmodeStore(s => s.artifactHistory)
  const viewMode = useGodmodeStore(s => s.artifactViewMode)
  const setViewMode = useGodmodeStore(s => s.setArtifactViewMode)
  const closeSurface = useGodmodeStore(s => s.closeSurface)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [historyIndex, setHistoryIndex] = useState(-1)

  const displayArtifact = historyIndex >= 0 ? artifactHistory[historyIndex] : artifact

  // Update iframe content when artifact changes
  useEffect(() => {
    if (!iframeRef.current || !displayArtifact || viewMode !== 'preview') return

    const content = buildIframeContent(displayArtifact.kind, displayArtifact.content)
    const blob = new Blob([content], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    iframeRef.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [displayArtifact, viewMode])

  // Track latest artifact
  useEffect(() => {
    setHistoryIndex(-1)
  }, [artifact])

  if (!displayArtifact) {
    return (
      <div className="flex items-center justify-center h-full text-slate-600 text-sm">
        No artifact generated yet
      </div>
    )
  }

  const handleDownload = () => {
    if (!displayArtifact) return
    const ext = { html: 'html', react: 'jsx', svg: 'svg', mermaid: 'mmd', markdown: 'md', css: 'css', typescript: 'ts', javascript: 'js' }[displayArtifact.kind] ?? 'txt'
    const blob = new Blob([displayArtifact.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `artifact.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            displayArtifact.kind === 'html' ? 'bg-orange-400' :
            displayArtifact.kind === 'react' ? 'bg-cyan-400' :
            displayArtifact.kind === 'svg' ? 'bg-pink-400' :
            displayArtifact.kind === 'mermaid' ? 'bg-purple-400' :
            'bg-indigo-400'
          }`} />
          <span className="text-xs font-medium text-slate-300 truncate">{displayArtifact.title}</span>
          <span className="text-[10px] text-slate-600 font-mono shrink-0">{displayArtifact.kind}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* History navigation */}
          {artifactHistory.length > 1 && (
            <div className="flex items-center gap-1 mr-2">
              <div
                onClick={() => setHistoryIndex(i => Math.max(0, (i < 0 ? artifactHistory.length - 1 : i) - 1))}
                className="p-1 text-slate-600 hover:text-slate-400 cursor-pointer transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3L4 6l3 3" />
                </svg>
              </div>
              <span className="text-[10px] text-slate-600 font-mono">
                {(historyIndex < 0 ? artifactHistory.length : historyIndex + 1)}/{artifactHistory.length}
              </span>
              <div
                onClick={() => setHistoryIndex(i => {
                  const next = (i < 0 ? artifactHistory.length : i + 1)
                  return next >= artifactHistory.length ? -1 : next
                })}
                className="p-1 text-slate-600 hover:text-slate-400 cursor-pointer transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3l3 3-3 3" />
                </svg>
              </div>
            </div>
          )}

          {/* Preview / Code toggle */}
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            <div
              onClick={() => setViewMode('preview')}
              className={`px-2.5 py-1 text-[10px] font-medium cursor-pointer transition-colors ${
                viewMode === 'preview' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Preview
            </div>
            <div
              onClick={() => setViewMode('code')}
              className={`px-2.5 py-1 text-[10px] font-medium cursor-pointer transition-colors border-l border-white/10 ${
                viewMode === 'code' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Code
            </div>
          </div>

          <CopyButton text={displayArtifact.content} />

          {/* Download */}
          <div onClick={handleDownload} className="p-1 text-slate-500 hover:text-slate-300 cursor-pointer transition-colors" title="Download">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 2v8M4 7l3 3 3-3" />
              <path d="M2 11h10" />
            </svg>
          </div>

          {/* Close */}
          <div onClick={() => closeSurface('artifact')} className="p-1 text-slate-600 hover:text-slate-300 cursor-pointer transition-colors" title="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'preview' ? (
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-white"
            title="Artifact preview"
          />
        ) : (
          <div className="h-full overflow-auto p-4">
            <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
              {displayArtifact.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Iframe Content Builder ─────────────────────────────────────────────────

function buildIframeContent(kind: string, content: string): string {
  switch (kind) {
    case 'html':
      // If it's already a full HTML document, use as-is
      if (content.includes('<html') || content.includes('<!DOCTYPE')) return content
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:16px;font-family:system-ui,sans-serif;color:#1a1a1a;}</style></head><body>${content}</body></html>`

    case 'react':
      return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>body{margin:0;font-family:system-ui,sans-serif;}</style>
</head><body><div id="root"></div>
<script type="text/babel">
${content}
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(typeof App !== 'undefined' ? App : typeof Component !== 'undefined' ? Component : () => React.createElement('div', null, 'No component found')));
</script></body></html>`

    case 'svg':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:16px;display:flex;justify-content:center;align-items:center;min-height:calc(100vh - 32px);}</style></head><body>${content}</body></html>`

    case 'mermaid':
      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>body{margin:16px;font-family:system-ui,sans-serif;}</style>
</head><body><div class="mermaid">${content}</div>
<script>mermaid.initialize({startOnLoad:true,theme:'default'});</script></body></html>`

    case 'markdown':
      // Simple markdown → HTML
      const html = content
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/\n/g, '<br>')
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:16px;font-family:system-ui,sans-serif;color:#1a1a1a;line-height:1.7;max-width:700px;}</style></head><body>${html}</body></html>`

    default:
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:16px;font-family:monospace;white-space:pre-wrap;color:#1a1a1a;}</style></head><body>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body></html>`
  }
}
