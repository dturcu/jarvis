import { useState, useEffect, useRef, useCallback } from 'react'

interface ScheduledTask {
  id: string
  agentId: string
  label: string
  cron: string
  humanSchedule: string
  nextFire: string
}

interface DaemonCurrentRun {
  agent_id: string
  status: string
  step: number
  total_steps: number
  current_action: string
  started_at: string
}

interface DaemonStatus {
  running: boolean
  pid: number | null
  uptime_seconds: number | null
  agents_registered: number
  schedules_active: number
  last_run: { agent_id: string; status: string; completed_at: string } | null
  current_run: DaemonCurrentRun | null
}

const POLL_INTERVAL = 30_000 // 30 seconds

function nextFireTime(cron: string): string {
  const now = new Date()
  const [, , , , dayOfWeekField] = cron.split(' ')
  const [hourField] = cron.split(' ')
  const hour = parseInt(cron.split(' ')[1], 10)
  const minute = parseInt(cron.split(' ')[0], 10)

  const isDaily = dayOfWeekField === '*'
  const isWeekdays = dayOfWeekField === '1-5'

  if (isDaily) {
    const candidate = new Date(now)
    candidate.setHours(hour, minute, 0, 0)
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1)
    return candidate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  // Specific day(s)
  const targetDays: number[] = isWeekdays
    ? [1, 2, 3, 4, 5]
    : cron.split(' ')[4].split(',').map(Number)

  const candidate = new Date(now)
  candidate.setHours(hour, minute, 0, 0)
  for (let i = 0; i < 8; i++) {
    if (targetDays.includes(candidate.getDay()) && candidate > now) {
      return candidate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    }
    candidate.setDate(candidate.getDate() + 1)
    candidate.setHours(hour, minute, 0, 0)
  }
  return 'Unknown'
}

// Static task list — cannot query Scheduled Tasks MCP from web context
const TASKS: ScheduledTask[] = [
  {
    id: 'jarvis-bd-pipeline',
    agentId: 'bd-pipeline',
    label: 'BD Pipeline',
    cron: '0 8 * * 1-5',
    humanSchedule: 'Weekdays at 8:00 AM',
    nextFire: nextFireTime('0 8 * * 1-5')
  },
  {
    id: 'jarvis-evidence-auditor',
    agentId: 'evidence-auditor',
    label: 'Evidence Auditor',
    cron: '0 9 * * 1',
    humanSchedule: 'Mondays at 9:00 AM',
    nextFire: nextFireTime('0 9 * * 1')
  },
  {
    id: 'jarvis-staffing-monitor',
    agentId: 'staffing-monitor',
    label: 'Staffing Monitor',
    cron: '0 9 * * 1',
    humanSchedule: 'Mondays at 9:00 AM',
    nextFire: nextFireTime('0 9 * * 1')
  },
  {
    id: 'jarvis-content-monday',
    agentId: 'content-engine',
    label: 'Content Engine (Monday)',
    cron: '0 7 * * 1',
    humanSchedule: 'Mondays at 7:00 AM',
    nextFire: nextFireTime('0 7 * * 1')
  },
  {
    id: 'jarvis-content-wednesday',
    agentId: 'content-engine',
    label: 'Content Engine (Wednesday)',
    cron: '0 7 * * 3',
    humanSchedule: 'Wednesdays at 7:00 AM',
    nextFire: nextFireTime('0 7 * * 3')
  },
  {
    id: 'jarvis-content-thursday',
    agentId: 'content-engine',
    label: 'Content Engine (Thursday)',
    cron: '0 7 * * 4',
    humanSchedule: 'Thursdays at 7:00 AM',
    nextFire: nextFireTime('0 7 * * 4')
  },
  {
    id: 'jarvis-portfolio-am',
    agentId: 'portfolio-monitor',
    label: 'Portfolio Monitor (AM)',
    cron: '0 8 * * *',
    humanSchedule: 'Daily at 8:00 AM',
    nextFire: nextFireTime('0 8 * * *')
  },
  {
    id: 'jarvis-portfolio-pm',
    agentId: 'portfolio-monitor',
    label: 'Portfolio Monitor (PM)',
    cron: '0 20 * * *',
    humanSchedule: 'Daily at 8:00 PM',
    nextFire: nextFireTime('0 20 * * *')
  },
  {
    id: 'jarvis-garden-calendar',
    agentId: 'garden-calendar',
    label: 'Garden Calendar',
    cron: '0 7 * * 1',
    humanSchedule: 'Mondays at 7:00 AM',
    nextFire: nextFireTime('0 7 * * 1')
  }
]

export default function Schedule() {
  const [triggering, setTriggering] = useState<string | null>(null)
  const [triggered, setTriggered] = useState<Set<string>>(new Set())
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchDaemonStatus = useCallback(() => {
    fetch('/api/daemon/status')
      .then(r => r.json())
      .then((d: DaemonStatus) => setDaemon(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchDaemonStatus()
    intervalRef.current = setInterval(fetchDaemonStatus, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchDaemonStatus])

  const handleRunNow = async (task: ScheduledTask) => {
    setTriggering(task.id)
    try {
      await fetch(`/api/agents/${task.agentId}/trigger`, { method: 'POST' })
      setTriggered(prev => new Set([...prev, task.id]))
      setTimeout(() => {
        setTriggered(prev => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
      }, 3000)
    } finally {
      setTriggering(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">Scheduled Tasks</h1>
      <p className="text-sm text-gray-500 mb-6">
        9 automated tasks. "Run Now" writes a trigger file that the agent picks up on its next poll cycle.
      </p>

      {/* Daemon connection indicator */}
      {daemon && (
        <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
          <span className={`inline-flex rounded-full h-2 w-2 ${daemon.running ? 'bg-green-500' : 'bg-gray-600'}`} />
          <span>{daemon.running ? 'Daemon connected' : 'Daemon offline'}</span>
          {daemon.current_run && (
            <span className="text-yellow-400 ml-2">
              Running: {daemon.current_run.agent_id} (step {daemon.current_run.step}/{daemon.current_run.total_steps})
            </span>
          )}
        </div>
      )}

      <div className="space-y-2">
        {TASKS.map(task => {
          const isTriggering = triggering === task.id
          const wasTriggered = triggered.has(task.id)
          const isRunning = daemon?.current_run?.agent_id === task.agentId
          return (
            <div
              key={task.id}
              className={`bg-gray-900 border ${isRunning ? 'border-yellow-700/50' : 'border-gray-800'} rounded-xl px-5 py-4 flex items-center gap-4`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-sm font-medium text-white">{task.label}</h3>
                  <span className="text-xs text-gray-600 font-mono">{task.id}</span>
                  {isRunning && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900 text-yellow-400 font-medium flex items-center gap-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-yellow-400" />
                      </span>
                      Running
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{task.humanSchedule}</span>
                  <span className="text-gray-700">·</span>
                  <span>Next: <span className="text-gray-400">{task.nextFire}</span></span>
                </div>
              </div>
              <button
                onClick={() => handleRunNow(task)}
                disabled={isTriggering || wasTriggered || isRunning}
                className={`shrink-0 text-xs px-4 py-2 rounded-lg font-medium transition-colors ${
                  wasTriggered
                    ? 'bg-green-900 text-green-400 cursor-default'
                    : isRunning
                      ? 'bg-yellow-900 text-yellow-400 cursor-not-allowed'
                      : 'bg-indigo-700 hover:bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {isTriggering ? 'Triggering...' : wasTriggered ? 'Triggered!' : isRunning ? 'Running...' : 'Run Now'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
