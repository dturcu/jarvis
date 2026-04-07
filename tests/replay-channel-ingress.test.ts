import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ChannelStore } from "../packages/jarvis-runtime/src/channel-store.js";
import { createCommand } from "../packages/jarvis-runtime/src/command-factory.js";
import { RunStore } from "../packages/jarvis-runtime/src/run-store.js";
import { runMigrations, RUNTIME_MIGRATIONS } from "../packages/jarvis-runtime/src/migrations/runner.js";

/**
 * Replay test: channel ingress unification.
 *
 * Verifies that the same agent trigger arriving through different channels
 * (dashboard, telegram, etc.) produces traceable, equivalent command rows
 * and that the full lifecycle — thread, message, run, delivery — stitches
 * together into a unified timeline.
 */

describe("Q1 channel ingress unification", () => {
  let db: DatabaseSync;
  let channelStore: ChannelStore;
  let runStore: RunStore;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db, RUNTIME_MIGRATIONS);
    channelStore = new ChannelStore(db);
    runStore = new RunStore(db);
  });

  // ─── Cross-channel command creation ───────────────────────────────────────

  describe("cross-channel command creation", () => {
    it("dashboard and telegram triggers produce identical agent_commands rows (different created_by)", () => {
      const dashResult = createCommand(db, {
        agentId: "bd-pipeline",
        source: "dashboard",
        payload: { query: "scan leads" },
        idempotencyKey: "dash-bd-1",
      });

      const telegramResult = createCommand(db, {
        agentId: "bd-pipeline",
        source: "telegram",
        payload: { query: "scan leads" },
        idempotencyKey: "tg-bd-1",
      });

      // Both commands should exist
      const dashRow = db.prepare(
        "SELECT * FROM agent_commands WHERE command_id = ?",
      ).get(dashResult.commandId) as Record<string, unknown>;
      const tgRow = db.prepare(
        "SELECT * FROM agent_commands WHERE command_id = ?",
      ).get(telegramResult.commandId) as Record<string, unknown>;

      // Same structural columns
      expect(dashRow.command_type).toBe("run_agent");
      expect(tgRow.command_type).toBe("run_agent");
      expect(dashRow.target_agent_id).toBe("bd-pipeline");
      expect(tgRow.target_agent_id).toBe("bd-pipeline");
      expect(dashRow.status).toBe("queued");
      expect(tgRow.status).toBe("queued");
      expect(dashRow.priority).toBe(0);
      expect(tgRow.priority).toBe(0);

      // Payload is identical
      expect(dashRow.payload_json).toBe(JSON.stringify({ query: "scan leads" }));
      expect(tgRow.payload_json).toBe(JSON.stringify({ query: "scan leads" }));

      // created_by differs per channel
      expect(dashRow.created_by).toBe("dashboard");
      expect(tgRow.created_by).toBe("telegram");

      // Command IDs are unique
      expect(dashResult.commandId).not.toBe(telegramResult.commandId);
    });

    it("both commands link to their respective channel threads/messages when channelStore is provided", () => {
      const tgThreadId = channelStore.getOrCreateThread("telegram", "tg-chat-42", "BD pipeline trigger");
      const dashThreadId = channelStore.getOrCreateThread("dashboard", "godmode-session-1", "Dashboard trigger");

      const tgResult = createCommand(db, {
        agentId: "bd-pipeline",
        source: "telegram",
        payload: { query: "scan leads" },
        channelStore,
        threadId: tgThreadId,
        messagePreview: "/bd-pipeline scan leads",
        sender: "daniel",
      });

      const dashResult = createCommand(db, {
        agentId: "bd-pipeline",
        source: "dashboard",
        payload: { query: "scan leads" },
        channelStore,
        threadId: dashThreadId,
        messagePreview: "Triggered bd-pipeline from dashboard",
        sender: "admin",
      });

      // Both should produce message IDs
      expect(tgResult.messageId).toBeDefined();
      expect(dashResult.messageId).toBeDefined();

      // Telegram message is linked to the telegram thread
      const tgMessages = channelStore.getThreadMessages(tgThreadId);
      expect(tgMessages).toHaveLength(1);
      expect(tgMessages[0]!.channel).toBe("telegram");
      expect(tgMessages[0]!.direction).toBe("inbound");
      expect(tgMessages[0]!.command_id).toBe(tgResult.commandId);
      expect(tgMessages[0]!.sender).toBe("daniel");

      // Dashboard message is linked to the dashboard thread
      const dashMessages = channelStore.getThreadMessages(dashThreadId);
      expect(dashMessages).toHaveLength(1);
      expect(dashMessages[0]!.channel).toBe("dashboard");
      expect(dashMessages[0]!.direction).toBe("inbound");
      expect(dashMessages[0]!.command_id).toBe(dashResult.commandId);
      expect(dashMessages[0]!.sender).toBe("admin");
    });
  });

  // ─── Channel thread lineage ───────────────────────────────────────────────

  describe("channel thread lineage", () => {
    it("a telegram thread tracks all messages in chronological order", () => {
      const threadId = channelStore.getOrCreateThread("telegram", "tg-chat-99", "Agent triggers");

      channelStore.recordMessage({
        threadId,
        channel: "telegram",
        externalId: "msg-1",
        direction: "inbound",
        contentPreview: "/bd-pipeline scan",
        sender: "daniel",
      });

      channelStore.recordMessage({
        threadId,
        channel: "telegram",
        externalId: "msg-2",
        direction: "outbound",
        contentPreview: "Running bd-pipeline...",
        sender: "jarvis",
      });

      channelStore.recordMessage({
        threadId,
        channel: "telegram",
        externalId: "msg-3",
        direction: "outbound",
        contentPreview: "bd-pipeline completed: 3 leads found",
        sender: "jarvis",
      });

      const messages = channelStore.getThreadMessages(threadId);
      expect(messages).toHaveLength(3);

      // Verify chronological order (created_at ASC)
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i]!.created_at >= messages[i - 1]!.created_at).toBe(true);
      }

      // Verify directions
      expect(messages[0]!.direction).toBe("inbound");
      expect(messages[1]!.direction).toBe("outbound");
      expect(messages[2]!.direction).toBe("outbound");
    });

    it("a dashboard thread tracks godmode interactions", () => {
      const threadId = channelStore.getOrCreateThread("dashboard", "godmode-session-7", "Godmode session");

      channelStore.recordMessage({
        threadId,
        channel: "dashboard",
        direction: "inbound",
        contentPreview: "Run evidence-auditor for project X",
        sender: "admin",
      });

      channelStore.recordMessage({
        threadId,
        channel: "dashboard",
        direction: "outbound",
        contentPreview: "Evidence audit complete: 4 gaps found",
        sender: "jarvis",
      });

      const messages = channelStore.getThreadMessages(threadId);
      expect(messages).toHaveLength(2);
      expect(messages[0]!.channel).toBe("dashboard");
      expect(messages[1]!.channel).toBe("dashboard");

      // Thread metadata is correct
      const thread = channelStore.getThread(threadId);
      expect(thread).not.toBeNull();
      expect(thread!.channel).toBe("dashboard");
      expect(thread!.external_id).toBe("godmode-session-7");
      expect(thread!.subject).toBe("Godmode session");
    });

    it("getOrCreateThread is idempotent for same channel+external_id", () => {
      const first = channelStore.getOrCreateThread("telegram", "tg-chat-42", "First subject");
      const second = channelStore.getOrCreateThread("telegram", "tg-chat-42", "Different subject");
      const third = channelStore.getOrCreateThread("telegram", "tg-chat-42");

      // All return the same thread_id
      expect(second).toBe(first);
      expect(third).toBe(first);

      // Only one thread row exists
      const rows = db.prepare(
        "SELECT * FROM channel_threads WHERE channel = 'telegram' AND external_id = 'tg-chat-42'",
      ).all();
      expect(rows).toHaveLength(1);

      // Different channel + same external_id creates a separate thread
      const dashThread = channelStore.getOrCreateThread("dashboard", "tg-chat-42");
      expect(dashThread).not.toBe(first);
    });
  });

  // ─── Run timeline integration ─────────────────────────────────────────────

  describe("run timeline integration", () => {
    it("getRunTimeline returns a unified timeline merging run_events, channel_messages, and artifact_deliveries", () => {
      // 1. Create thread and an inbound message with a command
      const threadId = channelStore.getOrCreateThread("telegram", "tg-chat-100", "Pipeline run");

      const { commandId } = createCommand(db, {
        agentId: "bd-pipeline",
        source: "telegram",
        channelStore,
        threadId,
        messagePreview: "/bd-pipeline run",
        sender: "daniel",
      });

      // 2. Start a run linked to that command
      const runId = runStore.startRun("bd-pipeline", "telegram", commandId, "Scan for BD leads");

      // 3. Emit some run events (step progression)
      runStore.emitEvent(runId, "bd-pipeline", "step_started", {
        step_no: 1,
        action: "scan_leads",
      });

      runStore.emitEvent(runId, "bd-pipeline", "step_completed", {
        step_no: 1,
        action: "scan_leads",
        details: { leads_found: 3 },
      });

      // 4. Record a delivery back through the channel
      const deliveryId = channelStore.recordDelivery({
        runId,
        threadId,
        channel: "telegram",
        artifactType: "lead_report",
        contentPreview: "3 leads identified",
      });

      // 5. Record an outbound message for the delivery
      channelStore.recordMessage({
        threadId,
        channel: "telegram",
        direction: "outbound",
        contentPreview: "BD pipeline complete: 3 leads found",
        sender: "jarvis",
        runId,
      });

      // 6. Get the unified timeline
      const timeline = channelStore.getRunTimeline(runId);

      // Should have entries from all three sources
      const sources = new Set(timeline.map(e => e.source));
      expect(sources.has("run_event")).toBe(true);
      expect(sources.has("channel_message")).toBe(true);
      expect(sources.has("artifact_delivery")).toBe(true);

      // Count per source type
      const runEvents = timeline.filter(e => e.source === "run_event");
      const channelMessages = timeline.filter(e => e.source === "channel_message");
      const deliveries = timeline.filter(e => e.source === "artifact_delivery");

      // run_started + step_started + step_completed = 3 run events
      expect(runEvents.length).toBeGreaterThanOrEqual(3);
      // inbound trigger message + outbound result message = 2 channel messages
      expect(channelMessages.length).toBeGreaterThanOrEqual(2);
      // 1 delivery
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.data.delivery_id).toBe(deliveryId);
    });

    it("timeline is sorted chronologically", () => {
      const threadId = channelStore.getOrCreateThread("telegram", "tg-chrono", "Chrono test");

      const { commandId } = createCommand(db, {
        agentId: "evidence-auditor",
        source: "telegram",
        channelStore,
        threadId,
        messagePreview: "/evidence-auditor run",
        sender: "daniel",
      });

      const runId = runStore.startRun("evidence-auditor", "telegram", commandId);

      runStore.emitEvent(runId, "evidence-auditor", "step_started", { step_no: 1, action: "scan" });
      runStore.emitEvent(runId, "evidence-auditor", "step_completed", { step_no: 1, action: "scan" });

      channelStore.recordDelivery({
        runId,
        threadId,
        channel: "telegram",
        artifactType: "gap_matrix",
        contentPreview: "Gap matrix PDF",
      });

      const timeline = channelStore.getRunTimeline(runId);
      expect(timeline.length).toBeGreaterThan(0);

      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i]!.timestamp >= timeline[i - 1]!.timestamp).toBe(true);
      }
    });

    it("all timeline entries have the correct source field", () => {
      const threadId = channelStore.getOrCreateThread("dashboard", "dash-src", "Source test");

      const { commandId } = createCommand(db, {
        agentId: "content-engine",
        source: "dashboard",
        channelStore,
        threadId,
        messagePreview: "Generate LinkedIn post",
        sender: "admin",
      });

      const runId = runStore.startRun("content-engine", "dashboard", commandId);

      channelStore.recordMessage({
        threadId,
        channel: "dashboard",
        direction: "outbound",
        contentPreview: "Post draft ready",
        sender: "jarvis",
        runId,
      });

      channelStore.recordDelivery({
        runId,
        threadId,
        channel: "dashboard",
        artifactType: "linkedin_post",
        contentPreview: "Draft: ISO 26262 insights...",
      });

      const timeline = channelStore.getRunTimeline(runId);

      const validSources = new Set(["run_event", "channel_message", "artifact_delivery"]);
      for (const entry of timeline) {
        expect(validSources.has(entry.source)).toBe(true);
        expect(entry.timestamp).toBeDefined();
        expect(typeof entry.timestamp).toBe("string");
        expect(entry.data).toBeDefined();
      }
    });
  });

  // ─── Artifact delivery tracking ───────────────────────────────────────────

  describe("artifact delivery tracking", () => {
    let runId: string;
    let threadId: string;

    beforeEach(() => {
      threadId = channelStore.getOrCreateThread("telegram", "tg-delivery", "Delivery tests");

      const { commandId } = createCommand(db, {
        agentId: "proposal-engine",
        source: "telegram",
      });

      runId = runStore.startRun("proposal-engine", "telegram", commandId);
    });

    it("delivery starts as pending", () => {
      const deliveryId = channelStore.recordDelivery({
        runId,
        threadId,
        channel: "telegram",
        artifactType: "proposal_pdf",
        contentPreview: "Proposal for Project Alpha",
      });

      const deliveries = channelStore.getRunDeliveries(runId);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.delivery_id).toBe(deliveryId);
      expect(deliveries[0]!.status).toBe("pending");
      expect(deliveries[0]!.delivered_at).toBeNull();
    });

    it("can be marked as delivered", () => {
      const deliveryId = channelStore.recordDelivery({
        runId,
        threadId,
        channel: "telegram",
        artifactType: "proposal_pdf",
        contentPreview: "Proposal for Project Alpha",
      });

      channelStore.markDelivered(deliveryId);

      const deliveries = channelStore.getRunDeliveries(runId);
      expect(deliveries[0]!.status).toBe("delivered");
      expect(deliveries[0]!.delivered_at).not.toBeNull();
    });

    it("can be marked as failed", () => {
      const deliveryId = channelStore.recordDelivery({
        runId,
        threadId,
        channel: "telegram",
        artifactType: "proposal_pdf",
        contentPreview: "Proposal for Project Alpha",
      });

      channelStore.markDeliveryFailed(deliveryId);

      const deliveries = channelStore.getRunDeliveries(runId);
      expect(deliveries[0]!.status).toBe("failed");
      expect(deliveries[0]!.delivered_at).toBeNull();
    });

    it("deliveries link to runs and threads", () => {
      const messageId = channelStore.recordMessage({
        threadId,
        channel: "telegram",
        direction: "outbound",
        contentPreview: "Sending proposal...",
        sender: "jarvis",
        runId,
      });

      const deliveryId = channelStore.recordDelivery({
        runId,
        threadId,
        messageId,
        channel: "telegram",
        artifactType: "proposal_pdf",
        contentPreview: "Proposal for Project Alpha",
      });

      const deliveries = channelStore.getRunDeliveries(runId);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.run_id).toBe(runId);
      expect(deliveries[0]!.thread_id).toBe(threadId);
      expect(deliveries[0]!.message_id).toBe(messageId);
      expect(deliveries[0]!.channel).toBe("telegram");
      expect(deliveries[0]!.artifact_type).toBe("proposal_pdf");

      // Verify the thread is navigable from the delivery
      const thread = channelStore.getThread(deliveries[0]!.thread_id!);
      expect(thread).not.toBeNull();
      expect(thread!.channel).toBe("telegram");

      // Verify the run is navigable
      const run = runStore.getRun(runId);
      expect(run).not.toBeNull();
      expect(run!.agent_id).toBe("proposal-engine");
    });
  });
});
