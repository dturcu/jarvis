/**
 * /api/conversations — Database-backed conversation persistence.
 *
 * Stores chat conversations in runtime.db via ChannelStore (channel_threads +
 * channel_messages). Supports both "dashboard-chat" (Ask Jarvis) and
 * "dashboard-godmode" (Godmode) channels.
 *
 * Long conversations are automatically summarized via a non-blocking LLM call
 * when the message count or estimated token count exceeds the configured
 * thresholds. The summary is stored on the thread and served as context when
 * the conversation is resumed.
 */

import { Router } from 'express'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { ChannelStore } from '@jarvis/runtime'
import { randomUUID } from 'node:crypto'

// ─── Config ────────────────────────────────────────────────────────────────

const RUNTIME_DB_PATH = path.join(os.homedir(), '.jarvis', 'runtime.db')
const LMS_URL = process.env.LMS_URL ?? 'http://localhost:1234'
const LMS_MODEL = process.env.LMS_MODEL ?? 'auto'
const CONTEXT_WINDOW = Number(process.env.LMS_CONTEXT_WINDOW ?? '8192')
const SUMMARY_MSG_THRESHOLD = 10
const SUMMARY_TOKEN_RATIO = 0.7 // trigger when estimated tokens > 70% of context
const RECENT_MESSAGES_COUNT = 6 // keep this many recent messages alongside summary

// ─── Helpers ───────────────────────────────────────────────────────────────

function openDb(): DatabaseSync {
  const db = new DatabaseSync(RUNTIME_DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  return db
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

function deriveTitle(content: string): string {
  const trimmed = content.trim()
  return trimmed.length > 50 ? trimmed.slice(0, 47) + '...' : trimmed
}

// ─── Summarization ─────────────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `Compress this conversation into a brief context summary (max 300 words). Capture:
- Key topics discussed
- Decisions made
- User preferences expressed
- Any pending questions or tasks
Write in third person as a context briefing for an AI assistant resuming this conversation.`

async function generateSummary(
  messages: Array<{ direction: string; content_preview: string | null }>,
  model: string,
): Promise<string | null> {
  const conversationText = messages
    .map(m => `${m.direction === 'inbound' ? 'User' : 'Assistant'}: ${m.content_preview ?? ''}`)
    .join('\n')

  try {
    const res = await fetch(`${LMS_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model === 'auto' ? undefined : model,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: conversationText },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: 500,
      }),
    })
    if (!res.ok) return null
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return json.choices?.[0]?.message?.content?.trim() ?? null
  } catch {
    return null
  }
}

function shouldSummarize(
  messages: Array<{ content_preview: string | null }>,
): boolean {
  if (messages.length > SUMMARY_MSG_THRESHOLD) return true
  const totalChars = messages.reduce((sum, m) => sum + (m.content_preview?.length ?? 0), 0)
  if (estimateTokens(totalChars.toString()) > SUMMARY_TOKEN_RATIO * CONTEXT_WINDOW) return true
  // More accurate: estimate from actual text
  if (totalChars / 3.5 > SUMMARY_TOKEN_RATIO * CONTEXT_WINDOW) return true
  return false
}

/** Fire-and-forget summary generation. Does not block the caller. */
function triggerSummaryIfNeeded(threadId: string, model: string): void {
  // Run async — errors are logged but don't propagate
  (async () => {
    try {
      const db = openDb()
      const cs = new ChannelStore(db)
      const messages = cs.getThreadMessages(threadId, 500)
      if (!shouldSummarize(messages)) { db.close(); return }

      const summary = await generateSummary(messages, model)
      if (summary) {
        // Re-open db in case the connection went stale during LLM call
        const db2 = openDb()
        const cs2 = new ChannelStore(db2)
        cs2.updateThreadSummary(threadId, summary)
        db2.close()
      }
      db.close()
    } catch (e) {
      console.error('[conversations] summary generation failed:', e)
    }
  })()
}

// ─── Router ────────────────────────────────────────────────────────────────

const router = Router()

/**
 * GET /api/conversations?channel=dashboard-godmode
 * List conversations for a channel.
 */
router.get('/', (req, res) => {
  const channel = (req.query.channel as string) ?? 'dashboard-godmode'
  try {
    const db = openDb()
    const cs = new ChannelStore(db)
    const threads = cs.getThreadsByChannel(channel, undefined, 100)

    const result = threads
      .filter(t => t.status !== 'archived')
      .map(t => ({
        id: t.thread_id,
        title: t.subject ?? 'Untitled',
        updatedAt: t.updated_at,
        messageCount: cs.getThreadMessageCount(t.thread_id),
        hasSummary: cs.getThreadSummary(t.thread_id) !== null,
      }))

    db.close()
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: 'Failed to list conversations' })
  }
})

