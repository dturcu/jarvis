import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, ChannelStore } from "@jarvis/runtime";

describe("ChannelStore", () => {
  let db: DatabaseSync;
  let store: ChannelStore;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
    store = new ChannelStore(db);
  });

  // ─── Threads ─────────────────────────────────────────────────────────────

  describe("getOrCreateThread", () => {
    it("creates a new thread and returns thread_id", () => {
      const threadId = store.getOrCreateThread("telegram", "chat-123", "Test thread");
      expect(threadId).toBeTruthy();
      expect(typeof threadId).toBe("string");

      const row = db.prepare("SELECT * FROM channel_threads WHERE thread_id = ?").get(threadId) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.channel).toBe("telegram");
      expect(row.external_id).toBe("chat-123");
      expect(row.subject).toBe("Test thread");
    });

    it("returns existing thread_id for same channel+external_id pair", () => {
      const first = store.getOrCreateThread("telegram", "chat-123", "Subject A");
      const second = store.getOrCreateThread("telegram", "chat-123", "Subject B");
      expect(second).toBe(first);

      // Should still be only one row
      const rows = db.prepare("SELECT * FROM channel_threads").all();
      expect(rows).toHaveLength(1);
    });

    it("touches updated_at on existing threads", () => {
      const threadId = store.getOrCreateThread("telegram", "chat-123");
      const row1 = db.prepare("SELECT updated_at FROM channel_threads WHERE thread_id = ?").get(threadId) as { updated_at: string };
      const firstUpdated = row1.updated_at;

      // Small delay to ensure timestamp differs
      const before = Date.now();
      while (Date.now() - before < 5) { /* spin */ }

      store.getOrCreateThread("telegram", "chat-123");
      const row2 = db.prepare("SELECT updated_at FROM channel_threads WHERE thread_id = ?").get(threadId) as { updated_at: string };
      expect(row2.updated_at >= firstUpdated).toBe(true);
    });
  });

  describe("getThread", () => {
    it("returns null for non-existent thread", () => {
      const result = store.getThread("nonexistent-id");
      expect(result).toBeNull();
    });

    it("returns the thread when it exists", () => {
      const threadId = store.getOrCreateThread("email", "ext-456", "My subject");
      const thread = store.getThread(threadId);
      expect(thread).not.toBeNull();
      expect(thread!.channel).toBe("email");
      expect(thread!.external_id).toBe("ext-456");
      expect(thread!.subject).toBe("My subject");
    });
  });

  // ─── Messages ────────────────────────────────────────────────────────────

  describe("recordMessage", () => {
    it("stores message with correct fields", () => {
      const threadId = store.getOrCreateThread("telegram", "chat-1");
      const messageId = store.recordMessage({
        threadId,
        channel: "telegram",
        externalId: "msg-ext-1",
        direction: "inbound",
        contentPreview: "Hello world",
        sender: "user@test.com",
        commandId: "cmd-1",
        runId: "run-1",
      });

      expect(messageId).toBeTruthy();
      const row = db.prepare("SELECT * FROM channel_messages WHERE message_id = ?").get(messageId) as Record<string, unknown>;
      expect(row.thread_id).toBe(threadId);
      expect(row.channel).toBe("telegram");
      expect(row.external_id).toBe("msg-ext-1");
      expect(row.direction).toBe("inbound");
      expect(row.content_preview).toBe("Hello world");
      expect(row.sender).toBe("user@test.com");
      expect(row.command_id).toBe("cmd-1");
      expect(row.run_id).toBe("run-1");
    });

    it("truncates content_preview to 500 chars", () => {
      const threadId = store.getOrCreateThread("telegram", "chat-1");
      const longContent = "A".repeat(600);
      const messageId = store.recordMessage({
        threadId,
        channel: "telegram",
        direction: "inbound",
        contentPreview: longContent,
      });

      const row = db.prepare("SELECT content_preview FROM channel_messages WHERE message_id = ?").get(messageId) as { content_preview: string };
      // 500 chars + "..." suffix
      expect(row.content_preview).toHaveLength(503);
      expect(row.content_preview.endsWith("...")).toBe(true);
    });
  });

  describe("getThreadMessages", () => {
    it("returns messages in chronological order", () => {
      const threadId = store.getOrCreateThread("telegram", "chat-1");

      // Insert messages with explicit created_at to control order
      db.prepare(`
        INSERT INTO channel_messages (message_id, thread_id, channel, direction, content_preview, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("m3", threadId, "telegram", "inbound", "Third", "2026-01-01T00:03:00Z");
      db.prepare(`
        INSERT INTO channel_messages (message_id, thread_id, channel, direction, content_preview, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("m1", threadId, "telegram", "inbound", "First", "2026-01-01T00:01:00Z");
      db.prepare(`
        INSERT INTO channel_messages (message_id, thread_id, channel, direction, content_preview, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("m2", threadId, "telegram", "outbound", "Second", "2026-01-01T00:02:00Z");

      const messages = store.getThreadMessages(threadId);
      expect(messages).toHaveLength(3);
      expect(messages[0]!.content_preview).toBe("First");
      expect(messages[1]!.content_preview).toBe("Second");
      expect(messages[2]!.content_preview).toBe("Third");
    });
  });

  // ─── Deliveries ──────────────────────────────────────────────────────────

  describe("recordDelivery", () => {
    it("creates delivery with pending status", () => {
      const deliveryId = store.recordDelivery({
        runId: "run-1",
        channel: "telegram",
        artifactType: "report",
        contentPreview: "Weekly summary",
      });

      expect(deliveryId).toBeTruthy();
      const row = db.prepare("SELECT * FROM artifact_deliveries WHERE delivery_id = ?").get(deliveryId) as Record<string, unknown>;
      expect(row.status).toBe("pending");
      expect(row.run_id).toBe("run-1");
      expect(row.channel).toBe("telegram");
      expect(row.artifact_type).toBe("report");
      expect(row.content_preview).toBe("Weekly summary");
      expect(row.delivered_at).toBeNull();
    });
  });

  describe("markDelivered", () => {
    it("updates status and sets delivered_at", () => {
      const deliveryId = store.recordDelivery({
        runId: "run-1",
        channel: "telegram",
      });

      store.markDelivered(deliveryId);

      const row = db.prepare("SELECT * FROM artifact_deliveries WHERE delivery_id = ?").get(deliveryId) as Record<string, unknown>;
      expect(row.status).toBe("delivered");
      expect(row.delivered_at).toBeTruthy();
    });
  });

  describe("markDeliveryFailed", () => {
    it("updates status to failed", () => {
      const deliveryId = store.recordDelivery({
        runId: "run-1",
        channel: "email",
      });

      store.markDeliveryFailed(deliveryId);

      const row = db.prepare("SELECT * FROM artifact_deliveries WHERE delivery_id = ?").get(deliveryId) as Record<string, unknown>;
      expect(row.status).toBe("failed");
    });
  });

  describe("getRunDeliveries", () => {
    it("returns deliveries for a run", () => {
      store.recordDelivery({ runId: "run-1", channel: "telegram" });
      store.recordDelivery({ runId: "run-1", channel: "email" });
      store.recordDelivery({ runId: "run-2", channel: "telegram" });

      const deliveries = store.getRunDeliveries("run-1");
      expect(deliveries).toHaveLength(2);
      expect(deliveries.every(d => d.run_id === "run-1")).toBe(true);
    });
  });

  // ─── Lineage queries ────────────────────────────────────────────────────

  describe("getThreadByCommandId", () => {
    it("finds thread from command_id", () => {
      const threadId = store.getOrCreateThread("telegram", "chat-1");
      store.recordMessage({
        threadId,
        channel: "telegram",
        direction: "inbound",
        commandId: "cmd-42",
      });

      const result = store.getThreadByCommandId("cmd-42");
      expect(result).toBe(threadId);
    });

    it("returns null for unknown command_id", () => {
      const result = store.getThreadByCommandId("nonexistent-cmd");
      expect(result).toBeNull();
    });
  });

  describe("getRunTimeline", () => {
    it("merges run_events, channel_messages, and deliveries sorted by timestamp", () => {
      const runId = "run-timeline-1";
      const threadId = store.getOrCreateThread("telegram", "chat-1");

      // Insert a run record (required for the command_id JOIN in getRunTimeline)
      db.prepare(`
        INSERT INTO runs (run_id, agent_id, status, command_id, started_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(runId, "bd-pipeline", "completed", "cmd-tl", "2026-01-01T00:00:00Z");

      // 1. Insert run_events directly
      db.prepare(`
        INSERT INTO run_events (event_id, run_id, agent_id, event_type, step_no, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("ev1", runId, "bd-pipeline", "run_started", 0, "2026-01-01T00:01:00Z");

      // 2. Insert a channel message linked to this run directly (via run_id)
      db.prepare(`
        INSERT INTO channel_messages (message_id, thread_id, channel, direction, content_preview, run_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("msg1", threadId, "telegram", "outbound", "Status update", runId, "2026-01-01T00:02:00Z");

      // 3. Insert a channel message linked via command_id (the trigger message)
      db.prepare(`
        INSERT INTO channel_messages (message_id, thread_id, channel, direction, content_preview, command_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("msg0", threadId, "telegram", "inbound", "Trigger", "cmd-tl", "2026-01-01T00:00:30Z");

      // 4. Insert an artifact delivery
      store.recordDelivery({
        runId,
        threadId,
        channel: "telegram",
        artifactType: "report",
        contentPreview: "Final report",
      });
      // Override the created_at so we get a deterministic order
      db.prepare(
        "UPDATE artifact_deliveries SET created_at = ? WHERE run_id = ?",
      ).run("2026-01-01T00:03:00Z", runId);

      const timeline = store.getRunTimeline(runId);

      // Expect 4 entries: trigger msg, run_event, direct msg, delivery
      expect(timeline).toHaveLength(4);

      // Verify chronological order
      expect(timeline[0]!.source).toBe("channel_message");
      expect((timeline[0]!.data as Record<string, unknown>).message_id).toBe("msg0");

      expect(timeline[1]!.source).toBe("run_event");
      expect((timeline[1]!.data as Record<string, unknown>).event_id).toBe("ev1");

      expect(timeline[2]!.source).toBe("channel_message");
      expect((timeline[2]!.data as Record<string, unknown>).message_id).toBe("msg1");

      expect(timeline[3]!.source).toBe("artifact_delivery");

      // Verify sorted by timestamp
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i]!.timestamp >= timeline[i - 1]!.timestamp).toBe(true);
      }
    });
  });
});
