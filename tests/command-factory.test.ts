import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, ChannelStore, createCommand } from "@jarvis/runtime";

describe("createCommand", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
  });

  it("inserts a row into agent_commands with correct columns", () => {
    const result = createCommand(db, {
      agentId: "bd-pipeline",
      source: "dashboard",
      payload: { triggered_by: "user", extra: "data" },
      priority: 5,
    });

    expect(result.commandId).toBeTruthy();

    const row = db.prepare("SELECT * FROM agent_commands WHERE command_id = ?").get(result.commandId) as Record<string, unknown>;
    expect(row.command_type).toBe("run_agent");
    expect(row.target_agent_id).toBe("bd-pipeline");
    expect(row.status).toBe("queued");
    expect(row.priority).toBe(5);
    expect(row.created_by).toBe("dashboard");
    expect(JSON.parse(row.payload_json as string)).toEqual({ triggered_by: "user", extra: "data" });
  });

  it("uses default idempotency key format when not provided", () => {
    const result = createCommand(db, {
      agentId: "garden-calendar",
      source: "schedule",
    });

    const row = db.prepare("SELECT idempotency_key FROM agent_commands WHERE command_id = ?").get(result.commandId) as { idempotency_key: string };
    // Default format: `${source}-${agentId}-${Date.now()}`
    expect(row.idempotency_key).toMatch(/^schedule-garden-calendar-\d+$/);
  });

  it("uses custom idempotency key when provided", () => {
    const result = createCommand(db, {
      agentId: "bd-pipeline",
      source: "webhook",
      idempotencyKey: "custom-key-123",
    });

    const row = db.prepare("SELECT idempotency_key FROM agent_commands WHERE command_id = ?").get(result.commandId) as { idempotency_key: string };
    expect(row.idempotency_key).toBe("custom-key-123");
  });

  it("records channel message when channelStore and threadId provided", () => {
    const channelStore = new ChannelStore(db);
    const threadId = channelStore.getOrCreateThread("telegram", "chat-99");

    const result = createCommand(db, {
      agentId: "content-engine",
      source: "telegram",
      channelStore,
      threadId,
      messagePreview: "Run content engine",
      sender: "daniel",
    });

    expect(result.messageId).toBeTruthy();

    // Verify channel message was recorded
    const msg = db.prepare("SELECT * FROM channel_messages WHERE message_id = ?").get(result.messageId!) as Record<string, unknown>;
    expect(msg.thread_id).toBe(threadId);
    expect(msg.channel).toBe("telegram");
    expect(msg.direction).toBe("inbound");
    expect(msg.content_preview).toBe("Run content engine");
    expect(msg.sender).toBe("daniel");
    expect(msg.command_id).toBe(result.commandId);
  });

  it("works without channelStore (no channel tracking)", () => {
    const result = createCommand(db, {
      agentId: "evidence-auditor",
      source: "dashboard",
    });

    expect(result.commandId).toBeTruthy();
    expect(result.messageId).toBeUndefined();

    // Command row still exists
    const row = db.prepare("SELECT * FROM agent_commands WHERE command_id = ?").get(result.commandId) as Record<string, unknown>;
    expect(row.target_agent_id).toBe("evidence-auditor");
  });

  it("with duplicate idempotency key throws (UNIQUE constraint)", () => {
    createCommand(db, {
      agentId: "bd-pipeline",
      source: "webhook",
      idempotencyKey: "unique-key-1",
    });

    expect(() => {
      createCommand(db, {
        agentId: "bd-pipeline",
        source: "webhook",
        idempotencyKey: "unique-key-1",
      });
    }).toThrow();
  });

  it("returns both commandId and messageId when channel tracking is active", () => {
    const channelStore = new ChannelStore(db);
    const threadId = channelStore.getOrCreateThread("email", "thread-55");

    const result = createCommand(db, {
      agentId: "email-campaign",
      source: "email",
      channelStore,
      threadId,
    });

    expect(result.commandId).toBeTruthy();
    expect(result.messageId).toBeTruthy();
    expect(typeof result.commandId).toBe("string");
    expect(typeof result.messageId).toBe("string");

    // Verify both IDs reference actual rows
    const cmdRow = db.prepare("SELECT command_id FROM agent_commands WHERE command_id = ?").get(result.commandId);
    expect(cmdRow).toBeDefined();

    const msgRow = db.prepare("SELECT message_id FROM channel_messages WHERE message_id = ?").get(result.messageId!);
    expect(msgRow).toBeDefined();
  });

  it("uses default payload when none provided", () => {
    const result = createCommand(db, {
      agentId: "garden-calendar",
      source: "schedule",
    });

    const row = db.prepare("SELECT payload_json FROM agent_commands WHERE command_id = ?").get(result.commandId) as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toEqual({ triggered_by: "schedule" });
  });
});
