import JarvisChat from '../components/JarvisChat.tsx'

export default function AssistantRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <aside
      className="w-[340px] shrink-0 bg-j-surface border-l border-j-border flex flex-col h-full animate-j-slide-in"
      style={{ display: open ? undefined : 'none' }}
      aria-label="Jarvis assistant"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-j-border flex items-center gap-2.5">
        <div className="size-5 rounded bg-j-accent/15 flex items-center justify-center" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="3" stroke="currentColor" strokeWidth="1" className="text-j-accent" />
            <circle cx="5" cy="5" r="1" fill="currentColor" className="text-j-accent" />
          </svg>
        </div>
        <span className="text-[12px] font-semibold text-j-text tracking-tight">Jarvis Assistant</span>
        <span className="ml-auto text-[10px] text-j-text-muted font-mono">claude-opus</span>
        <button
          onClick={onClose}
          className="ml-2 text-j-text-muted hover:text-j-text transition-colors cursor-pointer p-0.5"
          aria-label="Close assistant"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>

      {/* Chat */}
      <div className="flex-1 overflow-hidden">
        <JarvisChat />
      </div>
    </aside>
  )
}