/**
 * POST /api/conversations
 * Create a new conversation.
 * Body: { channel: string, title?: string }
 */
router.post('/', (req, res) => {
  const { channel, title } = req.body as { channel?: string; title?: string }
  const ch = channel ?? 'dashboard-godmode'

  try {
    const db = openDb()
    const cs = new ChannelStore(db)
    const externalId = `conv-${Date.now()}-${randomUUID().slice(0, 8)}`
    const threadId = cs.getOrCreateThread(ch, externalId, title ?? 'New chat')
    db.close()
    res.json({ id: threadId, externalId })
  } catch {
    res.status(500).json({ error: 'Failed to create conversation' })
  }
})

/**
 * GET /api/conversations/:id
 * Get conversation detail: messages + summary.
 */
router.get('/:id', (req, res) => {
  const { id } = req.params
  try {
    const db = openDb()
    const cs = new ChannelStore(db)
    const thread = cs.getThread(id)
    if (!thread) { db.close(); res.status(404).json({ error: 'Conversation not found' }); return }

    const messages = cs.getThreadMessages(id, 500)
    const summary = cs.getThreadSummary(id)
    db.close()

    res.json({
      id: thread.thread_id,
      channel: thread.channel,
      title: thread.subject,
      status: thread.status,
      summary,
      messages: messages.map(m => ({
        id: m.message_id,
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.content_preview ?? '',
        createdAt: m.created_at,
      })),
    })
  } catch {
    res.status(500).json({ error: 'Failed to load conversation' })
  }
})

/**
 * POST /api/conversations/:id/messages
 * Append a message to a conversation.
 * Body: { role: 'user' | 'assistant', content: string, model?: string }
 * Triggers summary generation after assistant messages if thresholds exceeded.
 */
router.post('/:id/messages', (req, res) => {
  const { id } = req.params
  const { role, content, model } = req.body as {
    role: 'user' | 'assistant'
    content: string
    model?: string
  }

  if (!role || !content) {
    res.status(400).json({ error: 'role and content required' })
    return
  }

  try {
    const db = openDb()
    const cs = new ChannelStore(db)
    const thread = cs.getThread(id)
    if (!thread) { db.close(); res.status(404).json({ error: 'Conversation not found' }); return }

    const direction = role === 'user' ? 'inbound' : 'outbound'
    const messageId = cs.recordMessage({
      threadId: id,
      channel: thread.channel,
      direction: direction as 'inbound' | 'outbound',
      contentPreview: content,
      contentFull: content,
      sender: role === 'user' ? 'operator' : 'jarvis',
    })

    // Update thread title from first user message
    if (role === 'user') {
      const msgCount = cs.getThreadMessageCount(id)
      if (msgCount <= 1) {
        // First message — set title
        db.prepare('UPDATE channel_threads SET subject = ?, updated_at = ? WHERE thread_id = ?')
          .run(deriveTitle(content), new Date().toISOString(), id)
      }
    }

    db.close()

    // Trigger summary after assistant messages (non-blocking)
    if (role === 'assistant') {
      triggerSummaryIfNeeded(id, model ?? LMS_MODEL)
    }

    res.json({ messageId })
  } catch {
    res.status(500).json({ error: 'Failed to record message' })
  }
})

/**
 * DELETE /api/conversations/:id
 * Archive a conversation (soft delete).
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params
  try {
    const db = openDb()
    const cs = new ChannelStore(db)
    cs.updateThreadStatus(id, 'archived')
    db.close()
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Failed to archive conversation' })
  }
})

/**
 * GET /api/conversations/:id/context
 * Get LLM-ready conversation context.
 * If conversation is short (<=threshold), returns all messages.
 * If long, returns { summary, recentMessages } for efficient context injection.
 */
router.get('/:id/context', (req, res) => {
  const { id } = req.params
  try {
    const db = openDb()
    const cs = new ChannelStore(db)
    const thread = cs.getThread(id)
    if (!thread) { db.close(); res.status(404).json({ error: 'Conversation not found' }); return }

    const allMessages = cs.getThreadMessages(id, 500)
    const summary = cs.getThreadSummary(id)
    db.close()

    const formatted = allMessages.map(m => ({
      role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
      content: m.content_preview ?? '',
    }))

    // If we have a summary and conversation is long, use compressed context
    if (summary && formatted.length > SUMMARY_MSG_THRESHOLD) {
      const recent = formatted.slice(-RECENT_MESSAGES_COUNT)
      res.json({
        mode: 'summarized',
        summary,
        recentMessages: recent,
        totalMessages: formatted.length,
      })
      return
    }

    // Short conversation — return everything
    res.json({
      mode: 'full',
      summary: null,
      messages: formatted,
      totalMessages: formatted.length,
    })
  } catch {
    res.status(500).json({ error: 'Failed to build context' })
  }
})

export const conversationsRouter = router
