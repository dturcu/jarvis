import { useEffect, useState } from 'react'
import KanbanBoard from '../components/KanbanBoard.tsx'

interface Contact {
  id: number | string
  name: string
  company: string
  stage: string
  email?: string | null
  phone?: string | null
  score?: number | null
  tags?: string[]
  updated_at?: string | null
  created_at?: string | null
  [key: string]: unknown
}

interface Note {
  id: number
  note: string
  note_type: string
  created_at: string
}

interface StageHistory {
  id: number
  from_stage: string
  to_stage: string
  note?: string | null
  moved_at: string
}

interface ContactDetail extends Contact {
  notes: Note[]
  stage_history: StageHistory[]
}

const VALID_STAGES = ['prospect', 'qualified', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost', 'parked']

export default function CrmPipeline() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selected, setSelected] = useState<ContactDetail | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', company: '', email: '', stage: 'prospect' })
  const [noteText, setNoteText] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchContacts = () => {
    fetch('/api/crm')
      .then(r => r.json())
      .then((data: Contact[]) => { setContacts(data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { fetchContacts() }, [])

  const handleSelectContact = (contact: Contact) => {
    fetch(`/api/crm/${contact.id}`)
      .then(r => r.json())
      .then((data: ContactDetail) => setSelected(data))
      .catch(err => console.error('Failed to fetch contact details:', err))
  }

  const handleMoveStage = (contactId: string | number, newStage: string) => {
    fetch(`/api/crm/${contactId}/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage })
    }).then(() => fetchContacts()).catch(err => console.error('Stage move failed:', err))
  }

  const handleAddContact = () => {
    if (!newContact.name || !newContact.company) return
    fetch('/api/crm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newContact)
    }).then(() => {
      setShowAddModal(false)
      setNewContact({ name: '', company: '', email: '', stage: 'prospect' })
      fetchContacts()
    }).catch(err => console.error('Failed to add contact:', err))
  }

  const handleAddNote = () => {
    if (!selected || !noteText.trim()) return
    fetch(`/api/crm/${selected.id}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: noteText, note_type: 'general' })
    }).then(() => {
      setNoteText('')
      handleSelectContact(selected)
    }).catch(err => console.error('Failed to add note:', err))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          <span className="text-sm text-slate-500 font-medium">Loading pipeline...</span>
        </div>
      </div>
    )
  }

  /* Helper: generate initials from a name */
  const initials = (name: string) => {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main board ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">CRM Pipeline</h1>
            <p className="text-xs text-slate-500 mt-0.5">{contacts.length} contacts across {VALID_STAGES.length} stages</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="text-sm px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all duration-200 cursor-pointer focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-2 focus:ring-offset-[#030712] focus:outline-none min-h-[44px] flex items-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add Contact
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <KanbanBoard
            contacts={contacts}
            onMoveStage={handleMoveStage}
            onSelectContact={handleSelectContact}
          />
        </div>
      </div>

      {/* ── Detail panel ─────────────────────────────────── */}
      {selected && (
        <div className="w-80 shrink-0 bg-[#0f172a] border-l border-white/5 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              {/* Avatar initials */}
              <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <span className="text-xs font-bold text-indigo-400">{initials(selected.name)}</span>
              </div>
              <div>
                <h2 className="font-semibold text-slate-100 text-sm">{selected.name}</h2>
                <p className="text-xs text-slate-500">{selected.company}</p>
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-800/80 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
            {/* ── Contact info ────────────────────────────── */}
            <div className="space-y-2">
              {selected.email && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="3" width="12" height="8" rx="1.5" />
                    <path d="M1 4l6 4 6-4" />
                  </svg>
                  {selected.email}
                </div>
              )}
              {selected.phone && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3a1 1 0 011-1h2l1.5 3L5 6.5a7 7 0 003 3L9.5 8l3 1.5V11a1 1 0 01-1 1C6 12 2 8 2 3z" />
                  </svg>
                  {selected.phone}
                </div>
              )}
              <span className="inline-block text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                {selected.stage}
              </span>
            </div>

            {/* ── Stage history timeline ──────────────────── */}
            {selected.stage_history.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Stage History</h3>
                <div className="relative ml-2">
                  {/* Vertical timeline line */}
                  <div className="absolute left-0 top-1 bottom-1 w-px bg-slate-700/50" />
                  <div className="space-y-3">
                    {selected.stage_history.map(h => (
                      <div key={h.id} className="flex gap-3 relative pl-4">
                        {/* Timeline dot */}
                        <div className="absolute left-0 top-1.5 -translate-x-1/2 w-2 h-2 rounded-full bg-slate-600 border border-slate-500" />
                        <div>
                          <p className="text-xs text-slate-300 font-medium">
                            {h.from_stage}
                            <span className="text-slate-600 mx-1.5">&rarr;</span>
                            {h.to_stage}
                          </p>
                          <p className="text-[11px] text-slate-600 mt-0.5 font-mono">
                            {new Date(h.moved_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Notes ──────────────────────────────────── */}
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Notes</h3>
              <div className="space-y-2 mb-3">
                {selected.notes.length === 0 && (
                  <p className="text-xs text-slate-600 italic">No notes yet.</p>
                )}
                {selected.notes.map(n => (
                  <div key={n.id} className="bg-slate-800/50 border border-white/5 rounded-lg p-3">
                    <p className="text-xs text-slate-300 leading-relaxed">{n.note}</p>
                    <p className="text-[11px] text-slate-600 mt-1.5 font-mono">{new Date(n.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                  placeholder="Add note..."
                  className="flex-1 text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all duration-200"
                />
                <button
                  onClick={handleAddNote}
                  className="text-xs px-3 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all duration-200 font-medium cursor-pointer focus:ring-2 focus:ring-indigo-500/50 focus:outline-none min-h-[44px]"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Contact Modal ────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-[#0f172a] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl shadow-black/50">
            <h2 className="text-base font-semibold text-slate-100 mb-5">Add Contact</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1.5">Name *</label>
                <input
                  value={newContact.name}
                  onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))}
                  placeholder="Full name"
                  className="w-full text-sm bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all duration-200"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1.5">Company *</label>
                <input
                  value={newContact.company}
                  onChange={e => setNewContact(p => ({ ...p, company: e.target.value }))}
                  placeholder="Company name"
                  className="w-full text-sm bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all duration-200"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1.5">Email</label>
                <input
                  value={newContact.email}
                  onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))}
                  placeholder="email@company.com"
                  className="w-full text-sm bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all duration-200"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1.5">Stage</label>
                <select
                  value={newContact.stage}
                  onChange={e => setNewContact(p => ({ ...p, stage: e.target.value }))}
                  className="w-full text-sm bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all duration-200 cursor-pointer"
                >
                  {VALID_STAGES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 text-sm py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all duration-200 font-medium cursor-pointer focus:ring-2 focus:ring-slate-500/50 focus:outline-none min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleAddContact}
                className="flex-1 text-sm py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-all duration-200 cursor-pointer focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-2 focus:ring-offset-[#0f172a] focus:outline-none min-h-[44px]"
              >
                Add Contact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
