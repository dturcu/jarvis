import { Router } from 'express'
import { JOB_APPROVAL_REQUIREMENT } from '@jarvis/shared'

export const policyRouter = Router()

type ApprovalLevel = 'not_required' | 'required' | 'conditional'

// GET / — policy matrix grouped by approval requirement
policyRouter.get('/', (_req, res) => {
  const grouped: Record<string, string[]> = {
    autonomous: [],
    gated: [],
    conditional: [],
  }

  for (const [action, requirement] of Object.entries(JOB_APPROVAL_REQUIREMENT)) {
    if (requirement === 'not_required') {
      grouped.autonomous.push(action)
    } else if (requirement === 'required') {
      grouped.gated.push(action)
    } else if (requirement === 'conditional') {
      grouped.conditional.push(action)
    }
  }

  grouped.autonomous.sort()
  grouped.gated.sort()
  grouped.conditional.sort()

  res.json(grouped)
})

// GET /actions/:action — look up approval requirement for a specific action
policyRouter.get('/actions/:action', (req, res) => {
  const action = req.params.action!
  const requirement = (JOB_APPROVAL_REQUIREMENT as Record<string, ApprovalLevel>)[action]

  if (requirement) {
    res.json({ action, requirement })
  } else {
    res.status(404).json({ action, reason: 'Unknown action family' })
  }
})
