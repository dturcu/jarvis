/**
 * E3: Webhook HMAC signature validation tests.
 *
 * Tests the crypto logic used by the webhook endpoint to verify HMAC-SHA256
 * signatures. Tests the computation and comparison directly without HTTP.
 *
 * Based on the validation logic in packages/jarvis-dashboard/src/api/webhooks.ts
 * which uses crypto.createHmac('sha256', secret) and timingSafeEqual.
 */

import { describe, it, expect } from "vitest";
import {
  computeWebhookSignature,
  signaturesMatch,
} from "../../packages/jarvis-dashboard/src/api/webhooks.ts";

describe("Webhook: HMAC signature validation", () => {
  const secret = "test-webhook-secret";

  it("valid signature passes verification", () => {
    const payload = JSON.stringify({ event: "push", ref: "refs/heads/main" });
    const sig = computeWebhookSignature(secret, payload);

    expect(signaturesMatch(sig, computeWebhookSignature(secret, payload))).toBe(true);
  });

  it("invalid signature fails verification (wrong secret)", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig = computeWebhookSignature("wrong-secret", payload);

    expect(signaturesMatch(sig, computeWebhookSignature(secret, payload))).toBe(false);
  });

  it("tampered payload fails verification", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig = computeWebhookSignature(secret, payload);

    const tampered = JSON.stringify({ event: "delete" });
    expect(signaturesMatch(sig, computeWebhookSignature(secret, tampered))).toBe(false);
  });

  it("signature format is sha256=<hex>", () => {
    const payload = JSON.stringify({ test: true });
    const sig = computeWebhookSignature(secret, payload);

    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("empty payload produces valid HMAC", () => {
    const payload = "";
    const sig = computeWebhookSignature(secret, payload);

    expect(signaturesMatch(sig, computeWebhookSignature(secret, payload))).toBe(true);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("different payloads produce different signatures", () => {
    const sig1 = computeWebhookSignature(secret, JSON.stringify({ a: 1 }));
    const sig2 = computeWebhookSignature(secret, JSON.stringify({ a: 2 }));

    expect(sig1).not.toBe(sig2);
  });

  it("different secrets produce different signatures for same payload", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig1 = computeWebhookSignature("secret-one", payload);
    const sig2 = computeWebhookSignature("secret-two", payload);

    expect(sig1).not.toBe(sig2);
  });

  it("malformed signature (wrong prefix) fails verification", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig = computeWebhookSignature(secret, payload);
    // Strip the sha256= prefix
    const malformed = sig.replace("sha256=", "md5=");

    expect(signaturesMatch(malformed, computeWebhookSignature(secret, payload))).toBe(false);
  });

  it("truncated signature fails verification", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig = computeWebhookSignature(secret, payload);
    const truncated = sig.slice(0, 20);

    // Length mismatch should cause failure
    expect(signaturesMatch(truncated, computeWebhookSignature(secret, payload))).toBe(false);
  });

  it("signature is deterministic for same input", () => {
    const payload = JSON.stringify({ event: "push", repo: "jarvis" });

    const sig1 = computeWebhookSignature(secret, payload);
    const sig2 = computeWebhookSignature(secret, payload);

    expect(sig1).toBe(sig2);
  });

  it("different raw encodings of the same JSON object do not share a signature", () => {
    const minified = '{"event":"push","ref":"refs/heads/main"}';
    const pretty = '{\n  "event": "push",\n  "ref": "refs/heads/main"\n}';

    const sig = computeWebhookSignature(secret, pretty);
    expect(signaturesMatch(sig, computeWebhookSignature(secret, minified))).toBe(false);
  });
});
