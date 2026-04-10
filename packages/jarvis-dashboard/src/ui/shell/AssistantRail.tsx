import JarvisChat from '../components/JarvisChat.tsx'

export default function AssistantRail({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        className={`fixed top-0 right-0 h-full w-[420px] max-w-[90vw] bg-j-surface border-l border-j-border flex flex-col z-50 transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="Jarvis assistant"
        aria-hidden={!open}
      >
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
