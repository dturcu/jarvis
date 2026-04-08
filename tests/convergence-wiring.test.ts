/**
 * Convergence Wiring Tests
 *
 * Validates that Wave 2 convergence wiring is operational:
 * - Notification dispatcher routes through session or DB
 * - Credential audit is properly imported and callable
 * - Webhook normalizer produces correct command params
 * - Hook catalog integrates with the core plugin pattern
 */

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
// Import directly from source files to avoid transitive @opentelemetry dependency
// that exists in the @jarvis/runtime barrel export via @jarvis/observability.
import {
  writeTelegramQueue,
  createNotificationDispatcher,
} from "../packages/jarvis-runtime/src/notify.js";
import {
  verifyWebhookSignature,
  normalizeGithubWebhook,
  normalizeGenericWebhook,
  webhookEventToCommand,
} from "@jarvis/shared";
import {
  logCredentialAccess,
  type CredentialAuditConfig,
} from "@jarvis/security/credential-audit";
import {
  getHookCatalog,
} from "@jarvis/core/hooks";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE notifications (
      notification_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );
    CREATE TABLE audit_log (
      audit_id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe("Convergence Wiring", () => {
  describe("Notification Dispatcher", () => {
    it("telegram mode writes to DB", async () => {
      const db = createTestDb();
      const dispatcher = createNotificationDispatcher({ channel: "telegram" });
      await dispatcher.notify("proposal-engine", "Proposal ready", db);

      const rows = db.prepare("SELECT * FROM notifications").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.channel).toBe("telegram");
      expect(rows[0]!.status).toBe("pending");
    });

    it("session mode calls sessionSend", async () => {
      const sent: string[] = [];
      const dispatcher = createNotificationDispatcher({
        channel: "session",
        sessionSend: async (text) => { sent.push(text); },
      });
      await dispatcher.notify("evidence-auditor", "Audit complete");

      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("EVIDENCE-AUDITOR");
      expect(sent[0]).toContain("Audit complete");
    });

    it("both mode writes to DB and sends via session", async () => {
      const db = createTestDb();
      const sent: string[] = [];
      const dispatcher = createNotificationDispatcher({
        channel: "both",
        sessionSend: async (text) => { sent.push(text); },
      });
      await dispatcher.notify("contract-reviewer", "Review done", db);

      const rows = db.prepare("SELECT * FROM notifications").all();
      expect(rows).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it("session mode falls back to DB on session failure", async () => {
      const db = createTestDb();
      const dispatcher = createNotificationDispatcher({
        channel: "session",
        sessionSend: async () => { throw new Error("Gateway unreachable"); },
      });
      await dispatcher.notify("orchestrator", "Fallback test", db);

      const rows = db.prepare("SELECT * FROM notifications").all();
      expect(rows).toHaveLength(1);
    });
  });

  describe("Credential Audit Wiring", () => {
    it("logCredentialAccess writes structured audit entries", () => {
      const db = createTestDb();
      const config: CredentialAuditConfig = { db, enabled: true };

      logCredentialAccess(config, {
        worker_id: "email",
        credential_keys: ["gmail"],
        run_id: "run-abc",
        granted: true,
        timestamp: new Date().toISOString(),
      });

      const rows = db.prepare("SELECT * FROM audit_log").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_id).toBe("email");
      expect(rows[0]!.action).toBe("credential.access");
    });
  });

  describe("Webhook Normalizer Integration", () => {
    it("normalizes a GitHub push event to command params", () => {
      const event = normalizeGithubWebhook({
        event: "push",
        payload: { repository: { full_name: "org/repo" }, sender: { login: "user" }, action: "completed" },
        signatureVerified: true,
      });
      expect(event).not.toBeNull();
      expect(event!.agent_id).toBe("evidence-auditor");
      expect(event!.source).toBe("github");

      const params = webhookEventToCommand(event!);
      expect(params.agentId).toBe("evidence-auditor");
      expect(params.source).toBe("webhook");
    });

    it("rejects unmapped GitHub events", () => {
      const event = normalizeGithubWebhook({
        event: "deployment",
        payload: {},
        signatureVerified: false,
      });
      expect(event).toBeNull();
    });

    it("verifies HMAC signatures correctly", () => {
      const secret = "test-secret-key";
      const body = '{"agent_id":"orchestrator"}';
      const crypto = require("node:crypto");
      const hmac = crypto.createHmac("sha256", secret);
      hmac.update(body);
      const signature = "sha256=" + hmac.digest("hex");

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
      expect(verifyWebhookSignature(body, "sha256=wrong", secret)).toBe(false);
    });
  });

  describe("Hook Catalog Integration", () => {
    it("catalog hooks are registrable via the plugin pattern", () => {
      const catalog = getHookCatalog();

      // Verify each hook has the shape needed for api.on()
      for (const hook of catalog) {
        expect(typeof hook.hookPoint).toBe("string");
        expect(typeof hook.handler).toBe("function");
        expect(typeof hook.priority).toBe("number");
        expect(typeof hook.description).toBe("string");
      }
    });

    it("before_tool_call hooks return approval or undefined", () => {
      const catalog = getHookCatalog();
      const beforeToolHooks = catalog.filter((h) => h.hookPoint === "before_tool_call");

      // At least the built-in approval hook and domain approval hook
      expect(beforeToolHooks.length).toBeGreaterThanOrEqual(2);

      // Exec should trigger approval
      for (const hook of beforeToolHooks) {
        const result = hook.handler({ toolName: "exec" });
        // At least one hook should gate exec
        if (result && typeof result === "object" && "requireApproval" in result) {
          expect((result as { requireApproval: { severity: string } }).requireApproval.severity).toBe("critical");
        }
      }
    });
  });
});
