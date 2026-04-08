/**
 * Transport-agnostic webhook normalization layer.
 *
 * This module owns the domain logic for interpreting incoming webhooks:
 *   - Signature verification (HMAC-SHA256)
 *   - GitHub event-to-agent mapping
 *   - Payload normalization into a canonical shape
 *   - Conversion to the parameters createCommand() expects
 *
 * It does NOT own WHERE webhooks arrive (Express, OpenClaw TaskFlow, etc.).
 * That belongs to the ingress layer that calls these functions.
 */

import crypto from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type WebhookSource = "github" | "generic" | "custom";

export type NormalizedWebhookEvent = {
  /** Origin system: 'github' | 'generic' | 'custom' */
  source: WebhookSource;
  /** GitHub event name or custom type identifier */
  event_type: string;
  /** Resolved target agent */
  agent_id: string;
  /** Normalized payload forwarded to the agent */
  context: Record<string, unknown>;
  /** Deduplication key (agent + trigger + time-bucket) */
  idempotency_key: string;
  /** ISO-8601 timestamp of ingestion */
  received_at: string;
  /** Whether the HMAC signature was verified */
  signature_verified: boolean;
};

/**
 * Shape returned by webhookEventToCommand() — matches the fields
 * that createCommand() in @jarvis/runtime expects.
 */
export type WebhookCommandParams = {
  agentId: string;
  source: "webhook";
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maps GitHub event names to the Jarvis agent that handles them.
 * Exported so both the normalizer and tests can reference the canonical mapping.
 */
export const GITHUB_EVENT_TO_AGENT: Readonly<Record<string, string>> = {
  push: "evidence-auditor",
  pull_request: "contract-reviewer",
  issues: "orchestrator",
} as const;

// ─── Signature Verification ─────────────────────────────────────────────────

/**
 * Verify an HMAC-SHA256 signature against a raw body.
 *
 * @param rawBody   - The exact bytes the sender signed (string or Buffer).
 * @param signature - The signature header value, e.g. "sha256=<hex>".
 * @param secret    - The shared secret used to compute the HMAC.
 * @returns `true` when the signature is valid, `false` otherwise.
 *
 * Uses constant-time comparison (crypto.timingSafeEqual) and pads
 * both buffers to equal length to avoid leaking length information.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = "sha256=" + hmac.digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  // Pad both to the same length to prevent leaking length via timingSafeEqual
  const maxLen = Math.max(sigBuf.length, expBuf.length);
  const paddedSig = Buffer.alloc(maxLen);
  const paddedExp = Buffer.alloc(maxLen);
  sigBuf.copy(paddedSig);
  expBuf.copy(paddedExp);

  // Evaluate both conditions without short-circuiting to avoid leaking
  // length information via timing. timingSafeEqual runs on padded buffers
  // regardless; the length check is combined afterward.
  const lengthsMatch = sigBuf.length === expBuf.length;
  const signaturesMatch = crypto.timingSafeEqual(paddedSig, paddedExp);

  return lengthsMatch && signaturesMatch;
}

// ─── GitHub Normalizer ──────────────────────────────────────────────────────

export type NormalizeGithubOpts = {
  /** The X-GitHub-Event header value. */
  event: string;
  /** Parsed JSON body from the webhook. */
  payload: Record<string, unknown>;
  /** Whether the caller already verified the signature. */
  signatureVerified: boolean;
};

/**
 * Normalize a GitHub webhook into a NormalizedWebhookEvent.
 *
 * Returns `null` when the event type has no mapped agent (the caller
 * should respond with a 200 "ignored" status rather than an error).
 */
export function normalizeGithubWebhook(
  opts: NormalizeGithubOpts,
): NormalizedWebhookEvent | null {
  const agentId = GITHUB_EVENT_TO_AGENT[opts.event];
  if (!agentId) return null;

  const now = new Date().toISOString();

  return {
    source: "github",
    event_type: opts.event,
    agent_id: agentId,
    context: {
      github_event: opts.event,
      action: opts.payload.action,
      repository: (opts.payload.repository as Record<string, unknown>)
        ?.full_name,
      sender: (opts.payload.sender as Record<string, unknown>)?.login,
      payload: opts.payload,
    },
    idempotency_key: `${agentId}:webhook:github:${opts.event}:${Math.floor(Date.now() / 10_000)}`,
    received_at: now,
    signature_verified: opts.signatureVerified,
  };
}

// ─── Generic Normalizer ─────────────────────────────────────────────────────

export type NormalizeGenericOpts = {
  /** Parsed JSON body — must contain `agent_id` at the top level. */
  payload: Record<string, unknown>;
  /** Whether the caller already verified the signature. */
  signatureVerified: boolean;
};

export type NormalizeGenericResult =
  | { ok: true; event: NormalizedWebhookEvent }
  | { ok: false; error: string };

/**
 * Normalize a generic webhook payload into a NormalizedWebhookEvent.
 *
 * Returns an error result when `agent_id` is missing or not a string.
 */
export function normalizeGenericWebhook(
  opts: NormalizeGenericOpts,
): NormalizeGenericResult {
  const agentId = opts.payload.agent_id;
  if (!agentId || typeof agentId !== "string") {
    return { ok: false, error: "Missing or invalid agent_id field" };
  }

  const context = (opts.payload.context as Record<string, unknown>) ?? {};
  const now = new Date().toISOString();

  return {
    ok: true,
    event: {
      source: "generic",
      event_type: "generic",
      agent_id: agentId,
      context,
      idempotency_key: `${agentId}:webhook:generic:${Math.floor(Date.now() / 10_000)}`,
      received_at: now,
      signature_verified: opts.signatureVerified,
    },
  };
}

// ─── Custom (per-agent) Normalizer ──────────────────────────────────────────

export type NormalizeCustomOpts = {
  /** Agent ID from the URL path parameter. */
  agentId: string;
  /** Parsed JSON body — forwarded as-is. */
  payload: Record<string, unknown>;
  /** Whether the caller already verified the signature. */
  signatureVerified: boolean;
};

/**
 * Normalize a custom per-agent webhook (POST /webhooks/:agentId).
 */
export function normalizeCustomWebhook(
  opts: NormalizeCustomOpts,
): NormalizedWebhookEvent {
  const now = new Date().toISOString();

  return {
    source: "custom",
    event_type: "custom",
    agent_id: opts.agentId,
    context: opts.payload,
    idempotency_key: `${opts.agentId}:webhook:custom:${Math.floor(Date.now() / 10_000)}`,
    received_at: now,
    signature_verified: opts.signatureVerified,
  };
}

// ─── Event -> Command Conversion ────────────────────────────────────────────

/**
 * Convert a NormalizedWebhookEvent to the parameters expected by
 * createCommand() from @jarvis/runtime.
 *
 * The caller is responsible for obtaining a DatabaseSync handle and
 * invoking createCommand(db, params).
 */
export function webhookEventToCommand(
  event: NormalizedWebhookEvent,
): WebhookCommandParams {
  return {
    agentId: event.agent_id,
    source: "webhook",
    payload: {
      ...event.context,
      _webhook: {
        source: event.source,
        event_type: event.event_type,
        received_at: event.received_at,
        signature_verified: event.signature_verified,
      },
    },
    idempotencyKey: event.idempotency_key,
  };
}
