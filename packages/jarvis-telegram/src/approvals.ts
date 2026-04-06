import fs from 'fs'
import { APPROVALS_FILE } from './config.js'

export type ApprovalEntry = {
  id: string
  agent: string
  action: string
  payload: string
  created_at: string
  status: 'pending' | 'approved' | 'rejected'
  notified?: boolean
}

export function loadApprovals(): ApprovalEntry[] {
  if (!fs.existsSync(APPROVALS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(APPROVALS_FILE, 'utf8')) as ApprovalEntry[]
  } catch { return [] }
}

export function saveApprovals(approvals: ApprovalEntry[]): void {
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(approvals, null, 2))
}

export function getUnnotifiedPending(approvals: ApprovalEntry[]): ApprovalEntry[] {
  return approvals.filter(a => a.status === 'pending' && !a.notified)
}

export function markNotified(approvals: ApprovalEntry[], id: string): ApprovalEntry[] {
  return approvals.map(a => a.id === id ? { ...a, notified: true } : a)
}

export function setApprovalStatus(approvals: ApprovalEntry[], id: string, status: 'approved' | 'rejected'): ApprovalEntry[] {
  return approvals.map(a => a.id === id ? { ...a, status } : a)
}

export function formatApprovalMessage(entry: ApprovalEntry): string {
  const preview = entry.payload.length > 300 ? entry.payload.slice(0, 300) + '...' : entry.payload
  return `⚠️ APPROVAL NEEDED\nAgent: ${entry.agent}\nAction: ${entry.action}\n\n${preview}\n\nReply:\n/approve ${entry.id.slice(0, 8)}\n/reject ${entry.id.slice(0, 8)}`
}
