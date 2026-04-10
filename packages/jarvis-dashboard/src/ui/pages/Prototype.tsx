/**
 * Jarvis OS — High-fidelity prototype
 *
 * Self-contained artifact: all components inline, all data mocked.
 * Renders a complete shell + overview page for design review.
 *
 * Route: /prototype
 */
import { useState } from 'react'

/* ═══════════════════════════════════════════════════════════════
   MOCK DATA
   ═══════════════════════════════════════════════════════════════ */

const DAEMON = {
  running: true,
  pid: 28419,
  uptime_seconds: 8142,
  agents_registered: 8,
  schedules_active: 4,
}

const ATTENTION = {
  pending_approvals: 2,
  failed_runs: 1,
  overdue_schedules: 0,
}

const APPROVALS = [
  { id: 'apr-001', agent: 'Proposal Engine', action: 'email.send', severity: 'warning', label: 'Send ISO 26262 audit proposal to Apex Motors AG', time: '12m ago' },
  { id: 'apr-002', agent: 'Contract Reviewer', action: 'publish_post', severity: 'critical', label: 'Publish NDA review summary to portal', time: '34m ago' },
]

const ACTIVE_WORK = [
  { agent_id: 'regulatory-watch', agent: 'Regulatory Watch', status: 'executing', step: 3, total: 5, action: 'Scanning EU regulatory feed' },
  { agent_id: 'proposal-engine', agent: 'Proposal Engine', status: 'planning', step: 1, total: 4, action: 'Analyzing RFQ from Zentral Automotive' },
]

const AGENTS = [
  { id: 'orchestrator', short: 'ORCH', name: 'Orchestrator', status: 'idle', lastRun: '2h ago' },
  { id: 'regulatory-watch', short: 'REG', name: 'Regulatory Watch', status: 'executing', step: 3, total: 5 },
  { id: 'knowledge-curator', short: 'KNOW', name: 'Knowledge Curator', status: 'failed', lastRun: '45m ago' },
  { id: 'proposal-engine', short: 'PROP', name: 'Proposal Engine', status: 'planning', step: 1, total: 4 },
  { id: 'evidence-auditor', short: 'EVID', name: 'Evidence Auditor', status: 'completed', lastRun: '1h ago' },
  { id: 'contract-reviewer', short: 'CNTR', name: 'Contract Reviewer', status: 'awaiting_approval', lastRun: '34m ago' },
  { id: 'staffing-monitor', short: 'STFF', name: 'Staffing Monitor', status: 'idle', lastRun: '6h ago' },
  { id: 'self-reflection', short: 'SELF', name: 'Self-Reflection', status: 'completed', lastRun: '1d ago' },
]

const WORKFLOWS = [
  { id: 'wf-001', name: 'Review incoming RFQ', output: 'Quote package with pricing breakdown' },
  { id: 'wf-002', name: 'Audit evidence gaps', output: 'Gap matrix with remediation plan' },
  { id: 'wf-003', name: 'Weekly regulatory scan', output: 'Change summary with impact assessment' },
  { id: 'wf-004', name: 'Update CRM pipeline', output: 'Stage transitions and follow-up actions' },
]

const COMPLETIONS = [
  { agent: 'Evidence Auditor', status: 'completed', time: '1h ago' },
  { agent: 'Orchestrator', status: 'completed', time: '2h ago' },
  { agent: 'Regulatory Watch', status: 'completed', time: '4h ago' },
  { agent: 'Staffing Monitor', status: 'completed', time: '6h ago' },
  { agent: 'Knowledge Curator', status: 'failed', time: '45m ago' },
  { agent: 'Self-Reflection', status: 'completed', time: '1d ago' },
]

