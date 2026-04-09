import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../shared/PageHeader.tsx'
import TabBar from '../shared/TabBar.tsx'
import StatusBadge from '../shared/StatusBadge.tsx'
import TimelineItem from '../shared/TimelineItem.tsx'
import EmptyState from '../shared/EmptyState.tsx'
import LoadingSpinner from '../shared/LoadingSpinner.tsx'
import {
  IconRuns, IconInbox, IconCheck, IconWarning, IconError,
  IconSettings, IconSystem, IconClock, IconHistory, IconRecovery,
  IconWorkflow,
} from '../shared/icons.tsx'
import type { HistoryEvent, HistoryResponse, HistoryEventType } from '../types/index.ts'
import { agentLabel } from '../types/index.ts'

/* ── Tab definitions ─────────────────────────────────────── */

const TABS = ['All', 'Runs', 'Approvals', 'Failures', 'System', 'Settings'] as const
type Tab = (typeof TABS)[number]

interface TabFilter {
  type?: HistoryEventType
  status?: string
}

const TAB_FILTERS: Record<Tab, TabFilter> = {
  All:       {},
  Runs:      { type: 'run' },
  Approvals: { type: 'approval' },
  Failures:  { type: 'run', status: 'failed' },
  System:    { type: 'system' },
  Settings:  { type: 'settings_change' },
}

const PAGE_SIZE = 50

/* ── Type icon mapping ───────────────────────────────────── */

function eventTypeIcon(type: HistoryEventType) {
  switch (type) {
    case 'run':             return <IconRuns />
    case 'approval':        return <IconInbox />
    case 'workflow_start':  return <IconWorkflow />
    case 'system':          return <IconSystem />
    case 'settings_change': return <IconSettings />
    case 'recovery':        return <IconRecovery />
    case 'backup':          return <IconClock />
    default:                return <IconHistory />
  }
}

function eventTypeLabel(type: HistoryEventType): string {
  switch (type) {
    case 'run':             return 'Run'
    case 'approval':        return 'Approval'
    case 'workflow_start':  return 'Workflow'
    case 'system':          return 'System'
    case 'settings_change': return 'Settings'
    case 'recovery':        return 'Recovery'
    case 'backup':          return 'Backup'
    default:                return type
  }
}

/* ── Date grouping ───────────────────────────────────────── */

