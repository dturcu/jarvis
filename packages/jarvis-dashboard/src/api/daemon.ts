import { Router } from 'express'
import { readDaemonStatus } from './daemon-status.js'

export const daemonRouter = Router()

// GET / — daemon status (read from DB heartbeat)
daemonRouter.get('/status', (_req, res) => {
  const status = readDaemonStatus()
  res.json(status)
})
