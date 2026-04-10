import { useState, useCallback, useRef, useEffect } from 'react'
import JarvisChat from '../components/JarvisChat.tsx'

const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.85 // max 85% of viewport
const DEFAULT_WIDTH = 420
const STORAGE_KEY = 'jarvis-assistant-width'

function loadWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v) { const n = Number(v); if (n >= MIN_WIDTH) return n }
  } catch {}
  return DEFAULT_WIDTH
}

export default function AssistantRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [width, setWidth] = useState(loadWidth)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startW.current = width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX // dragging left = wider
      const maxW = window.innerWidth * MAX_WIDTH_RATIO
      const newW = Math.max(MIN_WIDTH, Math.min(maxW, startW.current + delta))
      setWidth(newW)
    }
    const onMouseUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Persist
      try { localStorage.setItem(STORAGE_KEY, String(Math.round(width))) } catch {}
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [width])

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel -- always mounted for state, positioned off-screen when closed */}
      <aside
        className={`fixed top-0 right-0 h-full bg-j-surface border-l border-j-border flex flex-col z-50 transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: `${width}px`, maxWidth: '90vw' }}
        aria-label="Jarvis assistant"
        aria-hidden={!open}
      >
        {/* Drag handle (left edge) */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-j-accent/30 active:bg-j-accent/50 transition-colors z-10"
          title="Drag to resize"
        />

        {/* Header */}
        <div className="px-4 py-3 border-b border-j-border flex items-center gap-2.5 shrink-0">
          <div className="size-5 rounded bg-j-accent/15 flex items-center justify-center" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="3" stroke="currentColor" strokeWidth="1" className="text-j-accent" />
              <circle cx="5" cy="5" r="1" fill="currentColor" className="text-j-accent" />
            </svg>
          </div>
          <span className="text-[12px] font-semibold text-j-text tracking-tight">Jarvis Assistant</span>
          <button
            onClick={onClose}
            className="ml-auto text-j-text-muted hover:text-j-text transition-colors cursor-pointer p-0.5"
            aria-label="Close assistant"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>

        {/* Chat -- fill remaining height */}
        <div className="flex-1 overflow-hidden">
          <JarvisChat />
        </div>
      </aside>
    </>
  )
}
