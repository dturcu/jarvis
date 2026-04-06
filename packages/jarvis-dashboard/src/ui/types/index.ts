/* ── Shared TypeScript interfaces for the Jarvis Dashboard ── */

/* ── Health & System ──────────────────────────────────────── */

export interface HealthData {
  ok: boolean
  status: string
  uptime_seconds: number
  crm: { contacts: number }
  knowledge: { documents: number; playbooks: number }
  runtime: Record<string, unknown>
  daemon: Record<string, unknown>
  disk_free_gb: number
}

export interface DaemonCurrentRun {
  agent_id: string
  status: string
  step: number
  total_steps: number
  current_action: string
  started_at: string
}

export interface DaemonStatus {
  running: boolean
  pid: number | null
  uptime_seconds: number | null
  agents_registered: number
  schedules_active: number
  last_run: { agent_id: string; status: string; completed_at: string } | null
  /** @deprecated Use active_runs instead */
  current_run: DaemonCurrentRun | null
  active_runs?: DaemonCurrentRun[]
}

export interface SafeModeStatus {
  safe_mode_recommended: boolean
  reasons: string[]
}

/* ── Attention ────────────────────────────────────────────── */

export interface AttentionNeedsAttention {
  pending_approvals: number
  failed_runs: number
  overdue_schedules: number
}

export interface AttentionActiveWork {
  run_id?: string
  agent_id: string
  status: string
  current_step: number
  total_steps: number
  started_at?: string
}

export interface AttentionRecentCompletion {
  run_id?: string
  agent_id: string
  status: string
  completed_at: string
  current_step?: number
}

export interface AttentionData {
  needs_attention: AttentionNeedsAttention
  active_work: AttentionActiveWork[]
  recent_completions: AttentionRecentCompletion[]
  recommended_actions: string[]
  system_status: 'healthy' | 'needs_attention' | 'unknown'
}

/* ── Runs ─────────────────────────────────────────────────── */

export interface Run {
  run_id: string
  agent_id: string
  trigger: string
  status: string
  goal?: string
  current_step?: number
  total_steps?: number
  error?: string
  started_at: string
  completed_at?: string | null
  plan?: {
    steps?: Array<{
      action?: string
      reasoning?: string
      outcome?: string
      started_at?: string
      completed_at?: string
    }>
  } | null
}

export interface RunExplanation {
  summary: string
  trigger: string
  data_sources: string[]
  decisions_made: number
  approvals_required: number
  steps_completed: number
  steps_total: number
  outcome: string
  failure?: {
    probable_cause: string
    outbound_effects_may_have_occurred: boolean
    retry_recommendation: string
  }
  preview_mode?: {
    enabled: boolean
    skipped_actions: string[]
  }
}

/* ── Approvals ────────────────────────────────────────────── */

export interface LinkedRun {
  run_id: string
  agent_id: string
  status: string
  goal?: string
  current_step?: number
  total_steps?: number
}

export interface EnrichedApproval {
  id: string
  action: string
  agent: string
  severity: string
  status: string
  risk: { level: string; label: string; reversible: boolean } | null
  linked_run: LinkedRun | null
  timeout_at: string | null
  time_remaining_ms: number | null
  what_happens_if_nothing: string | null
  created_at?: string
}

/* ── Workflows ────────────────────────────────────────────── */

