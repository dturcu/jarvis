import express from 'express'
import { join } from 'path'
import { crmRouter } from './crm.js'
import { knowledgeRouter } from './knowledge.js'
import { agentsRouter } from './agents.js'
import { approvalsRouter } from './approvals.js'
import { chatRouter } from './chat.js'
import { daemonRouter } from './daemon.js'
import { webhookRouter } from './webhooks.js'
import { pluginsRouter } from './plugins.js'
import { runsRouter } from './runs.js'
import { entitiesRouter } from './entities.js'
import { analyticsRouter } from './analytics.js'
import { settingsRouter } from './settings.js'
import { portalRouter } from './portal.js'
import { godmodeRouter } from './godmode.js'
import { policyRouter } from './policy.js'
import { queueRouter } from './queue.js'
import os from 'os'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { configureJarvisStatePersistence, getJarvisState } from '@jarvis/shared'

const RUNTIME_DB_PATH = join(os.homedir(), '.jarvis', 'runtime.sqlite')
configureJarvisStatePersistence({ databasePath: RUNTIME_DB_PATH })

const app = express()
const PORT = Number(process.env.PORT ?? 4242)
const distPath = join(process.cwd(), 'packages', 'jarvis-dashboard', 'dist')
const indexHtml = join(distPath, 'index.html')

app.use(express.json())
app.use((req, _res, next) => {
  console.log(`[${req.method}] ${req.path}`)
  next()
})
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE')
  next()
})

app.use('/api/crm', crmRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/agents', agentsRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/chat', chatRouter)
app.use('/api/daemon', daemonRouter)
app.use('/api/webhooks', webhookRouter)
app.use('/api/plugins', pluginsRouter)
app.use('/api/runs', runsRouter)
app.use('/api/entities', entitiesRouter)
app.use('/api/analytics', analyticsRouter)
app.use('/api/settings', settingsRouter)
app.use('/portal/api', portalRouter)
app.use('/api/godmode', godmodeRouter)
app.use('/api/policy', policyRouter)
app.use('/api/queue', queueRouter)

app.get('/api/health', (_req, res) => {
  const jarvisDir = join(os.homedir(), '.jarvis')
  let crmCount = 0, docsCount = 0, playbooksCount = 0, decisionsCount = 0
  try {
    const crm = new DatabaseSync(join(jarvisDir, 'crm.db'))
    crmCount = (crm.prepare('SELECT COUNT(*) as n FROM contacts').get() as { n: number }).n
    crm.close()
  } catch {}
  try {
    const kb = new DatabaseSync(join(jarvisDir, 'knowledge.db'))
    docsCount = (kb.prepare('SELECT COUNT(*) as n FROM documents').get() as { n: number }).n
    playbooksCount = (kb.prepare('SELECT COUNT(*) as n FROM playbooks').get() as { n: number }).n
    decisionsCount = (kb.prepare('SELECT COUNT(*) as n FROM decisions').get() as { n: number }).n
    kb.close()
  } catch {}
  // JarvisState runtime stats
  let runtimeStats = { jobs: 0, approvals: 0, dispatches: 0 }
  let pendingApprovals = 0
  try {
    runtimeStats = getJarvisState().getStats()
    const state = getJarvisState()
    const db = (state as unknown as { db: DatabaseSync }).db
    if (db) {
      const row = db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE state = 'pending'").get() as { count: number }
      pendingApprovals = row.count
    }
  } catch {
    // Legacy fallback
    const approvalsPath = join(jarvisDir, 'approvals.json')
    if (fs.existsSync(approvalsPath)) {
      try {
        const a = JSON.parse(fs.readFileSync(approvalsPath, 'utf8')) as Array<{ status: string }>
        pendingApprovals = a.filter(x => x.status === 'pending').length
      } catch {}
    }
  }
  const telegramConfigured = fs.existsSync(join(jarvisDir, 'config.json'))

  res.json({
    ok: true,
    distPath,
    distExists: fs.existsSync(indexHtml),
    crm: { contacts: crmCount },
    knowledge: { documents: docsCount, playbooks: playbooksCount },
    decisions: { total: decisionsCount },
    runtime: runtimeStats,
    pendingApprovals,
    telegramConfigured,
    dashboardUrl: `http://localhost:${PORT}`
  })
})

// SPA: serve index.html for all non-API routes
const serveIndex = (_req: express.Request, res: express.Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(fs.readFileSync(indexHtml, 'utf8'))
}
app.get('/', serveIndex)
// Static assets (JS, CSS) must come after explicit routes
app.use(express.static(distPath))
// Catch-all SPA fallback
app.get('/{*splat}', serveIndex)

app.listen(PORT, () => {
  const hasUI = fs.existsSync(indexHtml)
  console.log(`Jarvis Dashboard API: http://localhost:${PORT}/api/health`)
  console.log(`Jarvis Dashboard UI:  http://localhost:${PORT}  (dist ${hasUI ? '✓' : '✗ — run npm run dashboard:build first'})`)
})
