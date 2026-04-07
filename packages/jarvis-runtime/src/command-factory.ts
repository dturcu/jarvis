import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChannelStore } from "./channel-store.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CommandSource = "dashboard" | "telegram" | "workflow" | "webhook" | "email" | "schedule";

export type CreateCommandOpts = {
  agentId: string;
  source: CommandSource;
  payload?: Record<string, unknown>;
  priority?: number;
  idempotencyKey?: string;
  // Channel tracking (optional)
  channelStore?: ChannelStore;
  threadId?: string;
  messagePreview?: string;
  sender?: string;
};

export type CreateCommandResult = {
  commandId: string;
  messageId?: string;
};

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Centralized command creation. Replaces the duplicated INSERT blocks
 * in agents.ts, workflows.ts, runs.ts, and telegram commands.ts.
 *
 * If channelStore + threadId are provided, also records an inbound
 * channel message linked to the command.
 *
 * Does NOT wrap in a transaction — the caller controls transaction
 * boundaries (needed for workflows.ts which batches multiple commands).
 */
export function createCommand(db: DatabaseSync, opts: CreateCommandOpts): CreateCommandResult {
  const commandId = randomUUID();
  const idempotencyKey = opts.idempotencyKey ?? `${opts.source}-${opts.agentId}-${Date.now()}`;
  const payloadJson = opts.payload ? JSON.stringify(opts.payload) : JSON.stringify({ triggered_by: opts.source });

  db.prepare(`
    INSERT INTO agent_commands
      (command_id, command_type, target_agent_id, payload_json, status, priority, created_at, created_by, idempotency_key)
    VALUES (?, 'run_agent', ?, ?, 'queued', ?, ?, ?, ?)
  `).run(
    commandId,
    opts.agentId,
    payloadJson,
    opts.priority ?? 0,
    new Date().toISOString(),
    opts.source,
    idempotencyKey,
  );

  let messageId: string | undefined;

  // Record channel message if tracking is available
  if (opts.channelStore && opts.threadId) {
    try {
      messageId = opts.channelStore.recordMessage({
        threadId: opts.threadId,
        channel: sourceToChannel(opts.source),
        direction: "inbound",
        contentPreview: opts.messagePreview ?? `Triggered ${opts.agentId}`,
        sender: opts.sender,
        commandId,
      });
    } catch {
      // Best-effort: don't fail command creation if channel tracking fails
    }
  }

  return { commandId, messageId };
}

/** Map command sources to channel names. */
function sourceToChannel(source: CommandSource): string {
  switch (source) {
    case "telegram": return "telegram";
    case "email": return "email";
    case "webhook": return "webhook";
    default: return "dashboard";
  }
}
