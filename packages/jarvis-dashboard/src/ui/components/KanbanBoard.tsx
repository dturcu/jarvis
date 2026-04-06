import { useState } from 'react'

interface Contact {
  id: number | string
  name: string
  company: string
  stage: string
  score?: number | null
  updated_at?: string | null
  [key: string]: unknown
}

interface KanbanBoardProps {
  contacts: Contact[]
  onMoveStage: (contactId: string | number, newStage: string) => void
  onSelectContact: (contact: Contact) => void
}

const STAGES = ['prospect', 'qualified', 'contacted', 'meeting', 'proposal', 'negotiation', 'won'] as const
const TERMINAL_STAGES = ['lost', 'parked'] as const
const ALL_STAGES = [...STAGES, ...TERMINAL_STAGES]

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  return Math.floor(diff / 86400000)
}

function scoreBadge(score: number | null | undefined) {
  if (score == null) return null
  const color = score < 40
    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
    : score < 70
    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
  return <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-medium ${color}`}>{score}</span>
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export default function KanbanBoard({ contacts, onMoveStage, onSelectContact }: KanbanBoardProps) {
  const [dragId, setDragId] = useState<string | number | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

  const byStage = (stage: string) => contacts.filter(c => c.stage === stage)

  const handleDragStart = (id: string | number) => setDragId(id)

  const handleDrop = (stage: string, e: React.DragEvent) => {
    e.preventDefault()
    if (dragId != null) {
      onMoveStage(dragId, stage)
      setDragId(null)
    }
    setDragOverStage(null)
  }

  const handleDragOver = (stage: string, e: React.DragEvent) => {
    e.preventDefault()
    setDragOverStage(stage)
  }

  const handleDragLeave = () => setDragOverStage(null)

  const stageLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 h-full">
      {ALL_STAGES.map(stage => {
        const cards = byStage(stage)
        const isOver = dragOverStage === stage
        return (
          <div
            key={stage}
            className="shrink-0 w-48 flex flex-col gap-2"
            onDrop={e => handleDrop(stage, e)}
            onDragOver={e => handleDragOver(stage, e)}
            onDragLeave={handleDragLeave}
          >
            {/* ── Column header ───────────────────────────── */}
            <div className="flex items-center justify-between px-1.5 mb-0.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {stageLabel(stage)}
              </span>
              <span className="text-xs text-slate-600 bg-slate-800/60 border border-white/5 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                {cards.length}
              </span>
            </div>

            {/* ── Column body ─────────────────────────────── */}
            <div className={`flex-1 flex flex-col gap-2 min-h-16 rounded-xl p-2 border transition-all duration-200 ${
              isOver
                ? 'bg-indigo-500/5 border-indigo-500/20'
                : 'bg-slate-900/30 border-white/5'
            }`}>
              {cards.map(contact => {
                const days = daysSince(contact.updated_at as string | null)
                return (
                  <div
                    key={contact.id}
                    draggable
                    onDragStart={() => handleDragStart(contact.id)}
                    onClick={() => onSelectContact(contact)}
                    className="bg-slate-800/50 backdrop-blur-sm border border-white/5 rounded-lg p-3 cursor-pointer hover:border-white/10 hover:bg-slate-800/70 transition-all duration-200 select-none group"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Avatar initials */}
                        <div className="w-6 h-6 rounded bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center shrink-0">
                          <span className="text-[9px] font-bold text-indigo-400">{initials(contact.name)}</span>
                        </div>
                        <p className="text-xs font-medium text-slate-100 leading-tight truncate">{contact.name}</p>
                      </div>
                      {scoreBadge(contact.score)}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-1.5 pl-8">{contact.company}</p>
                    {days != null && (
                      <p className="text-[11px] text-slate-600 mt-1 pl-8 font-mono">{days === 0 ? 'Today' : `${days}d ago`}</p>
                    )}
                    {/* Drag affordance indicator */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-40 transition-opacity duration-200">
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" className="text-slate-500">
                        <circle cx="2" cy="2" r="1" />
                        <circle cx="6" cy="2" r="1" />
                        <circle cx="2" cy="6" r="1" />
                        <circle cx="6" cy="6" r="1" />
                        <circle cx="2" cy="10" r="1" />
                        <circle cx="6" cy="10" r="1" />
                      </svg>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