export interface WorkflowInput {
  field: string
  type: 'text' | 'file' | 'select' | 'date' | 'checkbox'
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface WorkflowSafetyRules {
  outbound_default: 'draft' | 'send' | 'blocked'
  preview_available: boolean
  preview_recommended: boolean
  retry_safe: boolean
  retry_requires_approval: boolean
}

export interface WorkflowOutputField {
  field: string
  label: string
  type: string
}

export interface WorkflowDefinition {
  workflow_id: string
  name: string
  description?: string
  inputs: WorkflowInput[]
  agent_ids: string[]
  safety_rules: WorkflowSafetyRules
  expected_output: string
  approval_summary: string
  output_fields: WorkflowOutputField[]
}

/* ── Repair ───────────────────────────────────────────────── */

export interface FixAction {
  type: string
  field?: string
  description: string
  example?: string
}

export interface RepairCheck {
  name: string
  status: 'ok' | 'warning' | 'critical'
  message: string
  severity: number
  fix_action: FixAction | null
}

export interface RepairReport {
  status: 'healthy' | 'degraded' | 'broken'
  checks: RepairCheck[]
  recommended_actions: Array<{ check: string; action: FixAction }>
  safe_mode: boolean
}

/* ── History ──────────────────────────────────────────────── */

export type HistoryEventType =
  | 'run'
  | 'approval'
  | 'workflow_start'
  | 'system'
  | 'settings_change'
  | 'recovery'
  | 'backup'

export interface HistoryEvent {
  id: string
  type: HistoryEventType
  title: string
  subtitle?: string
  status: string
  source: string
  timestamp: string
  agent_id?: string
  workflow_id?: string
  run_id?: string
  approval_id?: string
  outcome?: string
  payload?: Record<string, unknown>
}

export interface HistoryResponse {
  events: HistoryEvent[]
  total: number
  has_more: boolean
}

/* ── Agents ───────────────────────────────────────────────── */

export interface AgentData {
  agentId: string
  label: string
  description: string
  schedule: string
  lastRun: string | null
  lastOutcome: string | null
}

export interface AgentSetting {
  id: string
  label: string
  description: string
  schedule: string
  enabled: boolean
}

/* ── Models ────────────────────────────────────────────────── */

export interface ModelInfo {
  id: string
  name?: string
  runtime?: string
  enabled?: boolean
  capabilities?: string[]
  last_seen_at?: string
}

export interface ModelHealthReport {
  runtimes: Array<{
    name: string
    url: string
    connected: boolean
    models: string[]
    error?: string
  }>
  degraded: boolean
}

/* ── Utilities ────────────────────────────────────────────── */

export const AGENT_LABELS: Record<string, string> = {
  'bd-pipeline': 'BD Pipeline',
  'proposal-engine': 'Proposal Engine',
  'evidence-auditor': 'Evidence Auditor',
  'contract-reviewer': 'Contract Reviewer',
  'staffing-monitor': 'Staffing Monitor',
  'content-engine': 'Content Engine',
  'portfolio-monitor': 'Portfolio Monitor',
  'garden-calendar': 'Garden Calendar',
  'email-campaign': 'Email Campaign',
  'social-engagement': 'Social Engagement',
  'security-monitor': 'Security Monitor',
  'drive-watcher': 'Drive Watcher',
  'invoice-generator': 'Invoice Generator',
  'meeting-transcriber': 'Meeting Transcriber',
}

export function agentLabel(id: string): string {
  return AGENT_LABELS[id] ?? id
}

export const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  executing: 'Running',
  awaiting_approval: 'Awaiting Approval',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  queued: 'Queued',
}

export const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  running: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  executing: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  planning: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  awaiting_approval: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  cancelled: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  queued: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
  ok: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  healthy: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  degraded: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  broken: 'bg-red-500/10 text-red-400 border-red-500/20',
}

export const STATUS_DOT_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500',
  running: 'bg-amber-400',
  executing: 'bg-amber-400',
  planning: 'bg-blue-400',
  awaiting_approval: 'bg-amber-400',
  failed: 'bg-red-500',
  cancelled: 'bg-slate-500',
  queued: 'bg-blue-400',
  pending: 'bg-amber-400',
  approved: 'bg-emerald-500',
  rejected: 'bg-red-500',
  ok: 'bg-emerald-500',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-400',
  broken: 'bg-red-500',
  offline: 'bg-slate-600',
}

/* ── Time formatting ──────────────────────────────────────── */

export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '--'
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) return `${hours}h ${remMins}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDuration(start: string, end?: string | null): string {
  if (!end) return '--'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return '--'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  if (mins < 60) return `${mins}m ${remSecs}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}
