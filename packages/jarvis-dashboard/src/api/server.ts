import express from 'express'
import { join } from 'path'
import path from 'path'
import os from 'os'
import { crmRouter } from './crm.js'
import { knowledgeRouter } from './knowledge.js'
import { agentsRouter } from './agents.js'
import { approvalsRouter } from './approvals.js'
import { chatRouter } from './chat.js'
import { daemonRouter } from './daemon.js'
// webhookV2Router removed — Wave 1 retirement (Epic 8). Ingress is OpenClaw-owned.
// import { webhookV2Router } from './webhooks-v2.js'
import { pluginsRouter } from './plugins.js'
import { runsRouter } from './runs.js'
import { attentionRouter } from './attention.js'
import { entitiesRouter } from './entities.js'
import { analyticsRouter } from './analytics.js'
import { settingsRouter } from './settings.js'
import { backupRouter } from './backup.js'
import { safemodeRouter } from './safemode.js'
import { portalRouter } from './portal.js'
import { godmodeRouter } from './godmode.js'
import { listAllModels } from './tool-infra.js'
import { createSessionChatRoute } from './session-chat-adapter.js'
import { tasksRouter } from './tasks.js'
import { modelsRouter } from './models.js'
import { runtimesRouter } from './runtimes.js'
import { queueRouter } from './queue.js'
import { policyRouter } from './policy.js'
import { workflowsRouter } from './workflows.js'
import { historyRouter } from './history.js'
import { packsRouter } from './packs.js'
import { serviceRouter } from './service.js'
import { supportRouter } from './support.js'
import { repairRouter } from './repair.js'
import { provenanceRouter } from './provenance.js'
import { evalRouter } from './eval.js'
import { modeRouter } from './settings.js'
import { conversationsRouter } from './conversations.js'
import fs from 'fs'
import { getHealthReport, getReadinessReport, loadConfig, writeTelegramQueue } from '@jarvis/runtime'
import { getMetricsText, getMetricsContentType, initTelemetry, shutdownTelemetry } from '@jarvis/observability'
import { createAuthMiddleware, authRouter, getPreferredDashboardToken } from './middleware/auth.js'
import { DatabaseSync } from 'node:sqlite'

const app = express()
const PORT = Number(process.env.PORT ?? 4242)
const ALLOWED_ORIGIN = process.env.JARVIS_CORS_ORIGIN ?? `http://localhost:${PORT}`
const distPath = join(process.cwd(), 'packages', 'jarvis-dashboard', 'dist')
const indexHtml = join(distPath, 'index.html')
const ACCESS_LOG_MODE = process.env.JARVIS_HTTP_ACCESS_LOG ?? 'quiet'
const QUIET_REQUEST_PATHS = new Set([
  '/api/attention',
  '/api/chat/models',
  '/api/daemon/status',
  '/api/health',
  '/api/mode',
  '/api/models/health',
  '/api/safemode',
  '/favicon.ico',
])
const DASHBOARD_AUTH_COOKIE = 'jarvis_api_token'

function shouldLogRequest(pathname: string): boolean {
  if (ACCESS_LOG_MODE === 'all') return true
  if (QUIET_REQUEST_PATHS.has(pathname)) return false
  if (pathname.startsWith('/assets/')) return false
  return true
}

