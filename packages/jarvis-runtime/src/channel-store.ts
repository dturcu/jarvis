import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChannelName = "telegram" | "dashboard" | "email" | "webhook";

export type MessageDirection = "inbound" | "outbound";

export type DeliveryStatus = "pending" | "delivered" | "failed";

export type ThreadStatus = "active" | "resolved" | "archived";

export type ChannelThread = {
  thread_id: string;
  channel: string;
  external_id: string | null;
  subject: string | null;
  metadata_json: string | null;
  status: ThreadStatus;
  created_at: string;
  updated_at: string;
};

export type ChannelMessage = {
  message_id: string;
  thread_id: string;
  channel: string;
  external_id: string | null;
  direction: string;
  content_preview: string | null;
  content_full: string | null;
  sender: string | null;
  command_id: string | null;
  run_id: string | null;
  approval_id: string | null;
  created_at: string;
};

export type ArtifactDelivery = {
  delivery_id: string;
  run_id: string;
  thread_id: string | null;
  message_id: string | null;
  channel: string;
  artifact_type: string | null;
  content_preview: string | null;
  status: string;
  delivered_at: string | null;
  created_at: string;
};

export type DeliveryAttempt = {
  attempt_id: string;
  delivery_id: string;
  attempted_at: string;
  success: number;
  error: string | null;
};

export type RunTimelineEntry = {
  timestamp: string;
  source: "run_event" | "channel_message" | "artifact_delivery";
  data: Record<string, unknown>;
};

// ─── Store ──────────────────────────────────────────────────────────────────

const MAX_PREVIEW = 500;

function truncate(s: string | undefined | null, max = MAX_PREVIEW): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/**
 * SQLite-backed channel store. Tracks channel threads, messages, and
 * artifact deliveries. Follows the same pattern as RunStore.
 */
export class ChannelStore {
  constructor(private db: DatabaseSync) {}

  // ─── Threads ────────────────────────────────────────────────────────────

