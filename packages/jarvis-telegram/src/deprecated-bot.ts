/**
 * @deprecated The standalone JarvisBot that talks directly to the Telegram API
 * is deprecated. Use TelegramSessionAdapter from './session-adapter.js' instead,
 * which routes all Telegram delivery through OpenClaw sessions.
 *
 * Set JARVIS_TELEGRAM_MODE=session to use the new path.
 * This shim will be removed once the migration is complete.
 */

import { JarvisBot } from './bot.js'

let deprecationWarned = false

function emitDeprecationWarning(): void {
  if (deprecationWarned) return
  deprecationWarned = true
  console.warn(
    '[jarvis-telegram] DEPRECATION: JarvisBot (direct Telegram API mode) is deprecated. ' +
    'Set JARVIS_TELEGRAM_MODE=session to use the OpenClaw session adapter instead. ' +
    'Direct Telegram API access will be removed in a future release.'
  )
}

/**
 * @deprecated Use TelegramSessionAdapter instead.
 *
 * Re-exports the legacy JarvisBot class with a deprecation warning on first use.
 * This ensures existing code that imports from this module continues to work
 * during the transition period.
 */
export class DeprecatedJarvisBot extends JarvisBot {
  constructor(config: ConstructorParameters<typeof JarvisBot>[0]) {
    emitDeprecationWarning()
    super(config)
  }
}

export { JarvisBot }
