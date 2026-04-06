import { Router } from 'express'
import os from 'os'
import { join } from 'path'
import fs from 'fs'

const approvalsPath = join(os.homedir(), '.jarvis', 'approvals.json')

interface Approval {
  id: string
  status: string
  [key: string]: unknown
}

function readApprovals(): Approval[] {
  if (!fs.existsSync(approvalsPath)) return []
  try {
    return JSON.parse(fs.readFileSync(approvalsPath, 'utf8')) as Approval[]
  } catch {
    return []
  }
}

function writeApprovals(approvals: Approval[]): void {
  const dir = join(os.homedir(), '.jarvis')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(approvalsPath, JSON.stringify(approvals, null, 2))
}

export const approvalsRouter = Router()

// GET / — list approvals (optionally ?status=pending)
approvalsRouter.get('/', (req, res) => {
  const { status } = req.query as { status?: string }
  const approvals = readApprovals()
  if (status) {
    res.json(approvals.filter(a => a.status === status))
  } else {
    res.json(approvals)
  }
})

// POST /:id/approve — set status=approved
approvalsRouter.post('/:id/approve', (req, res) => {
  const approvals = readApprovals()
  const idx = approvals.findIndex(a => a.id === req.params.id)
  if (idx === -1) {
    res.status(404).json({ error: 'Approval not found' })
    return
  }
  approvals[idx] = { ...approvals[idx], status: 'approved', resolvedAt: new Date().toISOString() }
  writeApprovals(approvals)
  res.json(approvals[idx])
})

// POST /:id/reject — set status=rejected
approvalsRouter.post('/:id/reject', (req, res) => {
  const approvals = readApprovals()
  const idx = approvals.findIndex(a => a.id === req.params.id)
  if (idx === -1) {
    res.status(404).json({ error: 'Approval not found' })
    return
  }
  approvals[idx] = { ...approvals[idx], status: 'rejected', resolvedAt: new Date().toISOString() }
  writeApprovals(approvals)
  res.json(approvals[idx])
})