const CHAT_MESSAGES = [
  { role: 'user' as const, content: 'What needs my attention right now?' },
  { role: 'assistant' as const, content: 'You have **2 pending approvals** and **1 failed run**.\n\nThe approvals are:\n1. Proposal Engine wants to send the ISO 26262 audit proposal to Apex Motors AG (12m ago)\n2. Contract Reviewer wants to publish the NDA review summary (34m ago)\n\nThe Knowledge Curator failed 45 minutes ago during document ingestion. The error looks like a timeout connecting to the knowledge store — likely recoverable with a retry.' },
  { role: 'user' as const, content: 'Approve the Apex Motors proposal send.' },
]

const METRICS = {
  contacts: 147,
  documents: 892,
  playbooks: 23,
  diskFree: 41.2,
}

/* ═══════════════════════════════════════════════════════════════
   STATUS UTILITIES
   ═══════════════════════════════════════════════════════════════ */

const STATUS_PILL: Record<string, string> = {
  completed: 'text-emerald-400 bg-emerald-500/8 border-emerald-500/15',
  executing: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/15',
  running: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/15',
  planning: 'text-blue-400 bg-blue-500/8 border-blue-500/15',
  awaiting_approval: 'text-amber-400 bg-amber-500/8 border-amber-500/15',
  failed: 'text-red-400 bg-red-500/8 border-red-500/15',
  idle: 'text-j-text-muted bg-j-surface border-j-border',
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'Done', executing: 'Running', planning: 'Planning',
  awaiting_approval: 'Awaiting', failed: 'Failed', idle: 'Idle', running: 'Running',
}

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-emerald-500', executing: 'bg-cyan-400', planning: 'bg-blue-400',
  awaiting_approval: 'bg-amber-400', failed: 'bg-red-500', idle: 'bg-j-text-muted', running: 'bg-cyan-400',
}

function Pill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center border text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 ${STATUS_PILL[status] ?? STATUS_PILL.idle}`}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  )
}

function Dot({ status, pulse }: { status: string; pulse?: boolean }) {
  const color = STATUS_DOT[status] ?? 'bg-j-text-muted'
  return (
    <span className="relative flex size-1.5 shrink-0">
      {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-50 ${color}`} />}
      <span className={`relative inline-flex rounded-full size-1.5 ${color}`} />
    </span>
  )
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/* ═══════════════════════════════════════════════════════════════
   ICONS (inline SVG, 14×14 or 16×16)
   ═══════════════════════════════════════════════════════════════ */

