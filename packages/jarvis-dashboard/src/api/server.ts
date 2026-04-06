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
import { modelsRouter } from './models.js'
import fs from 'fs'
import { getHealthReport, getReadinessReport } from '@jarvis/runtime'
import { createAuthMiddleware } from './middleware/auth.js'

const app = express()
const PORT = Number(process.env.PORT ?? 4242)
const ALLOWED_ORIGIN = process.env.JARVIS_CORS_ORIGIN ?? `http://localhost:${PORT}`
const distPath = join(process.cwd(), 'packages', 'jarvis-dashboard', 'dist')
const indexHtml = join(distPath, 'index.html')

// Request size limit
app.use(express.json({ limit: '1mb' }))
app.use((req, _res, next) => {
  console.log(`[${req.method}] ${req.path}`)
  next()
})

// CORS — restricted to configured origin (defaults to localhost)
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.header('Access-Control-Max-Age', '3600')
  next()
})

// Handle CORS preflight
app.options('/{*splat}', (_req, res) => {
  res.sendStatus(204)
})

// Auth middleware — protects all /api/* except /api/health and /api/ready
app.use(createAuthMiddleware())

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
app.use('/api/models', modelsRouter)

app.get('/api/health', (_req, res) => {
  const report = getHealthReport()
  res.json({
    ok: report.status !== 'unhealthy',
    status: report.status,
    uptime_seconds: report.uptime_seconds,
    crm: report.crm,
    knowledge: report.knowledge,
    runtime: report.runtime,
    daemon: report.daemon,
    disk_free_gb: report.disk_free_gb,
    distExists: fs.existsSync(indexHtml),
    dashboardUrl: `http://localhost:${PORT}`
  })
})

app.get('/api/ready', (_req, res) => {
  const report = getReadinessReport()
  res.status(report.ready ? 200 : 503).json(report)
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