function shouldAttachDashboardCookie(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

// ─── Appliance Mode Checks ───────────────────────────────────────────────
{
  let applianceMode = false
  let hasConfigToken = false
  try {
    const cfg = loadConfig()
    applianceMode = cfg.appliance_mode
    const cfgRaw = cfg as Record<string, unknown>
    hasConfigToken = !!(cfgRaw.api_token || cfgRaw.api_tokens)
  } catch { /* config may not exist yet */ }

  if (applianceMode) {
    console.log('  Appliance mode: enforcing secure defaults')

    // Verify API tokens exist — check both env var AND config file
    const hasEnvToken = !!process.env.JARVIS_API_TOKEN
    if (!hasEnvToken && !hasConfigToken) {
      console.error('  FATAL: appliance_mode is enabled but no API token is configured.')
      console.error('  Set JARVIS_API_TOKEN env var or add api_token to ~/.jarvis/config.json.')
      process.exit(1)
    }

    // Verify bind host is localhost
    const bindHost = process.env.JARVIS_BIND_HOST ?? '127.0.0.1'
    if (bindHost === '0.0.0.0') {
      console.warn('  WARNING: appliance_mode is enabled but JARVIS_BIND_HOST=0.0.0.0 — server is exposed on all interfaces')
    }
  }
}

// Request size limit
app.use(express.json({
  limit: '1mb',
  // Capture the raw body for webhook HMAC verification.
  // GitHub signs the exact bytes, not re-serialized JSON.
  verify: (req: import('http').IncomingMessage, _res, buf) => {
    (req as any).rawBody = buf;
  },
}))
app.use((req, _res, next) => {
  if (shouldLogRequest(req.path)) {
    console.log(`[${req.method}] ${req.path}`)
  }
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

app.use('/api/auth', authRouter)
app.use('/api/crm', crmRouter)
// Alias: /api/crm/contacts handled by crmRouter via GET /contacts route
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/agents', agentsRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/chat', chatRouter)
app.use('/api/daemon', daemonRouter)
// Wave 1 retirement: Dashboard webhook routes REMOVED.
// Webhook ingress is now exclusively OpenClaw-owned.
// The normalizer in @jarvis/shared remains for the OpenClaw webhook plugin.
// Legacy route code retained in webhooks-v2.ts for reference only.
// Epic 4: Unified task visibility
app.use('/api/tasks', tasksRouter)
app.use('/api/plugins', pluginsRouter)
app.use('/api/runs', runsRouter)
app.use('/api/attention', attentionRouter)
app.use('/api/entities', entitiesRouter)
app.use('/api/analytics', analyticsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/backup', backupRouter)
app.use('/api/safemode', safemodeRouter)
app.use('/portal/api', portalRouter)
// Mount models route BEFORE the session adapter to prevent shadowing
app.get('/api/godmode/models', async (_req, res) => {
  try {
    const result = await listAllModels()
    res.json({ models: result.models, default: result.models[0] ?? '', provider: result.provider })
  } catch {
    res.json({ models: [], default: '' })
  }
})
app.use('/api/godmode', createSessionChatRoute())
app.use('/api/godmode/legacy', godmodeRouter)
app.use('/api/models', modelsRouter)
app.use('/api/runtimes', runtimesRouter)
app.use('/api/queue', queueRouter)
app.use('/api/policy', policyRouter)
app.use('/api/workflows', workflowsRouter)
app.use('/api/history', historyRouter)
app.use('/api/packs', packsRouter)
app.use('/api/service', serviceRouter)
app.use('/api/support', supportRouter)
app.use('/api/repair', repairRouter)
app.use('/api/provenance', provenanceRouter)
app.use('/api/eval', evalRouter)
app.use('/api/mode', modeRouter)
app.use('/api/conversations', conversationsRouter)

// ── Telegram routes ──────────────────────────────────────────────────────────
app.get('/api/telegram/status', (_req, res) => {
  const config = loadConfig()
  const hasToken = !!(config as Record<string, unknown> & { telegram?: { bot_token?: string } })?.telegram?.bot_token
  res.json({ ok: true, configured: hasToken, mode: process.env.JARVIS_TELEGRAM_MODE ?? 'session' })
})

app.post('/api/telegram/send', (req, res) => {
  const { message } = req.body as { message?: string }
  if (!message) {
    res.status(400).json({ error: 'message is required' })
    return
  }
  try {
    const RUNTIME_DB_PATH = path.join(os.homedir(), '.jarvis', 'runtime.db')
    const db = new DatabaseSync(RUNTIME_DB_PATH)
    writeTelegramQueue('dashboard', message, db)
    db.close()
    res.json({ ok: true, queued: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/health', (_req, res) => {
  const report = getHealthReport()
  // Return 503 for any non-healthy status so load balancers, process
  // managers, and uptime monitors pull us out of rotation when the daemon
  // is stale, models are unavailable, or disk is low — previously we
  // returned 200 for 'degraded', masking real outages.
  const httpStatus = report.status === 'healthy' ? 200 : 503
  res.status(httpStatus).json({
    ok: report.status !== 'unhealthy',
    healthy: report.status === 'healthy',
    status: report.status,
    uptime_seconds: report.uptime_seconds,
    crm: report.crm,
    knowledge: report.knowledge,
    runtime: report.runtime,
    daemon: report.daemon,
    channels: report.channels,
    workers: report.workers,
    disk_free_gb: report.disk_free_gb,
    mode: process.env.JARVIS_MODE ?? 'dev',
    distExists: fs.existsSync(indexHtml),
    dashboardUrl: `http://localhost:${PORT}`
  })
})

// Prometheus metrics endpoint — returns all registered metrics in exposition format
app.get('/api/metrics', async (_req, res) => {
  try {
    const text = await getMetricsText()
    res.set('Content-Type', getMetricsContentType()).send(text)
  } catch {
    res.status(500).json({ error: 'Failed to collect metrics' })
  }
})

app.get('/api/ready', (_req, res) => {
  const report = getReadinessReport()
  res.status(report.ready ? 200 : 503).json(report)
})

// SPA: serve index.html for all non-API routes
const hasUI = fs.existsSync(indexHtml)

if (hasUI) {
  const serveIndex = (req: express.Request, res: express.Response) => {
    const dashboardToken = getPreferredDashboardToken()
    if (dashboardToken && shouldAttachDashboardCookie(req.hostname)) {
      const isProduction = process.env.JARVIS_MODE === 'production'
      res.cookie(DASHBOARD_AUTH_COOKIE, dashboardToken.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: isProduction,
        path: '/api',
      })
    } else {
      res.clearCookie(DASHBOARD_AUTH_COOKIE, { path: '/api' })
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(fs.readFileSync(indexHtml, 'utf8'))
  }
  app.get('/', serveIndex)
  app.use(express.static(distPath))
  app.get('/{*splat}', (req: express.Request, res: express.Response) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/portal/')) {
      return res.status(404).json({ error: 'Not found' })
    }
    return serveIndex(req, res)
  })
} else {
  // Friendly error page when dashboard hasn't been built
  const notBuiltHtml = `<!DOCTYPE html>
<html><head><title>Jarvis - Dashboard Not Built</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
  h1 { color: #1a56db; } code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
  .cmd { background: #1e293b; color: #e2e8f0; padding: 12px 16px; border-radius: 8px; font-family: monospace; margin: 12px 0; }
  .status { margin-top: 24px; padding: 12px; background: #ecfdf5; border-radius: 8px; border: 1px solid #a7f3d0; }
  a { color: #1a56db; }
</style></head>
<body>
  <h1>Jarvis Dashboard</h1>
  <p>The dashboard UI hasn't been built yet. The API is running and healthy.</p>
  <p><strong>To build the dashboard:</strong></p>
  <div class="cmd">npm run dashboard:build</div>
  <p>Then refresh this page.</p>
  <div class="status">
    <strong>API Status:</strong> <a href="/api/health">/api/health</a> |
    <a href="/api/ready">/api/ready</a>
  </div>
</body></html>`

  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(notBuiltHtml)
  })
  app.get('/{*splat}', (_req, res) => {
    if (_req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(notBuiltHtml)
  })
}

// Bind explicitly to localhost unless JARVIS_BIND_HOST is set.
// Production appliance must not accidentally listen on 0.0.0.0.
const BIND_HOST = process.env.JARVIS_BIND_HOST ?? '127.0.0.1'

// Initialize OpenTelemetry before accepting requests so HTTP spans and
// metrics are captured for every route. Daemon uses port 9464, so the
// dashboard defaults to 9465; override via DASHBOARD_OTEL_PROMETHEUS_PORT.
if (process.env.JARVIS_DISABLE_OTEL !== '1') {
  try {
    const otelPort = Number(process.env.DASHBOARD_OTEL_PROMETHEUS_PORT ?? 9465)
    initTelemetry({ prometheusPort: otelPort, serviceName: 'jarvis-dashboard' })
    console.log(`  OTel:       Prometheus on :${otelPort}`)
  } catch (e) {
    console.warn(`  OTel:       init failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const server = app.listen(PORT, BIND_HOST, () => {
  console.log('')
  console.log(`  Jarvis Dashboard`)
  console.log(`  ─────────────────────────────────────`)
  console.log(`  Bound to:   ${BIND_HOST}:${PORT}`)
  console.log(`  API:        http://localhost:${PORT}/api/health`)
  console.log(`  Dashboard:  http://localhost:${PORT}  ${hasUI ? '✓' : '(not built — run: npm run dashboard:build)'}`)
  if (BIND_HOST === '0.0.0.0') {
    console.log(`  ⚠ WARNING: listening on all interfaces — ensure firewall is configured`)
  }
  console.log('')
})

async function shutdownDashboard(signal: NodeJS.Signals): Promise<void> {
  console.log(`\n  Received ${signal}, shutting down dashboard...`)
  server.close()
  try { await shutdownTelemetry() } catch { /* best-effort */ }
  process.exit(0)
}
process.on('SIGTERM', shutdownDashboard)
process.on('SIGINT', shutdownDashboard)
