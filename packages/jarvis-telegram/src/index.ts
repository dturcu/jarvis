import { loadConfig, QUEUE_FILE } from './config.js'
import { JarvisBot } from './bot.js'
import { processTelegramQueue } from './relay.js'

async function main() {
  const config = loadConfig()
  if (!config) {
    console.error('No Telegram config found at ~/.jarvis/config.json')
    console.error('Create it with: { "telegram": { "bot_token": "...", "chat_id": "..." } }')
    process.exit(1)
  }

  const bot = new JarvisBot(config.telegram)

  // Relay loop: check queue every 30s
  let relayInterval: ReturnType<typeof setInterval>
  relayInterval = setInterval(async () => {
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

// Only run when invoked directly
const isMainModule = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMainModule) {
  main().catch(console.error)
}
