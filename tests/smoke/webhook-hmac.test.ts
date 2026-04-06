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
import crypto from "node:crypto";

/**
 * Compute HMAC-SHA256 signature in the same format as the webhook endpoint.
 * Mirrors the logic in webhooks.ts for both GitHub (X-Hub-Signature-256)
 * and Jarvis generic webhooks (X-Jarvis-Signature).
 */
function computeSignature(payload: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Validate an HMAC signature using timing-safe comparison.
 * Mirrors the validateHmac logic from webhooks.ts, including the buffer
 * padding for length-safe timingSafeEqual.
 */
function validateSignature(payload: string, signature: string, secret: string): boolean {
  const expected = computeSignature(payload, secret);

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  // Pad both buffers to the same length (same as webhooks.ts)
  const maxLen = Math.max(sigBuf.length, expBuf.length);
  const paddedSig = Buffer.alloc(maxLen);
  const paddedExp = Buffer.alloc(maxLen);
  sigBuf.copy(paddedSig);
  expBuf.copy(paddedExp);

  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(paddedSig, paddedExp);
}

describe("Webhook: HMAC signature validation", () => {
  const secret = "test-webhook-secret";

  it("valid signature passes verification", () => {
    const payload = JSON.stringify({ event: "push", ref: "refs/heads/main" });
    const sig = computeSignature(payload, secret);

    expect(validateSignature(payload, sig, secret)).toBe(true);
  });

  it("invalid signature fails verification (wrong secret)", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig = computeSignature(payload, "wrong-secret");

    expect(validateSignature(payload, sig, secret)).toBe(false);
  });

  it("tampered payload fails verification", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig = computeSignature(payload, secret);

    const tampered = JSON.stringify({ event: "delete" });
    expect(validateSignature(tampered, sig, secret)).toBe(false);
  });

  it("signature format is sha256=<hex>", () => {
    const payload = JSON.stringify({ test: true });
    const sig = computeSignature(payload, secret);

    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("empty payload produces valid HMAC", () => {
    const payload = "";
    const sig = computeSignature(payload, secret);

    expect(validateSignature(payload, sig, secret)).toBe(true);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("different payloads produce different signatures", () => {
    const sig1 = computeSignature(JSON.stringify({ a: 1 }), secret);
    const sig2 = computeSignature(JSON.stringify({ a: 2 }), secret);

    expect(sig1).not.toBe(sig2);
  });

  it("different secrets produce different signatures for same payload", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig1 = computeSignature(payload, "secret-one");
    const sig2 = computeSignature(payload, "secret-two");

    expect(sig1).not.toBe(sig2);
  });

  it("malformed signature (wrong prefix) fails verification", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig = computeSignature(payload, secret);
    // Strip the sha256= prefix
    const malformed = sig.replace("sha256=", "md5=");

    expect(validateSignature(payload, malformed, secret)).toBe(false);
  });

  it("truncated signature fails verification", () => {
    const payload = JSON.stringify({ event: "push" });
    const sig = computeSignature(payload, secret);
    const truncated = sig.slice(0, 20);

    // Length mismatch should cause failure
    expect(validateSignature(payload, truncated, secret)).toBe(false);
  });

  it("signature is deterministic for same input", () => {
    const payload = JSON.stringify({ event: "push", repo: "jarvis" });

    const sig1 = computeSignature(payload, secret);
    const sig2 = computeSignature(payload, secret);

    expect(sig1).toBe(sig2);
  });
});
