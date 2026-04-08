import { handleCommand, type CommandContext } from './commands.js'
import { getUnnotifiedPending, markNotified, formatApprovalMessage } from './approvals.js'
import { openRuntimeDb } from './config.js'
import { ChannelStore } from '@jarvis/runtime'
import type { JarvisConfig } from './config.js'

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; username?: string; first_name?: string }
    chat: { id: number }
    text?: string
  }
}

export class JarvisBot {
  private baseUrl: string
  private chatId: string
  private offset = 0
  private running = false
  private channelStore: ChannelStore | null = null
  private threadId: string | null = null

  // Rate limiter: track timestamps of recent sends (20/min max)
  private sendTimestamps: number[] = []
  private static readonly RATE_LIMIT = 20
  private static readonly RATE_WINDOW_MS = 60_000

  constructor(private config: JarvisConfig['telegram']) {
    this.baseUrl = `https://api.telegram.org/bot${config.bot_token}`
    this.chatId = config.chat_id
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now()
    // Prune timestamps older than the window
    this.sendTimestamps = this.sendTimestamps.filter(
      ts => now - ts < JarvisBot.RATE_WINDOW_MS
    )
    if (this.sendTimestamps.length >= JarvisBot.RATE_LIMIT) {
      const oldest = this.sendTimestamps[0]
      const waitMs = JarvisBot.RATE_WINDOW_MS - (now - oldest)
      if (waitMs > 0) {
        await new Promise(r => setTimeout(r, waitMs))
      }
      // Prune again after waiting
      const after = Date.now()
      this.sendTimestamps = this.sendTimestamps.filter(
        ts => after - ts < JarvisBot.RATE_WINDOW_MS
      )
    }
  }

  async send(text: string): Promise<void> {
    const maxRetries = 3
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.waitForRateLimit()

        const res = await fetch(`${this.baseUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: text.slice(0, 4096), // Telegram max message length
            parse_mode: undefined
          })
        })
        if (!res.ok) {
          const err = await res.text()
          throw new Error(`Telegram send failed: ${err}`)
        }

        this.sendTimestamps.push(Date.now())
        return
      } catch (e) {
        if (attempt === maxRetries) {
          console.error(`Telegram send failed after ${maxRetries} attempts:`, e)
          return // Don't throw — message stays in notification queue for next poll cycle
        }
        const backoffMs = 1000 * Math.pow(2, attempt - 1) // 1s, 2s, 4s
        console.warn(`Telegram send attempt ${attempt}/${maxRetries} failed, retrying in ${backoffMs}ms`)
        await new Promise(r => setTimeout(r, backoffMs))
      }
    }
  }

  async getUpdates(): Promise<TelegramUpdate[]> {
    const res = await fetch(
      `${this.baseUrl}/getUpdates?offset=${this.offset}&timeout=25&allowed_updates=["message"]`
    )
    if (!res.ok) return []
    const data = await res.json() as { ok: boolean; result: TelegramUpdate[] }
    return data.ok ? data.result : []
  }

  /**
   * Check for pending approvals in runtime.db that haven't been sent
   * to Telegram yet, and send notifications for them.
   */
  async checkApprovals(): Promise<void> {
    let db;
    try {
      db = openRuntimeDb()
    } catch {
      return
    }

    try {
      const unnotified = getUnnotifiedPending(db)
      for (const entry of unnotified) {
        try {
          await this.send(formatApprovalMessage(entry))
          markNotified(db, entry.id)

          // Record the outbound approval notification as a channel message
          if (this.channelStore && this.threadId) {
            try {
              this.channelStore.recordMessage({
                threadId: this.threadId,
                channel: 'telegram',
                direction: 'outbound',
                contentPreview: `Approval needed: ${entry.action} by ${entry.agent}`,
                sender: 'jarvis',
                runId: entry.run_id,
              })
            } catch { /* best-effort */ }
          }
        } catch {
          // retry next cycle
        }
      }
    } finally {
      try { db.close() } catch {}
    }
  }

  async pollOnce(): Promise<void> {
    const updates = await this.getUpdates()
    for (const update of updates) {
      this.offset = Math.max(this.offset, update.update_id + 1)
      const text = update.message?.text
      // Only respond to messages from our configured chat
      const fromChat = String(update.message?.chat.id ?? '')
      if (text && fromChat === this.chatId) {
        try {
          // Build command context with channel tracking
          const senderName = update.message?.from?.username
            ?? update.message?.from?.first_name
            ?? 'unknown'
          const ctx: CommandContext = {
            channelStore: this.channelStore ?? undefined,
            threadId: this.threadId ?? undefined,
            telegramMessageId: String(update.message?.message_id ?? ''),
            chatId: fromChat,
            sender: senderName,
          }

          // Inbound message recording is handled by createCommand() for
          // trigger commands (avoids duplicate rows). For non-trigger commands
          // (status, crm, help), record after handleCommand returns.
          const response = await handleCommand(text, ctx)
          await this.send(response)

          // Record outbound response
          if (this.channelStore && this.threadId) {
            try {
              this.channelStore.recordMessage({
                threadId: this.threadId,
                channel: 'telegram',
                direction: 'outbound',
                contentPreview: response,
                sender: 'jarvis',
              })
            } catch { /* best-effort */ }
          }
        } catch (e) {
          await this.send(`Error: ${String(e)}`)
        }
      }
    }
  }

  async start(): Promise<void> {
    this.running = true
    console.log(`Jarvis Telegram bot started. Chat ID: ${this.chatId}`)

    // Initialize channel store for message tracking
    try {
      const db = openRuntimeDb()
      db.exec('PRAGMA foreign_keys = ON')
      this.channelStore = new ChannelStore(db)
      this.threadId = this.channelStore.getOrCreateThread('telegram', this.chatId, 'Telegram chat')
    } catch {
      console.warn('Channel tracking unavailable — continuing without it')
    }

    await this.send('🤖 Jarvis bot online. Send /help for commands.')

    while (this.running) {
      try {
        await this.pollOnce();
        await this.checkApprovals();
      } catch (e) {
        console.error('Bot poll error:', e)
      }
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  stop(): void {
    this.running = false
  }
}
