import { loadConfig, openRuntimeDb } from './config.js'
import { JarvisBot } from './bot.js'
import { ChannelStore } from '@jarvis/runtime'
import { TelegramSessionAdapter } from './session-adapter.js'
import { processTelegramQueue } from './relay.js'

// ─── Exports ────────────────────────────────────────────────────────────────

// Preferred: session-based adapter (OpenClaw-native)
export { TelegramSessionAdapter, mapTelegramCommandToSession } from './session-adapter.js'
export type { SessionAdapterConfig } from './session-adapter.js'

// Shared utilities
export { processTelegramQueue } from './relay.js'
export type { ApprovalEntry } from './approvals.js'
export type { CommandContext } from './commands.js'

// ─── Session mode startup ───────────────────────────────────────────────────

/**
 * Start the Telegram adapter in session mode.
 * Messages are delivered via OpenClaw's session system rather than direct API calls.
 * The OpenClaw gateway handles the actual Telegram bot integration.
 */
async function startSessionMode(): Promise<void> {
  const sessionKey = process.env.JARVIS_TELEGRAM_SESSION_KEY ?? 'telegram:main'

  console.log(`[jarvis-telegram] Starting in SESSION mode (key: ${sessionKey})`)
  console.log('[jarvis-telegram] Messages will be delivered via OpenClaw gateway sessions.')

  // Initialize channel store for message tracking (best-effort)
  let channelStore: ChannelStore | undefined
  let threadId: string | undefined
  try {
    const db = openRuntimeDb()
    db.exec('PRAGMA foreign_keys = ON')
    channelStore = new ChannelStore(db)
    threadId = channelStore.getOrCreateThread('telegram', sessionKey, 'Telegram session')
  } catch {
    console.warn('[jarvis-telegram] Channel tracking unavailable -- continuing without it')
  }

  const adapter = new TelegramSessionAdapter({
    sessionKey,
    channelStore,
    threadId,
    // In session mode, route free-text through the OpenClaw gateway session
    // instead of the legacy HTTP loopback to /api/chat/telegram.
    sessionChat: true,
  })

  // In session mode, the OpenClaw gateway drives inbound message delivery.
  // This process only needs to:
  // 1. Poll for pending approvals and send notifications via session
  // 2. Process the relay queue for agent notifications

  const approvalInterval = setInterval(async () => {
    try {
      await adapter.checkApprovals()
    } catch (e) {
      console.error('[jarvis-telegram] Approval check error:', e)
    }
  }, 15_000)

  const relayInterval = setInterval(async () => {
    try {
      const sent = await processTelegramQueue(msg => adapter.send(msg), channelStore, threadId)
      if (sent > 0) console.log(`[jarvis-telegram] Relayed ${sent} queued messages via session`)
    } catch (e) {
      console.error('[jarvis-telegram] Relay error:', e)
    }
  }, 30_000)

  // Send startup notification via session
  try {
    await adapter.send('Jarvis Telegram adapter online (session mode). Send /help for commands.')
  } catch (e) {
    console.warn('[jarvis-telegram] Could not send startup message:', e)
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(approvalInterval)
    clearInterval(relayInterval)
    console.log('\n[jarvis-telegram] Session adapter stopped.')
    process.exit(0)
  })

  // Keep the process alive
  console.log('[jarvis-telegram] Session adapter running. Press Ctrl+C to stop.')
  await new Promise<never>(() => {
    // Block indefinitely -- intervals keep running
  })
}

// ─── Legacy mode startup ────────────────────────────────────────────────────

/**
 * Start the Telegram bot in legacy mode (direct Telegram API).
 * This is the original standalone bot behavior.
 *
 * @deprecated Use session mode (default) instead. Only use JARVIS_TELEGRAM_MODE=legacy if needed.
 */
async function startLegacyMode(): Promise<void> {
  console.warn(
    '[jarvis-telegram] Starting in LEGACY mode (direct Telegram API). ' +
    'Remove JARVIS_TELEGRAM_MODE=legacy to use the default OpenClaw session adapter.'
  )

  const config = loadConfig()
  if (!config) {
    console.error('No Telegram config found at ~/.jarvis/config.json')
    console.error('Create it with: { "telegram": { "bot_token": "...", "chat_id": "..." } }')
    process.exit(1)
  }

  const bot = new JarvisBot(config.telegram)

  // Relay loop: check queue every 30s
  const relayInterval = setInterval(async () => {
    try {
      const sent = await processTelegramQueue(msg => bot.send(msg))
      if (sent > 0) console.log(`Relayed ${sent} queued messages`)
    } catch (e) {
      console.error('Relay error:', e)
    }
  }, 30_000)

  // Graceful shutdown
  process.on('SIGINT', () => {
    bot.stop()
    clearInterval(relayInterval)
    console.log('\nJarvis bot stopped.')
    process.exit(0)
  })

  await bot.start()
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = (process.env.JARVIS_TELEGRAM_MODE ?? 'session').toLowerCase()

  switch (mode) {
    case 'session':
      await startSessionMode()
      break
    case 'legacy':
      await startLegacyMode()
      break
    default:
      console.error(`Unknown JARVIS_TELEGRAM_MODE: "${mode}". Use "session" or "legacy".`)
      process.exit(1)
  }
}

// Only run when invoked directly
const isMainModule = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')
if (isMainModule) {
  main().catch(console.error)
}
