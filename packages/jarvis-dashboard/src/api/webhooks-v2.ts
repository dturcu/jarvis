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
import { webhookIngressTotal, legacyPathTraffic } from "@jarvis/observability";

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
 * Callback signature for webhook event persistence.
 * The runtime (or tests) can inject its own persistence strategy.
 */
export type WebhookEventHandler = (
  event: NormalizedWebhookEvent,
  triggeredBy: string,
) => string | void;

/**
 * Default onEvent handler: opens runtime.db, persists the command, writes an
 * audit entry. Used when the caller does not supply a custom handler.
 */
function defaultOnEvent(
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

/** Options for createWebhookRouter. */
export interface WebhookRouterOptions {
  /**
   * Custom event handler. When provided, the router will NOT open the DB
   * or call createCommand directly — it delegates entirely to this callback.
   * Defaults to the built-in DB persistence handler for backward compat.
   */
  onEvent?: WebhookEventHandler;
}

/**
 * Extract the raw body string for HMAC verification.
 * Providers sign the exact bytes — re-serializing JSON can alter whitespace.
 */
function getRawBody(req: import("express").Request): string {
  const raw = (req as any).rawBody;
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return JSON.stringify(req.body);
}

// ─── Router Factory ─────────────────────────────────────────────────────────

/**
 * Create the webhook v2 router.
 *
 * When `opts.onEvent` is supplied, the router delegates all persistence to
 * that callback instead of opening runtime.db directly. This makes the
 * router a thin forwarding layer that the runtime can wire up as needed.
 *
 * For backward compatibility, calling `createWebhookRouter()` with no args
 * uses the built-in default handler that writes to runtime.db.
 */
export function createWebhookRouter(opts?: WebhookRouterOptions): Router {
  const onEvent: WebhookEventHandler = opts?.onEvent ?? defaultOnEvent;
  const router = Router();

  // Attach deprecation header and emit metrics for every request.
  router.use((_req, res, next) => {
    res.setHeader(DEPRECATION_HEADER, DEPRECATION_VALUE);
    webhookIngressTotal.labels("dashboard").inc();
    legacyPathTraffic.labels("/api/webhooks").inc();
    next();
  });

  // POST /api/webhooks-v2/github — GitHub webhook handler
  router.post("/github", (req, res) => {
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

    // --- Emit event ---
    console.info(
      `[webhooks-v2] DEPRECATED direct GitHub webhook -> ${normalized.agent_id}. Migrate to OpenClaw webhook surface.`,
    );
    onEvent(normalized, `webhook:github:${event}`);

    res.json({
      status: "triggered",
      agentId: normalized.agent_id,
      event,
      triggeredAt: normalized.received_at,
    });
  });

  // POST /api/webhooks-v2/generic — generic JSON webhook
  router.post("/generic", (req, res) => {
    const secret = loadWebhookSecret();

    // --- Signature verification ---
    let signatureVerified = false;

    if (secret) {
      const signature = req.headers["x-jarvis-signature"] as string | undefined;
      if (!signature) {
        res.status(401).json({ error: "Invalid or missing X-Jarvis-Signature" });
        return;
      }
      const rawBody = getRawBody(req);
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

    // --- Emit event ---
    console.info(
      `[webhooks-v2] DEPRECATED direct generic webhook -> ${result.event.agent_id}. Migrate to OpenClaw webhook surface.`,
    );
    onEvent(result.event, "webhook:generic");

    res.json({
      status: "triggered",
      agentId: result.event.agent_id,
      triggeredAt: result.event.received_at,
    });
  });

  // POST /api/webhooks-v2/:agentId — trigger any agent with optional payload
  router.post("/:agentId", (req, res) => {
    const secret = loadWebhookSecret();

    // --- Signature verification ---
    let signatureVerified = false;

    if (secret) {
      const signature = req.headers["x-jarvis-signature"] as string | undefined;
      if (!signature) {
        res.status(401).json({ error: "Invalid or missing X-Jarvis-Signature" });
        return;
      }
      const rawBody = getRawBody(req);
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

    // --- Emit event ---
    console.info(
      `[webhooks-v2] DEPRECATED direct custom webhook -> ${normalized.agent_id}. Migrate to OpenClaw webhook surface.`,
    );
    onEvent(normalized, "webhook");

    res.json({
      status: "triggered",
      agentId: normalized.agent_id,
      triggeredAt: normalized.received_at,
    });
  });

  return router;
}

/**
 * Backward-compatible bare router instance using the default DB persistence.
 * Existing imports of `webhookV2Router` continue to work unchanged.
 */
export const webhookV2Router = createWebhookRouter();
