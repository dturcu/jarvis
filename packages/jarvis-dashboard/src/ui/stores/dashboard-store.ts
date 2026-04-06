import { create } from 'zustand'
import type { AttentionData, DaemonStatus, SafeModeStatus, HealthData } from '../types/index.ts'

type SystemHealth = 'healthy' | 'needs_attention' | 'offline'

interface DashboardState {
  /* ── Data ───────────────────────────────────────────────── */
  attention: AttentionData | null
  daemon: DaemonStatus | null
  safeMode: SafeModeStatus | null
  health: HealthData | null

  /* ── Derived ────────────────────────────────────────────── */
  systemHealth: SystemHealth
  pendingApprovals: number
  failedRuns: number

  /* ── Polling ────────────────────────────────────────────── */
  _interval: ReturnType<typeof setInterval> | null
  fetchAll: () => void
  startPolling: (intervalMs?: number) => void
  stopPolling: () => void
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  attention: null,
  daemon: null,
  safeMode: null,
  health: null,

  systemHealth: 'offline',
  pendingApprovals: 0,
  failedRuns: 0,

  _interval: null,

  fetchAll: () => {
    Promise.all([
      fetch('/api/attention').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/daemon/status').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/safemode').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/health').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([attention, daemon, safeMode, health]) => {
      let systemHealth: SystemHealth = 'offline'
      let pendingApprovals = 0
      let failedRuns = 0

      if (attention) {
        pendingApprovals = attention.needs_attention?.pending_approvals ?? 0
        failedRuns = attention.needs_attention?.failed_runs ?? 0
        if (attention.system_status === 'healthy') systemHealth = 'healthy'
        else if (attention.system_status === 'needs_attention') systemHealth = 'needs_attention'
      }

      if (safeMode?.safe_mode_recommended) {
        systemHealth = 'needs_attention'
      }

      set({ attention, daemon, safeMode, health, systemHealth, pendingApprovals, failedRuns })
    })
  },

  startPolling: (intervalMs = 10_000) => {
    const { fetchAll, _interval } = get()
    if (_interval) clearInterval(_interval)
    fetchAll()
    set({ _interval: setInterval(fetchAll, intervalMs) })
  },

  stopPolling: () => {
    const { _interval } = get()
    if (_interval) clearInterval(_interval)
    set({ _interval: null })
  },
}))