function dateGroupLabel(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor((today.getTime() - eventDay.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)   return date.toLocaleDateString([], { weekday: 'long' })
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

/* ── Action links per event type ─────────────────────────── */

function EventActions({ event }: { event: HistoryEvent }) {
  if (event.type === 'run' && event.run_id) {
    return (
      <Link
        to={`/runs/${event.run_id}`}
        className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors px-2.5 py-1 rounded-md bg-indigo-500/10 hover:bg-indigo-500/15"
      >
        Inspect
      </Link>
    )
  }
  if (event.type === 'approval' && event.approval_id) {
    return (
      <Link
        to={`/inbox`}
        className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors px-2.5 py-1 rounded-md bg-indigo-500/10 hover:bg-indigo-500/15"
      >
        View
      </Link>
    )
  }
  if (event.type === 'workflow_start' && event.workflow_id) {
    return (
      <Link
        to={`/workflows`}
        className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors px-2.5 py-1 rounded-md bg-indigo-500/10 hover:bg-indigo-500/15"
      >
        Details
      </Link>
    )
  }
  return null
}

/* ── Subtitle enrichment ─────────────────────────────────── */

function eventSubtitle(event: HistoryEvent): string | undefined {
  if (event.subtitle) return event.subtitle
  if (event.agent_id) return agentLabel(event.agent_id)
  if (event.outcome) return event.outcome
  return undefined
}

/* ── Main component ──────────────────────────────────────── */

export default function History() {
  const [activeTab, setActiveTab] = useState<Tab>('All')
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Build fetch URL from tab + offset */
  const buildUrl = useCallback((tab: Tab, off: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off) })
    const filter = TAB_FILTERS[tab]
    if (filter.type) params.set('type', filter.type)
    if (filter.status) params.set('status', filter.status)
    return `/api/history?${params}`
  }, [])

  /* Initial fetch + tab change */
  const fetchEvents = useCallback((tab: Tab) => {
    setLoading(true)
    setError(null)
    setOffset(0)
    fetch(buildUrl(tab, 0))
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data: HistoryResponse) => {
        setEvents(data.events)
        setTotal(data.total)
        setHasMore(data.has_more)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setEvents([])
        setLoading(false)
      })
  }, [buildUrl])

  /* Load more (append) */
  const loadMore = useCallback(() => {
    const newOffset = offset + PAGE_SIZE
    setLoadingMore(true)
    fetch(buildUrl(activeTab, newOffset))
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data: HistoryResponse) => {
        setEvents(prev => [...prev, ...data.events])
        setOffset(newOffset)
        setHasMore(data.has_more)
        setTotal(data.total)
        setLoadingMore(false)
      })
      .catch(() => {
        setLoadingMore(false)
      })
  }, [offset, activeTab, buildUrl])

  /* Refetch on tab change */
  useEffect(() => {
    fetchEvents(activeTab)
  }, [activeTab, fetchEvents])

  /* Tab change handler */
  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab)
  }, [])

  /* ── Group events by date ──────────────────────────────── */
  const groupedEvents: Array<{ label: string; events: HistoryEvent[] }> = []
  let currentGroup = ''
  for (const event of events) {
    const group = dateGroupLabel(event.timestamp)
    if (group !== currentGroup) {
      currentGroup = group
      groupedEvents.push({ label: group, events: [] })
    }
    groupedEvents[groupedEvents.length - 1].events.push(event)
  }

  /* ── Render ────────────────────────────────────────────── */

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="History"
        subtitle="Activity timeline and audit log"
        actions={
          total > 0 ? (
            <span className="text-xs text-slate-600 font-mono tabular-nums">
              {events.length} of {total} events
            </span>
          ) : undefined
        }
      />

      <TabBar
        tabs={TABS}
        active={activeTab}
        onChange={handleTabChange}
        variant="underline"
      />

      {/* Loading state */}
      {loading && <LoadingSpinner message="Loading activity..." />}

      {/* Error state */}
      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
          <p className="text-sm text-red-400">Failed to load history</p>
          <p className="text-xs text-red-500/70 mt-1">{error}</p>
          <button
            onClick={() => fetchEvents(activeTab)}
            className="mt-3 text-xs font-medium text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/15"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && events.length === 0 && (
        <EmptyState
          icon={<IconHistory />}
          title={activeTab === 'All' ? 'No activity recorded yet' : `No ${activeTab.toLowerCase()} events`}
          subtitle={
            activeTab === 'All'
              ? 'Events will appear here as agents run, approvals are made, and settings change.'
              : `Try the "All" tab to see all event types.`
          }
        />
      )}

      {/* Event timeline */}
      {!loading && !error && events.length > 0 && (
        <div>
          {groupedEvents.map((group) => (
            <div key={group.label} className="mb-6">
              {/* Date group header */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-slate-800/80" />
                <span className="text-[10px] text-slate-700 font-mono tabular-nums">
                  {group.events.length} {group.events.length === 1 ? 'event' : 'events'}
                </span>
              </div>

              {/* Events within group */}
              {group.events.map((event, idx) => (
                <TimelineItem
                  key={event.id}
                  timestamp={event.timestamp}
                  title={event.title}
                  subtitle={eventSubtitle(event)}
                  status={event.status}
                  typeIcon={eventTypeIcon(event.type)}
                  typeLabel={eventTypeLabel(event.type)}
                  last={idx === group.events.length - 1}
                  actions={
                    <div className="flex items-center gap-2">
                      <StatusBadge status={event.status} size="sm" />
                      <EventActions event={event} />
                    </div>
                  }
                >
                  {/* Show source and agent context as inline metadata */}
                  {(event.source || event.agent_id || event.outcome) && (
                    <div className="flex items-center gap-3 flex-wrap">
                      {event.source && (
                        <span className="text-[10px] text-slate-600">
                          <span className="text-slate-700">Source</span>{' '}
                          {event.source}
                        </span>
                      )}
                      {event.agent_id && (
                        <span className="text-[10px] text-slate-600">
                          <span className="text-slate-700">Agent</span>{' '}
                          <span className="text-indigo-400/70">{agentLabel(event.agent_id)}</span>
                        </span>
                      )}
                      {event.outcome && event.outcome !== event.status && (
                        <span className="text-[10px] text-slate-600">
                          <span className="text-slate-700">Outcome</span>{' '}
                          {event.outcome}
                        </span>
                      )}
                    </div>
                  )}
                </TimelineItem>
              ))}
            </div>
          ))}

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center pt-4 pb-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-xs font-medium text-slate-400 hover:text-white px-5 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-white/5 hover:border-white/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border border-slate-500 border-t-slate-300 rounded-full animate-spin" />
                    Loading...
                  </span>
                ) : (
                  `Load more events`
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