const Ic = ({ children, size = 14 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

function IcOverview() { return <Ic><rect x="2" y="2" width="4" height="4" rx="0.5" /><rect x="8" y="2" width="4" height="4" rx="0.5" /><rect x="2" y="8" width="4" height="4" rx="0.5" /><rect x="8" y="8" width="4" height="4" rx="0.5" /></Ic> }
function IcInbox() { return <Ic><path d="M2 7l2.5-2.5h5L12 7" /><rect x="2" y="7" width="10" height="5" rx="0.5" /><path d="M2 7h3l.5 1.5h3L9 7h3" /></Ic> }
function IcWork() { return <Ic><path d="M3 4h3M3 7h2M3 10h3" /><circle cx="10" cy="4" r="1.5" /><circle cx="10" cy="10" r="1.5" /><path d="M8.5 4H6M8.5 10H6M10 5.5v3" /></Ic> }
function IcKnowledge() { return <Ic><path d="M7 2L2 4.5v5L7 12l5-2.5v-5L7 2z" /><path d="M7 7v5M2 4.5L7 7l5-2.5" /></Ic> }
function IcCrm() { return <Ic><circle cx="7" cy="5" r="2.5" /><path d="M2.5 12c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" /></Ic> }
function IcSystem() { return <Ic><rect x="3" y="2" width="8" height="7" rx="0.5" /><path d="M5 12h4M7 9v3" /><circle cx="7" cy="5.5" r="1" /></Ic> }
function IcSettings() { return <Ic><circle cx="7" cy="7" r="2" /><path d="M7 2v1.5M7 10.5V12M2.5 4l1 1M10.5 9l1 1M2 7h1.5M10.5 7H12M2.5 10l1-1M10.5 5l1-1" /></Ic> }
function IcChat() { return <Ic><rect x="1.5" y="2" width="11" height="8" rx="1" /><path d="M4 5.5h4M4 7.5h5" /></Ic> }
function IcChevron({ open }: { open: boolean }) {
  return <Ic size={10}><path d="M2.5 4l2.5 2.5L7.5 4" className={`transition-transform duration-200 origin-center ${open ? 'rotate-180' : ''}`} style={{ transformOrigin: '5px 5px', transform: open ? 'rotate(180deg)' : 'none' }} /></Ic>
}
function IcArrow() { return <Ic size={12}><path d="M4 2l4 4-4 4" /></Ic> }
function IcAlert() { return <Ic><path d="M7 1.5L1.5 11.5h11L7 1.5z" /><path d="M7 5v3M7 9.5v.01" /></Ic> }
function IcFail() { return <Ic><circle cx="7" cy="7" r="5" /><path d="M5 5l4 4M9 5l-4 4" /></Ic> }
function IcSend() { return <Ic size={14}><path d="M12 2L2 7l4 1.5M12 2L8.5 12l-2.5-3.5M12 2L6 8.5" /></Ic> }

/* ═══════════════════════════════════════════════════════════════
   SECTION CARD
   ═══════════════════════════════════════════════════════════════ */

function Section({ title, subtitle, action, accent, children, className = '' }: {
  title?: string; subtitle?: string; action?: React.ReactNode; accent?: 'default' | 'warn' | 'error' | 'accent'
  children: React.ReactNode; className?: string
}) {
  const borders: Record<string, string> = {
    default: 'border-j-border',
    warn: 'border-l-2 border-l-amber-500/40 border-t-j-border border-r-j-border border-b-j-border',
    error: 'border-l-2 border-l-red-500/40 border-t-j-border border-r-j-border border-b-j-border',
    accent: 'border-l-2 border-l-cyan-500/40 border-t-j-border border-r-j-border border-b-j-border',
  }

  return (
    <div className={`bg-j-elevated border ${borders[accent ?? 'default']} ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-j-border">
          <div>
            {title && <h3 className="text-[12px] font-semibold text-j-text uppercase tracking-wider">{title}</h3>}
            {subtitle && <p className="text-[11px] text-j-text-secondary mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SIDE NAV
   ═══════════════════════════════════════════════════════════════ */

function SideNav({ activePage, onNavigate }: { activePage: string; onNavigate: (p: string) => void }) {
  const [workOpen, setWorkOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [crmOpen, setCrmOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const linkCls = (id: string) =>
    `flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors duration-150 cursor-pointer ${
      activePage === id
        ? 'text-cyan-400 bg-cyan-500/10 border-l-2 border-l-cyan-400 -ml-px'
        : 'text-j-text-secondary hover:text-j-text hover:bg-j-hover'
    }`

  const groupCls = (ids: string[]) =>
    `w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors duration-150 cursor-pointer text-left ${
      ids.includes(activePage) ? 'text-cyan-400' : 'text-j-text-secondary hover:text-j-text hover:bg-j-hover'
    }`

  const childCls = (id: string) =>
    `flex items-center gap-2 ml-7 px-2 py-1.5 text-[12px] font-medium transition-colors duration-150 cursor-pointer ${
      activePage === id
        ? 'text-cyan-400 bg-cyan-500/8'
        : 'text-j-text-secondary hover:text-j-text'
    }`

  return (
    <aside className="w-[220px] shrink-0 bg-j-surface border-r border-j-border flex flex-col h-full select-none">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="size-7 rounded bg-cyan-500/12 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L12 4v6l-5 3-5-3V4l5-3z" stroke="#06b6d4" strokeWidth="1.2" />
              <circle cx="7" cy="7" r="2" fill="#06b6d4" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-j-text">Jarvis</h1>
            <p className="text-[10px] text-j-text-muted font-medium tracking-widest uppercase">Operations</p>
          </div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-3 overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          <button className={linkCls('overview')} onClick={() => onNavigate('overview')}>
            <span className="opacity-60"><IcOverview /></span><span className="flex-1 truncate">Overview</span>
          </button>

          <button className={linkCls('inbox')} onClick={() => onNavigate('inbox')}>
            <span className="opacity-60"><IcInbox /></span><span className="flex-1 truncate">Inbox</span>
            {ATTENTION.pending_approvals > 0 && (
              <span className="bg-amber-500/90 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
                {ATTENTION.pending_approvals}
              </span>
            )}
          </button>

          {/* Work group */}
          <button className={groupCls(['work', 'history'])} onClick={() => setWorkOpen(!workOpen)}>
            <span className="opacity-60"><IcWork /></span><span className="flex-1 truncate">Work</span>
            <span className="opacity-30"><IcChevron open={workOpen} /></span>
          </button>
          {workOpen && (
            <div className="flex flex-col gap-0.5">
              <button className={childCls('work')} onClick={() => onNavigate('work')}>Workflows</button>
              <button className={childCls('history')} onClick={() => onNavigate('history')}>History</button>
            </div>
          )}

          {/* Knowledge group */}
          <button className={groupCls(['knowledge', 'graph'])} onClick={() => setKnowledgeOpen(!knowledgeOpen)}>
            <span className="opacity-60"><IcKnowledge /></span><span className="flex-1 truncate">Knowledge</span>
            <span className="opacity-30"><IcChevron open={knowledgeOpen} /></span>
          </button>
          {knowledgeOpen && (
            <div className="flex flex-col gap-0.5">
              <button className={childCls('knowledge')} onClick={() => onNavigate('knowledge')}>Documents</button>
              <button className={childCls('graph')} onClick={() => onNavigate('graph')}>Entity Graph</button>
            </div>
          )}

          {/* CRM group */}
          <button className={groupCls(['crm', 'analytics'])} onClick={() => setCrmOpen(!crmOpen)}>
            <span className="opacity-60"><IcCrm /></span><span className="flex-1 truncate">CRM</span>
            <span className="opacity-30"><IcChevron open={crmOpen} /></span>
          </button>
          {crmOpen && (
            <div className="flex flex-col gap-0.5">
              <button className={childCls('crm')} onClick={() => onNavigate('crm')}>Pipeline</button>
              <button className={childCls('analytics')} onClick={() => onNavigate('analytics')}>Analytics</button>
            </div>
          )}

          <button className={linkCls('system')} onClick={() => onNavigate('system')}>
            <span className="opacity-60"><IcSystem /></span><span className="flex-1 truncate">System</span>
          </button>
        </div>

        {/* Advanced */}
        <div className="mt-5 mb-1">
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-j-text-muted uppercase tracking-wider font-medium hover:text-j-text-secondary transition-colors cursor-pointer"
          >
            <span className="flex-1 text-left">Advanced</span>
            <span className="opacity-40"><IcChevron open={advancedOpen} /></span>
          </button>
        </div>
        {advancedOpen && (
          <div className="flex flex-col gap-0.5">
            {['Godmode', 'Runs', 'Models', 'Queue', 'Schedule', 'Plugins'].map(label => (
              <button key={label} className={linkCls(label.toLowerCase())} onClick={() => onNavigate(label.toLowerCase())}>
                <span className="flex-1 truncate text-left">{label}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-j-border">
        <button className={linkCls('settings')} onClick={() => onNavigate('settings')}>
          <span className="opacity-60"><IcSettings /></span><span className="flex-1 truncate">Settings</span>
        </button>
        <div className="flex items-center gap-2 px-3 py-2 mt-1">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-j-text-secondary font-medium">All systems nominal</span>
        </div>
      </div>
    </aside>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TOP BAR
   ═══════════════════════════════════════════════════════════════ */

function TopBar({ title, assistantOpen, onToggleAssistant }: {
  title: string; assistantOpen: boolean; onToggleAssistant: () => void
}) {
  return (
    <header className="h-12 shrink-0 bg-j-surface/80 backdrop-blur-md border-b border-j-border flex items-center justify-between px-5">
      <h2 className="text-sm font-semibold text-j-text tracking-tight">{title}</h2>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 text-[11px] font-mono text-j-text-secondary">
          <span className="flex items-center gap-1.5">
            <Dot status="completed" />
            <span className="text-emerald-400">Nominal</span>
          </span>
          <span className="text-j-text-muted">|</span>
          <span>PID {DAEMON.pid}</span>
          <span className="text-j-text-muted">|</span>
          <span>{formatUptime(DAEMON.uptime_seconds)}</span>
          <span className="text-j-text-muted">|</span>
          <span>{DAEMON.agents_registered} agents</span>
        </div>
        <div className="h-4 w-px bg-j-border" />
        <button
          onClick={onToggleAssistant}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 cursor-pointer ${
            assistantOpen ? 'text-cyan-400 bg-cyan-500/10' : 'text-j-text-secondary hover:text-j-text'
          }`}
        >
          <IcChat />
          <span>Assistant</span>
        </button>
      </div>
    </header>
  )
}

/* ═══════════════════════════════════════════════════════════════
   ASSISTANT RAIL
   ═══════════════════════════════════════════════════════════════ */

function AssistantRail({ open }: { open: boolean }) {
  const [input, setInput] = useState('')

  if (!open) return null

  return (
    <aside className="w-[340px] shrink-0 bg-j-surface border-l border-j-border flex flex-col h-full" style={{ animation: 'j-slide-in 0.2s ease-out' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-j-border flex items-center gap-2.5">
        <div className="size-5 rounded bg-cyan-500/12 flex items-center justify-center">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="3" stroke="#06b6d4" strokeWidth="1" />
            <circle cx="5" cy="5" r="1" fill="#06b6d4" />
          </svg>
        </div>
        <span className="text-[12px] font-semibold text-j-text tracking-tight">Jarvis Assistant</span>
        <span className="ml-auto text-[10px] text-j-text-muted font-mono">claude-opus</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {CHAT_MESSAGES.map((msg, i) => (
          <div key={i} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <span className="text-[10px] text-j-text-muted uppercase tracking-wider font-medium">
              {msg.role === 'user' ? 'You' : 'Jarvis'}
            </span>
            <div className={`text-[12px] leading-relaxed max-w-[280px] px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-cyan-500/10 border border-cyan-500/15 text-j-text'
                : 'bg-j-elevated border border-j-border text-j-text-secondary'
            }`}>
              {msg.content.split('\n').map((line, j) => {
                const bold = line.replace(/\*\*(.*?)\*\*/g, '‹b›$1‹/b›')
                const parts = bold.split(/‹\/?b›/)
                return (
                  <p key={j} className={j > 0 ? 'mt-1.5' : ''}>
                    {parts.map((part, k) => k % 2 === 1 ? <strong key={k} className="text-j-text font-semibold">{part}</strong> : part)}
                  </p>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-j-border">
        <div className="flex items-center gap-2 bg-j-elevated border border-j-border px-3 py-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask Jarvis..."
            className="flex-1 bg-transparent text-[12px] text-j-text placeholder-j-text-muted outline-none font-sans"
          />
          <button className="text-j-text-muted hover:text-cyan-400 transition-colors cursor-pointer">
            <IcSend />
          </button>
        </div>
      </div>
    </aside>
  )
}

/* ═══════════════════════════════════════════════════════════════
   OVERVIEW PAGE
   ═══════════════════════════════════════════════════════════════ */

function OverviewPage() {
  return (
    <div className="p-6 max-w-[1400px]">
      {/* System strip */}
      <div className="bg-j-elevated border border-j-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-j-pulse" />
              <span className="relative inline-flex rounded-full size-1.5 bg-emerald-500" />
            </span>
            <span className="text-[11px] text-emerald-400 font-semibold">Online</span>
          </span>
          <span className="text-j-text-muted text-[11px]">|</span>
          <div className="flex items-center gap-4 text-[11px] font-mono text-j-text-secondary">
            <span>Uptime {formatUptime(DAEMON.uptime_seconds)}</span>
            <span>{DAEMON.agents_registered} agents registered</span>
            <span>{DAEMON.schedules_active} schedules active</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-j-text-muted">
          <span>{METRICS.contacts} contacts</span>
          <span>{METRICS.documents} docs</span>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mt-4">
        {/* Left — 3/5 */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {/* Attention */}
          <Section title="Attention Required" subtitle={`${ATTENTION.pending_approvals + ATTENTION.failed_runs} items`} accent="warn">
            <div className="flex flex-col gap-2">
              {APPROVALS.map(apr => (
                <div key={apr.id} className="flex items-center gap-3 py-2.5 px-3 bg-j-surface border border-j-border hover:border-j-border-active transition-colors cursor-pointer group">
                  <span className={apr.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}><IcAlert /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-j-text truncate group-hover:text-cyan-400 transition-colors">{apr.label}</p>
                    <p className="text-[10px] text-j-text-muted font-mono mt-0.5">{apr.agent} · {apr.action} · {apr.time}</p>
                  </div>
                  <Pill status={apr.severity === 'critical' ? 'failed' : 'awaiting_approval'} label={apr.severity === 'critical' ? 'Critical' : 'Review'} />
                  <span className="text-j-text-muted group-hover:text-cyan-400 transition-colors"><IcArrow /></span>
                </div>
              ))}
              <div className="flex items-center gap-3 py-2.5 px-3 bg-j-surface border border-red-500/10 hover:border-red-500/20 transition-colors cursor-pointer group">
                <span className="text-red-400"><IcFail /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-j-text truncate group-hover:text-cyan-400 transition-colors">Knowledge Curator failed during document ingestion</p>
                  <p className="text-[10px] text-j-text-muted font-mono mt-0.5">knowledge-curator · timeout · 45m ago</p>
                </div>
                <Pill status="failed" />
                <span className="text-j-text-muted group-hover:text-cyan-400 transition-colors"><IcArrow /></span>
              </div>
            </div>
          </Section>

          {/* Active operations */}
          <Section title="Active Operations" subtitle="2 running" accent="accent">
            <div className="flex flex-col gap-3">
              {ACTIVE_WORK.map(work => {
                const pct = Math.round((work.step / work.total) * 100)
                return (
                  <div key={work.agent_id} className="flex items-center gap-3 py-2.5 px-3 bg-j-surface border border-cyan-500/8">
                    <Dot status={work.status} pulse />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-j-text">{work.agent}</p>
                      <p className="text-[10px] text-j-text-muted font-mono mt-0.5">{work.action}</p>
                    </div>
                    <Pill status={work.status} />
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-20 bg-j-base h-1 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-cyan-600 to-cyan-400 h-1 transition-all duration-700"
                          style={{ width: `${Math.max(5, pct)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-j-text-muted tabular-nums w-8 text-right">{pct}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* Agent grid */}
          <Section title="Agents">
            <div className="grid grid-cols-4 gap-2">
              {AGENTS.map(agent => (
                <div
                  key={agent.id}
                  className="bg-j-surface border border-j-border p-3 flex flex-col gap-2 hover:border-j-border-active transition-colors cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold font-mono text-j-text-secondary tracking-wider group-hover:text-j-text transition-colors">
                      {agent.short}
                    </span>
                    <Pill status={agent.status} />
                  </div>
                  <span className="text-[11px] text-j-text-secondary truncate">{agent.name}</span>
                  {(agent.status === 'executing' || agent.status === 'planning') && agent.total && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-j-base h-1 overflow-hidden">
                        <div
                          className="bg-cyan-500 h-1 transition-all duration-500"
                          style={{ width: `${Math.max(5, Math.round(((agent.step ?? 0) / agent.total) * 100))}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-j-text-muted">{agent.step}/{agent.total}</span>
                    </div>
                  )}
                  {agent.status !== 'executing' && agent.status !== 'planning' && agent.lastRun && (
                    <span className="text-[10px] font-mono text-j-text-muted">{agent.lastRun}</span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Right — 2/5 */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Quick actions */}
          <Section
            title="Quick Actions"
            action={<span className="text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer transition-colors">All workflows</span>}
          >
            <div className="flex flex-col gap-1.5">
              {WORKFLOWS.map(wf => (
                <div
                  key={wf.id}
                  className="flex items-center justify-between px-3 py-2.5 bg-j-surface border border-j-border hover:border-j-border-active transition-colors cursor-pointer group"
                >
                  <div className="min-w-0">
                    <span className="text-[12px] font-medium text-j-text group-hover:text-cyan-400 transition-colors truncate block">{wf.name}</span>
                    <span className="text-[10px] text-j-text-muted truncate block mt-0.5">{wf.output}</span>
                  </div>
                  <span className="shrink-0 text-j-text-muted group-hover:text-cyan-400 transition-colors ml-3"><IcArrow /></span>
                </div>
              ))}
            </div>
          </Section>

          {/* Recent activity */}
          <Section
            title="Recent Activity"
            action={<span className="text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer transition-colors">View all</span>}
          >
            <div className="flex flex-col">
              {COMPLETIONS.map((comp, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-j-border last:border-0">
                  <Dot status={comp.status} />
                  <span className="text-[12px] text-j-text font-medium flex-1 truncate">{comp.agent}</span>
                  <span className="text-[10px] font-mono text-j-text-muted shrink-0">{comp.time}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* System metrics */}
          <Section title="System">
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Contacts', value: METRICS.contacts },
                { label: 'Documents', value: METRICS.documents },
                { label: 'Playbooks', value: METRICS.playbooks },
                { label: 'Disk Free', value: `${METRICS.diskFree} GB` },
              ].map(m => (
                <div key={m.label} className="flex flex-col gap-1">
                  <span className="text-[10px] text-j-text-muted uppercase tracking-wider font-medium">{m.label}</span>
                  <span className="text-[16px] font-semibold text-j-text font-mono tabular-nums">{m.value}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PROTOTYPE SHELL
   ═══════════════════════════════════════════════════════════════ */

export default function Prototype() {
  const [activePage, setActivePage] = useState('overview')
  const [assistantOpen, setAssistantOpen] = useState(true)

  const titles: Record<string, string> = {
    overview: 'Overview', inbox: 'Inbox', work: 'Workflows', history: 'History',
    knowledge: 'Knowledge', graph: 'Entity Graph', crm: 'CRM Pipeline',
    analytics: 'CRM Analytics', system: 'System', settings: 'Settings',
    godmode: 'Godmode', runs: 'Runs', models: 'Models', queue: 'Queue',
    schedule: 'Schedule', plugins: 'Plugins',
  }

  return (
    <div className="flex h-screen bg-j-base text-j-text overflow-hidden font-sans">
      <SideNav activePage={activePage} onNavigate={setActivePage} />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={titles[activePage] ?? activePage}
          assistantOpen={assistantOpen}
          onToggleAssistant={() => setAssistantOpen(!assistantOpen)}
        />

        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto">
            {activePage === 'overview' ? (
              <OverviewPage />
            ) : (
              <div className="p-6">
                <div className="bg-j-elevated border border-j-border p-8 flex flex-col items-center justify-center gap-3 min-h-[300px]">
                  <span className="text-j-text-muted opacity-40">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1">
                      <rect x="4" y="4" width="24" height="24" rx="2" />
                      <path d="M4 12h24M12 12v16" />
                    </svg>
                  </span>
                  <p className="text-[13px] text-j-text-secondary font-medium">{titles[activePage] ?? activePage}</p>
                  <p className="text-[11px] text-j-text-muted">Page content renders here</p>
                </div>
              </div>
            )}
          </main>

          <AssistantRail open={assistantOpen} />
        </div>
      </div>
    </div>
  )
}
