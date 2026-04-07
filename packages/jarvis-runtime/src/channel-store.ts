import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChannelName = "telegram" | "dashboard" | "email" | "webhook";

export type MessageDirection = "inbound" | "outbound";

export type DeliveryStatus = "pending" | "delivered" | "failed";

export type ChannelThread = {
  thread_id: string;
  channel: string;
  external_id: string | null;
  subject: string | null;
  metadata_json: string | null;
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
  sender: string | null;
  command_id: string | null;
  run_id: string | null;
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
    sender?: string;
    commandId?: string;
    runId?: string;
  }): string {
    const messageId = randomUUID();
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
      new Date().toISOString(),
    );
    return messageId;
  }

  /** Get messages for a thread, ordered chronologically. */
  getThreadMessages(threadId: string, limit = 100): ChannelMessage[] {
    return this.db.prepare(
      "SELECT * FROM channel_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?",
    ).all(threadId, limit) as ChannelMessage[];
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
}