  /**
   * Get or create a channel thread. If a thread already exists for the
   * given channel + external_id pair, returns its thread_id and touches
   * updated_at. Otherwise creates a new thread.
   */
  getOrCreateThread(channel: string, externalId: string, subject?: string): string {
    const existing = this.db.prepare(
      "SELECT thread_id FROM channel_threads WHERE channel = ? AND external_id = ?",
    ).get(channel, externalId) as { thread_id: string } | undefined;

    if (existing) {
      this.db.prepare(
        "UPDATE channel_threads SET updated_at = ? WHERE thread_id = ?",
      ).run(new Date().toISOString(), existing.thread_id);
      return existing.thread_id;
    }

    const threadId = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO channel_threads (thread_id, channel, external_id, subject, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(threadId, channel, externalId, subject ?? null, now, now);
    return threadId;
  }

  /** Get a thread by its ID. */
  getThread(threadId: string): ChannelThread | null {
    return this.db.prepare(
      "SELECT * FROM channel_threads WHERE thread_id = ?",
    ).get(threadId) as ChannelThread | undefined ?? null;
  }

  // ─── Messages ───────────────────────────────────────────────────────────

  /** Record a channel message. Returns the generated message_id. */
  recordMessage(opts: {
    threadId: string;
    channel: string;
    externalId?: string;
    direction: MessageDirection;
    contentPreview?: string;
    contentFull?: string;
    sender?: string;
    commandId?: string;
    runId?: string;
    approvalId?: string;
  }): string {
    const messageId = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO channel_messages
        (message_id, thread_id, channel, external_id, direction, content_preview, sender, command_id, run_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      opts.threadId,
      opts.channel,
      opts.externalId ?? null,
      opts.direction,
      truncate(opts.contentPreview),
      opts.sender ?? null,
      opts.commandId ?? null,
      opts.runId ?? null,
      now,
    );

    // Store approval_id if provided (column added in migration 0008)
    if (opts.approvalId != null) {
      try {
        this.db.prepare(
          "UPDATE channel_messages SET approval_id = ? WHERE message_id = ?",
        ).run(opts.approvalId, messageId);
      } catch {
        // approval_id column may not exist yet if migration 0008 hasn't run
      }
    }

    // Store full content if provided (column added in migration 0007)
    if (opts.contentFull != null) {
      try {
        this.db.prepare(
          "UPDATE channel_messages SET content_full = ? WHERE message_id = ?",
        ).run(opts.contentFull, messageId);
      } catch {
        // content_full column may not exist yet if migration 0007 hasn't run
      }
    }

    return messageId;
  }

  /** Get messages for a thread, ordered chronologically. */
  getThreadMessages(threadId: string, limit = 100): ChannelMessage[] {
    return this.db.prepare(
      "SELECT * FROM channel_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?",
    ).all(threadId, limit) as ChannelMessage[];
  }

  /**
   * Get the full content for a message. Returns null if the message doesn't
   * exist, has no full content stored, or the column hasn't been created yet.
   */
  getMessageContent(messageId: string): string | null {
    try {
      const row = this.db.prepare(
        "SELECT content_full FROM channel_messages WHERE message_id = ?",
      ).get(messageId) as { content_full: string | null } | undefined;
      return row?.content_full ?? null;
    } catch {
      // content_full column may not exist yet if migration 0007 hasn't run
      return null;
    }
  }

  // ─── Deliveries ─────────────────────────────────────────────────────────

  /** Record an artifact delivery. Returns the generated delivery_id. */
  recordDelivery(opts: {
    runId: string;
    threadId?: string;
    messageId?: string;
    channel: string;
    artifactType?: string;
    contentPreview?: string;
  }): string {
    const deliveryId = randomUUID();
    this.db.prepare(`
      INSERT INTO artifact_deliveries
        (delivery_id, run_id, thread_id, message_id, channel, artifact_type, content_preview, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      deliveryId,
      opts.runId,
      opts.threadId ?? null,
      opts.messageId ?? null,
      opts.channel,
      opts.artifactType ?? null,
      truncate(opts.contentPreview),
      new Date().toISOString(),
    );
    return deliveryId;
  }

  /** Mark a delivery as successfully delivered. */
  markDelivered(deliveryId: string): void {
    this.db.prepare(
      "UPDATE artifact_deliveries SET status = 'delivered', delivered_at = ? WHERE delivery_id = ?",
    ).run(new Date().toISOString(), deliveryId);
  }

  /** Mark a delivery as failed. */
  markDeliveryFailed(deliveryId: string): void {
    this.db.prepare(
      "UPDATE artifact_deliveries SET status = 'failed' WHERE delivery_id = ?",
    ).run(deliveryId);
  }

  /** Get all deliveries for a run. */
  getRunDeliveries(runId: string): ArtifactDelivery[] {
    return this.db.prepare(
      "SELECT * FROM artifact_deliveries WHERE run_id = ? ORDER BY created_at ASC",
    ).all(runId) as ArtifactDelivery[];
  }

  // ─── Lineage queries ───────────────────────────────────────────────────

  /**
   * Find the thread that originated a command. Looks up the channel_message
   * that has this command_id, then returns its thread_id.
   */
  getThreadByCommandId(commandId: string): string | null {
    const row = this.db.prepare(
      "SELECT thread_id FROM channel_messages WHERE command_id = ? LIMIT 1",
    ).get(commandId) as { thread_id: string } | undefined;
    return row?.thread_id ?? null;
  }

  /**
   * Build a unified timeline for a run, merging run_events, channel_messages,
   * and artifact_deliveries sorted chronologically.
   */
  getRunTimeline(runId: string): RunTimelineEntry[] {
    const entries: RunTimelineEntry[] = [];

    // 1. Run events
    const events = this.db.prepare(
      "SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC",
    ).all(runId) as Array<Record<string, unknown>>;
    for (const e of events) {
      entries.push({
        timestamp: e.created_at as string,
        source: "run_event",
        data: e,
      });
    }

    // 2. Channel messages linked to this run directly
    const directMessages = this.db.prepare(
      "SELECT * FROM channel_messages WHERE run_id = ? ORDER BY created_at ASC",
    ).all(runId) as Array<Record<string, unknown>>;
    for (const m of directMessages) {
      entries.push({
        timestamp: m.created_at as string,
        source: "channel_message",
        data: m,
      });
    }

    // 3. Channel messages linked via command_id (the message that triggered this run)
    const commandMessages = this.db.prepare(`
      SELECT cm.* FROM channel_messages cm
      JOIN runs r ON cm.command_id = r.command_id
      WHERE r.run_id = ? AND cm.run_id IS NULL
      ORDER BY cm.created_at ASC
    `).all(runId) as Array<Record<string, unknown>>;
    for (const m of commandMessages) {
      // Avoid duplicates if a message has both run_id and command_id set
      if (!directMessages.some(dm => (dm as Record<string, unknown>).message_id === m.message_id)) {
        entries.push({
          timestamp: m.created_at as string,
          source: "channel_message",
          data: m,
        });
      }
    }

    // 4. Artifact deliveries
    const deliveries = this.db.prepare(
      "SELECT * FROM artifact_deliveries WHERE run_id = ? ORDER BY created_at ASC",
    ).all(runId) as Array<Record<string, unknown>>;
    for (const d of deliveries) {
      entries.push({
        timestamp: d.created_at as string,
        source: "artifact_delivery",
        data: d,
      });
    }

    // Sort chronologically
    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return entries;
  }

  // ─── Retention ──────────────────────────────────────────────────────────

  /**
   * NULL out content_full for messages older than maxAgeDays. Keeps the
   * message row and content_preview for thread-continuity queries.
   * Returns the number of messages archived (0 if column doesn't exist yet).
   */
  archiveOldContent(maxAgeDays = 30): number {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    try {
      const result = this.db.prepare(
        "UPDATE channel_messages SET content_full = NULL WHERE created_at < ? AND content_full IS NOT NULL"
      ).run(cutoff);
      return (result as { changes: number }).changes;
    } catch { return 0; }
  }

  // ─── Thread status (#43) ──────────────────────────────────────────────

  /** Update the status of a thread (active, resolved, archived). */
  updateThreadStatus(threadId: string, status: ThreadStatus): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE channel_threads SET status = ?, updated_at = ? WHERE thread_id = ?",
    ).run(status, now, threadId);
  }

  /** Get all active threads, optionally filtered by channel. */
  getActiveThreads(channel?: string): ChannelThread[] {
    if (channel) {
      return this.db.prepare(
        "SELECT * FROM channel_threads WHERE status = 'active' AND channel = ? ORDER BY updated_at DESC",
      ).all(channel) as ChannelThread[];
    }
    return this.db.prepare(
      "SELECT * FROM channel_threads WHERE status = 'active' ORDER BY updated_at DESC",
    ).all() as ChannelThread[];
  }

  // ─── Delivery attempts (#44) ──────────────────────────────────────────

  /** Record a delivery attempt for retry tracking. Returns the attempt_id. */
  recordDeliveryAttempt(deliveryId: string, success: boolean, error?: string): string {
    const attemptId = randomUUID();
    this.db.prepare(`
      INSERT INTO delivery_attempts (attempt_id, delivery_id, attempted_at, success, error)
      VALUES (?, ?, ?, ?, ?)
    `).run(attemptId, deliveryId, new Date().toISOString(), success ? 1 : 0, error ?? null);
    return attemptId;
  }

  /** Get all delivery attempts for a given delivery, ordered chronologically. */
  getDeliveryAttempts(deliveryId: string): DeliveryAttempt[] {
    return this.db.prepare(
      "SELECT * FROM delivery_attempts WHERE delivery_id = ? ORDER BY attempted_at ASC",
    ).all(deliveryId) as DeliveryAttempt[];
  }

  // ─── Thread-aware queries (#48) ───────────────────────────────────────

  /** Get threads for a channel, optionally filtered by status. For operator views. */
  getThreadsByChannel(channel: string, status?: ThreadStatus, limit = 50): ChannelThread[] {
    if (status) {
      return this.db.prepare(
        "SELECT * FROM channel_threads WHERE channel = ? AND status = ? ORDER BY updated_at DESC LIMIT ?",
      ).all(channel, status, limit) as ChannelThread[];
    }
    return this.db.prepare(
      "SELECT * FROM channel_threads WHERE channel = ? ORDER BY updated_at DESC LIMIT ?",
    ).all(channel, limit) as ChannelThread[];
  }

  // ─── Thread summaries (#106) ─────────────────────────────────────────

  /** Update the compressed conversation summary for a thread. */
  updateThreadSummary(threadId: string, summary: string): void {
    const now = new Date().toISOString();
    try {
      this.db.prepare(
        "UPDATE channel_threads SET summary = ?, updated_at = ? WHERE thread_id = ?",
      ).run(summary, now, threadId);
    } catch { /* summary column may not exist yet */ }
  }

  /** Get the current compressed summary for a thread (null if none). */
  getThreadSummary(threadId: string): string | null {
    try {
      const row = this.db.prepare(
        "SELECT summary FROM channel_threads WHERE thread_id = ?",
      ).get(threadId) as { summary: string | null } | undefined;
      return row?.summary ?? null;
    } catch { return null; }
  }

  /** Count messages in a thread. */
  getThreadMessageCount(threadId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM channel_messages WHERE thread_id = ?",
    ).get(threadId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }
}
