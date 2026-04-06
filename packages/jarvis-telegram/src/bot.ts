import { handleCommand } from './commands.js'
import { loadApprovals, saveApprovals, getUnnotifiedPending, markNotified, formatApprovalMessage } from './approvals.js'
import type { JarvisConfig } from './config.js'

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number }
    chat: { id: number }
    text?: string
  }
}

export class JarvisBot {
  private baseUrl: string
  private chatId: string
  private offset = 0
  private running = false

  constructor(private config: JarvisConfig['telegram']) {
    this.baseUrl = `https://api.telegram.org/bot${config.bot_token}`
    this.chatId = config.chat_id
  }

  async send(text: string): Promise<void> {
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
  }

  async getUpdates(): Promise<TelegramUpdate[]> {
    const res = await fetch(
      `${this.baseUrl}/getUpdates?offset=${this.offset}&timeout=25&allowed_updates=["message"]`
    )
    if (!res.ok) return []
    const data = await res.json() as { ok: boolean; result: TelegramUpdate[] }
    return data.ok ? data.result : []
  }

  async checkApprovals(): Promise<void> {
    const approvals = loadApprovals()
    const unnotified = getUnnotifiedPending(approvals)
    let updated = approvals
    for (const entry of unnotified) {
      try {
        await this.send(formatApprovalMessage(entry))
        updated = markNotified(updated, entry.id)
      } catch {
        // retry next cycle
      }
    }
    if (unnotified.length > 0) {
      saveApprovals(updated)
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
          const response = await handleCommand(text)
          await this.send(response)
        } catch (e) {
          await this.send(`Error: ${String(e)}`)
        }
      }
    }
  }

  async start(): Promise<void> {
    this.running = true
    console.log(`Jarvis Telegram bot started. Chat ID: ${this.chatId}`)
    await this.send('🤖 Jarvis bot online. Send /help for commands.')

    while (this.running) {
      try {
        await Promise.all([
          this.pollOnce(),
          this.checkApprovals()
        ])
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
