/**
 * Webhook ingress v2 — uses the transport-agnostic normalizer from @jarvis/shared.
 *
 * This router is a backwards-compatible replacement for webhooks.ts (v1).
 * It produces identical HTTP responses but delegates all domain logic to
 * the pure functions in @jarvis/shared/webhook-normalizer so that the
 * same logic can be reused in an OpenClaw webhook/TaskFlow surface.
 *
 * Every response includes the deprecation header:
 *   X-Jarvis-Deprecation: webhook-v1
 *
 * Callers should migrate to the OpenClaw webhook ingress when available.
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import fs from "node:fs";
import { join } from "node:path";
import { createCommand } from "@jarvis/runtime";
import {
  verifyWebhookSignature,
  normalizeGithubWebhook,
  normalizeGenericWebhook,
  normalizeCustomWebhook,
  webhookEventToCommand,
  type NormalizedWebhookEvent,
  type WebhookCommandParams,
} from "@jarvis/shared";

// ─── Shared Helpers ─────────────────────────────────────────────────────────

const JARVIS_DIR = join(os.homedir(), ".jarvis");

const DEPRECATION_HEADER = "X-Jarvis-Deprecation";
const DEPRECATION_VALUE = "webhook-v1";

function loadWebhookSecret(): string | undefined {
  const configPath = join(JARVIS_DIR, "config.json");
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    return raw.webhook_secret as string | undefined;
  } catch {
    return undefined;
  }
}

function getDb(): DatabaseSync {
  const db = new DatabaseSync(join(JARVIS_DIR, "runtime.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

/**
 * Execute a NormalizedWebhookEvent: persist the command and write an audit entry.
 */
function executeWebhookEvent(
  event: NormalizedWebhookEvent,
  triggeredBy: string,
): string {
  const params: WebhookCommandParams = webhookEventToCommand(event);
  const db = getDb();

  try {
    const { commandId } = createCommand(db, {
      agentId: params.agentId,
      source: params.source,
      payload: params.payload,
      idempotencyKey: params.idempotencyKey,
    });

    // Write audit log entry
    db.prepare(
      `
      INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      randomUUID(),
      "webhook",
      triggeredBy,
      "trigger.created",
      "agent",
      event.agent_id,
      JSON.stringify(event.context),
      new Date().toISOString(),
    );

    return commandId;
  } finally {
    try {
      db.close();
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Extract the raw body string for HMAC verification.
 * Providers sign the exact bytes — re-serializing JSON can alter whitespace.
 */
function getRawBody(req: import("express").Request): string {
  return typeof (req as any).rawBody === "string"
    ? (req as any).rawBody
    : JSON.stringify(req.body);
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const webhookV2Router = Router();

// Attach deprecation header to every response from this router.
webhookV2Router.use((_req, res, next) => {
  res.setHeader(DEPRECATION_HEADER, DEPRECATION_VALUE);
  next();
});

// POST /api/webhooks-v2/github — GitHub webhook handler
webhookV2Router.post("/github", (req, res) => {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const secret = loadWebhookSecret();

  // --- Signature verification ---
  let signatureVerified = false;

  if (secret && signature) {
    const rawBody = getRawBody(req);
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      console.warn(
        "[webhooks-v2] GitHub signature verification failed (deprecated direct ingress)",
      );
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    signatureVerified = true;
  } else if (secret && !signature) {
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  // --- Normalize ---
  const event = req.headers["x-github-event"] as string | undefined;
  if (!event) {
    res.status(400).json({ error: "Missing X-GitHub-Event header" });
    return;
  }

  const payload = req.body as Record<string, unknown>;
  const normalized = normalizeGithubWebhook({
    event,
    payload,
    signatureVerified,
  });

  if (!normalized) {
    res.json({
      status: "ignored",
      event,
      message: `No agent mapped for event: ${event}`,
    });
    return;
  }

  // --- Execute ---
  console.info(
    `[webhooks-v2] DEPRECATED direct GitHub webhook -> ${normalized.agent_id}. Migrate to OpenClaw webhook surface.`,
  );
  executeWebhookEvent(normalized, `webhook:github:${event}`);

  res.json({
    status: "triggered",
    agentId: normalized.agent_id,
    event,
    triggeredAt: normalized.received_at,
  });
});

// POST /api/webhooks-v2/generic — generic JSON webhook
webhookV2Router.post("/generic", (req, res) => {
  const secret = loadWebhookSecret();

  // --- Signature verification ---
  let signatureVerified = false;

  if (secret) {
    const signature = req.headers["x-jarvis-signature"] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: "Invalid or missing X-Jarvis-Signature" });
      return;
    }
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      console.warn(
        "[webhooks-v2] Generic signature verification failed (deprecated direct ingress)",
      );
      res.status(401).json({ error: "Invalid or missing X-Jarvis-Signature" });
      return;
    }
    signatureVerified = true;
  }

  // --- Normalize ---
  const body = req.body as Record<string, unknown>;
  const result = normalizeGenericWebhook({
    payload: body,
    signatureVerified,
  });

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  // --- Execute ---
  console.info(
    `[webhooks-v2] DEPRECATED direct generic webhook -> ${result.event.agent_id}. Migrate to OpenClaw webhook surface.`,
  );
  executeWebhookEvent(result.event, "webhook:generic");

  res.json({
    status: "triggered",
    agentId: result.event.agent_id,
    triggeredAt: result.event.received_at,
  });
});

// POST /api/webhooks-v2/:agentId — trigger any agent with optional payload
webhookV2Router.post("/:agentId", (req, res) => {
  const secret = loadWebhookSecret();

  // --- Signature verification ---
  let signatureVerified = false;

  if (secret) {
    const signature = req.headers["x-jarvis-signature"] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: "Invalid or missing X-Jarvis-Signature" });
      return;
    }
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      console.warn(
        "[webhooks-v2] Custom signature verification failed (deprecated direct ingress)",
      );
      res.status(401).json({ error: "Invalid or missing X-Jarvis-Signature" });
      return;
    }
    signatureVerified = true;
  }

  // --- Normalize ---
  const { agentId } = req.params;
  const payload = req.body as Record<string, unknown>;
  const normalized = normalizeCustomWebhook({
    agentId: agentId!,
    payload,
    signatureVerified,
  });

  // --- Execute ---
  console.info(
    `[webhooks-v2] DEPRECATED direct custom webhook -> ${normalized.agent_id}. Migrate to OpenClaw webhook surface.`,
  );
  executeWebhookEvent(normalized, "webhook");

  res.json({
    status: "triggered",
    agentId: normalized.agent_id,
    triggeredAt: normalized.received_at,
  });
});
