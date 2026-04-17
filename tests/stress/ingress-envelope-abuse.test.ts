/**
 * Stress: Ingress Envelope Abuse
 *
 * Invariant: every ingress rejects malformed/oversized/version-skewed
 * envelopes uniformly, never crashes, never leaks internal state.
 *
 * Targets `validateJobInput` directly plus a minimal envelope-shape
 * validator that mirrors the rules the full JSON-Schema suite applies
 * at build time. This is faster and more deterministic than HTTP and
 * lets us assert "no exception escapes" without framing noise.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  validateJobInput,
  CONTRACT_VERSION,
  JOB_APPROVAL_REQUIREMENT,
  JOB_TIMEOUT_SECONDS,
  type JarvisJobType,
} from "@jarvis/shared";
import { RunStore } from "@jarvis/runtime";
import { createStressDb, cleanupDb, createMetrics, reportMetrics, range } from "./helpers.js";

// ─── Envelope shape validator (mirrors job-envelope.schema.json) ─────────────

type ValidationOutcome = { valid: boolean; errors: string[] };

const REQUIRED_ENVELOPE_KEYS = [
  "contract_version", "job_id", "type", "session_key", "requested_by",
  "priority", "approval_state", "timeout_seconds", "attempt", "input",
  "artifacts_in", "metadata",
] as const;

const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const VALID_APPROVAL_STATES = new Set([
  "pending", "approved", "rejected", "expired", "cancelled", "not_required",
]);

/**
 * Mirror of the structural rules the JSON-Schema suite enforces.
 * Used so tests can assert uniform rejection without running AJV.
 */
const ALLOWED_ENVELOPE_KEYS = new Set<string>([
  ...REQUIRED_ENVELOPE_KEYS,
  "retry_policy",
]);

function validateEnvelopeShape(raw: unknown): ValidationOutcome {
  const errs: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["envelope must be a non-null object"] };
  }
  const env = raw as Record<string, unknown>;

  // Required keys
  for (const k of REQUIRED_ENVELOPE_KEYS) {
    if (!(k in env) || env[k] === undefined) errs.push(`missing "${k}"`);
  }

  // additionalProperties: false — mirrors job-envelope.schema.json
  for (const k of Object.keys(env)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(k)) errs.push(`unknown key "${k}"`);
  }

  // contract_version must be the exact literal
  if ("contract_version" in env && env.contract_version !== CONTRACT_VERSION) {
    errs.push("contract_version mismatch");
  }

  // type must be a string (further checked via JOB_APPROVAL_REQUIREMENT)
  if ("type" in env) {
    if (typeof env.type !== "string" || env.type.length === 0) {
      errs.push("type must be non-empty string");
    } else if (!(env.type in JOB_APPROVAL_REQUIREMENT)) {
      errs.push(`unknown type "${String(env.type).slice(0, 64)}"`);
    }
  }

  if ("priority" in env && !VALID_PRIORITIES.has(String(env.priority))) {
    errs.push("invalid priority");
  }
  if ("approval_state" in env && !VALID_APPROVAL_STATES.has(String(env.approval_state))) {
    errs.push("invalid approval_state");
  }

  // numeric fields must be finite positive integers; cap at 24h like prod.
  const MAX_TIMEOUT_SECONDS = 86_400;
  if ("timeout_seconds" in env) {
    const v = env.timeout_seconds;
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 1 || v > MAX_TIMEOUT_SECONDS) {
      errs.push("timeout_seconds must be integer in [1, 86400]");
    }
  }
  if ("attempt" in env) {
    const v = env.attempt;
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
      errs.push("attempt must be positive integer");
    }
  }

  if ("input" in env && (typeof env.input !== "object" || env.input === null || Array.isArray(env.input))) {
    errs.push("input must be object");
  }
  if ("artifacts_in" in env && !Array.isArray(env.artifacts_in)) {
    errs.push("artifacts_in must be array");
  }
  if ("metadata" in env) {
    const md = env.metadata;
    if (typeof md !== "object" || md === null || Array.isArray(md)) {
      errs.push("metadata must be object");
    } else if (typeof (md as Record<string, unknown>).agent_id !== "string") {
      errs.push("metadata.agent_id must be string");
    }
  }

  return { valid: errs.length === 0, errors: errs };
}

/**
 * Validator the tests treat as the ingress entry point. Catches every
 * throwable (including JSON parse errors when we feed raw strings) and
 * returns a uniform `{ valid, errors }` shape so the invariant assertions
 * are simple to write.
 *
 * Also enforces a size cap — mirrors the Express body-parser default
 * (100KB) that guards production ingress. This lets the test reject
 * oversized bodies uniformly without spinning up HTTP.
 */
const INGRESS_BODY_MAX_BYTES = 100 * 1024; // 100 KB

function ingressValidate(raw: unknown): ValidationOutcome {
  try {
    // Size gate — measure the serialized JSON size for non-strings.
    const serialized = typeof raw === "string" ? raw : safeStringify(raw);
    if (serialized !== null && serialized.length > INGRESS_BODY_MAX_BYTES) {
      return { valid: false, errors: ["payload exceeds size limit"] };
    }

    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); }
      catch { return { valid: false, errors: ["not valid JSON"] }; }
    }
    const shape = validateEnvelopeShape(parsed);
    if (!shape.valid) return shape;
    // If envelope shape passes, also run the input validator the real code runs.
    const env = parsed as { type: JarvisJobType; input: Record<string, unknown> };
    return validateJobInput(env.type, env.input);
  } catch (e) {
    // Must never escape — this is the crux of the invariant.
    return { valid: false, errors: [`ingress threw: ${(e as Error).message}`] };
  }
}

function safeStringify(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  try { return JSON.stringify(raw); } catch { return null; }
}

// ─── Adversarial payload library (~30 patterns) ──────────────────────────────

function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: "11111111-2222-3333-4444-555555555555",
    type: "inference.chat",
    session_key: "agent:main:api:local:adhoc",
    requested_by: { channel: "api", user_id: "system" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 120,
    attempt: 1,
    input: { messages: [{ role: "user", content: "hi" }] },
    artifacts_in: [],
    metadata: { agent_id: "main", thread_key: null },
    ...overrides,
  };
}

const BIDI_OVERRIDE = "\u202E";           // right-to-left override
const HOMOGLYPH_E = "\u0435";             // Cyrillic 'e' — looks like ASCII 'e'
const NULL_BYTE = "\u0000";

function withoutKey(key: string): Record<string, unknown> {
  const e = validEnvelope();
  delete (e as Record<string, unknown>)[key];
  return e;
}

function withPrototypeKey(): Record<string, unknown> {
  // defineProperty installs __proto__ as an own data property — mimics
  // what `JSON.parse('{"__proto__":{...}}')` produces. Plain assignment
  // would only re-set the prototype, not add an enumerable key.
  const e = validEnvelope();
  Object.defineProperty(e, "__proto__", { value: { polluted: true }, enumerable: true, writable: true, configurable: true });
  return e;
}

const adversarialEnvelopes: Array<{ label: string; payload: unknown }> = [
  // Structural corruption
  { label: "null body", payload: null },
  { label: "undefined body", payload: undefined },
  { label: "top-level array", payload: [validEnvelope()] },
  { label: "empty object", payload: {} },
  { label: "primitive string", payload: "not an envelope" },
  { label: "primitive number", payload: 42 },
  // Truncated / malformed JSON (fed as raw strings)
  { label: "truncated JSON", payload: '{"contract_version":"jarvis.v1","type":"inference.chat"' },
  { label: "JSON trailing garbage", payload: JSON.stringify(validEnvelope()) + "}}}}" },
  { label: "JSON NaN literal", payload: '{"attempt": NaN, "timeout_seconds": 120}' },
  // Version skew
  { label: "contract_version v0", payload: validEnvelope({ contract_version: "jarvis.v0" }) },
  { label: "contract_version v2", payload: validEnvelope({ contract_version: "jarvis.v2" }) },
  { label: "contract_version beta", payload: validEnvelope({ contract_version: "v1.0.1-beta" }) },
  { label: "contract_version null", payload: validEnvelope({ contract_version: null }) },
  { label: "contract_version empty", payload: validEnvelope({ contract_version: "" }) },
  // Required-field absences
  { label: "missing job_id", payload: withoutKey("job_id") },
  { label: "missing metadata", payload: withoutKey("metadata") },
  { label: "missing input", payload: withoutKey("input") },
  { label: "missing type", payload: withoutKey("type") },
  // Type-field adversarial
  { label: "type bidi override", payload: validEnvelope({ type: `email.send${BIDI_OVERRIDE}.noop` }) },
  { label: "type Cyrillic homoglyph", payload: validEnvelope({ type: `${HOMOGLYPH_E}mail.send` }) },
  { label: "type null byte", payload: validEnvelope({ type: `email.send${NULL_BYTE}.noop` }) },
  { label: "type uppercase variant", payload: validEnvelope({ type: "Email.Send" }) },
  { label: "type unknown", payload: validEnvelope({ type: "email.exfiltrate" }) },
  { label: "type empty", payload: validEnvelope({ type: "" }) },
  { label: "type numeric", payload: validEnvelope({ type: 42 }) },
  // Numeric pathologies
  { label: "timeout negative", payload: validEnvelope({ timeout_seconds: -1 }) },
  { label: "timeout NaN", payload: validEnvelope({ timeout_seconds: Number.NaN }) },
  { label: "timeout Infinity", payload: validEnvelope({ timeout_seconds: Number.POSITIVE_INFINITY }) },
  { label: "timeout huge", payload: validEnvelope({ timeout_seconds: Number.MAX_SAFE_INTEGER }) },
  { label: "timeout fractional", payload: validEnvelope({ timeout_seconds: 12.5 }) },
  { label: "attempt zero", payload: validEnvelope({ attempt: 0 }) },
  { label: "attempt negative", payload: validEnvelope({ attempt: -5 }) },
  // Enum abuse
  { label: "priority invalid", payload: validEnvelope({ priority: "ULTRA" }) },
  { label: "approval_state invalid", payload: validEnvelope({ approval_state: "auto-approved" }) },
  // Prototype-pollution vectors
  { label: "__proto__ key", payload: withPrototypeKey() },
  { label: "constructor.prototype key", payload: validEnvelope({ constructor: { prototype: { polluted: true } } }) },
  // input-level __proto__ via JSON string — JSON.parse installs it as an
  // own property, but the shape validator's additionalProperties check is
  // only at top level. This vector is expected to slip past structural
  // validation; we assert no crash separately below.
  // Extra/shape abuse
  { label: "extra unknown key", payload: validEnvelope({ shadow_field: "surprise" }) },
  { label: "input as array", payload: validEnvelope({ input: [1, 2, 3] }) },
  { label: "input as string", payload: validEnvelope({ input: "not-an-object" }) },
  { label: "metadata.agent_id missing", payload: validEnvelope({ metadata: { thread_key: null } }) },
  // Oversized body
  {
    label: "1MB message blob",
    payload: validEnvelope({ input: { messages: [{ role: "user", content: "A".repeat(1_048_576) }] } }),
  },
];

// ─── Leak checks ────────────────────────────────────────────────────────────

const LEAK_PATTERNS = [
  /[A-Za-z]:\\/,         // Windows absolute path
  /\/home\//,            // POSIX home
  /\/Users\//,           // macOS home
  /node_modules/,        // dependency paths
  /at\s+\w+\s*\(/,       // stack frames
  /\bError:\s+[A-Z]/,    // raw Error objects
  /\sline\s+\d+/,        // line numbers
];

function containsLeak(errors: string[]): string | null {
  for (const msg of errors) {
    for (const rx of LEAK_PATTERNS) {
      if (rx.test(msg)) return `leak in "${msg}" via ${rx}`;
    }
  }
  return null;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Ingress Envelope Abuse Stress", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;
  let initialRss: number;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("ingress"));
    store = new RunStore(db);
    // Seed one run so we can check the runs table is untouched afterwards.
    store.startRun("seed-agent", "test", undefined, "baseline");
    initialRss = process.memoryUsage().rss;
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("(a) 500 malformed envelopes in sequence are all rejected uniformly", () => {
    const metrics = createMetrics("500-sequential");
    metrics.startTime = performance.now();

    const bodyCountBefore = (db.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number }).c;

    for (let i = 0; i < 500; i++) {
      const pick = adversarialEnvelopes[i % adversarialEnvelopes.length]!;
      const t0 = performance.now();
      const result = ingressValidate(pick.payload);
      metrics.durations.push(performance.now() - t0);
      metrics.totalOps++;

      // Every pattern must be rejected — no adversarial envelope is a valid job.
      expect(result.valid, `"${pick.label}" must be rejected`).toBe(false);

      const leak = containsLeak(result.errors);
      expect(leak, `leak from "${pick.label}": ${leak}`).toBeNull();
    }

    metrics.endTime = performance.now();
    const report = reportMetrics(metrics);
    expect(report.errors).toBe(0);   // no thrown exceptions

    // Side-effect check: RunStore row count unchanged.
    const bodyCountAfter = (db.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number }).c;
    expect(bodyCountAfter).toBe(bodyCountBefore);

    // Memory growth check (informational, generous bound: 50 MB).
    const rssGrowth = process.memoryUsage().rss - initialRss;
    expect(rssGrowth).toBeLessThan(50 * 1024 * 1024);
  });

  it("(b) 200 mixed valid/invalid pairs: valid accepted, invalid rejected", () => {
    let acceptedCount = 0;
    let rejectedCount = 0;

    for (let i = 0; i < 200; i++) {
      // Valid envelope pair-member
      const good = ingressValidate(validEnvelope({
        job_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      }));
      if (good.valid) acceptedCount++;
      else throw new Error(`valid envelope was rejected: ${good.errors.join("; ")}`);

      // Adversarial pair-member
      const bad = adversarialEnvelopes[i % adversarialEnvelopes.length]!;
      const outcome = ingressValidate(bad.payload);
      expect(outcome.valid, `"${bad.label}" must be rejected`).toBe(false);
      expect(containsLeak(outcome.errors)).toBeNull();
      rejectedCount++;
    }

    expect(acceptedCount).toBe(200);
    expect(rejectedCount).toBe(200);
  });

  it("(c) concurrent flood: 500 parallel requests, no exceptions escape", async () => {
    const metrics = createMetrics("500-concurrent");
    metrics.startTime = performance.now();
    const thrown: unknown[] = [];

    const results = await Promise.all(
      range(500).map(async (i) => {
        const pick = adversarialEnvelopes[i % adversarialEnvelopes.length]!;
        const t0 = performance.now();
        try {
          const r = ingressValidate(pick.payload);
          metrics.durations.push(performance.now() - t0);
          metrics.totalOps++;
          return { label: pick.label, valid: r.valid, errors: r.errors };
        } catch (e) {
          // Must never happen — the validator is required to catch every throw.
          metrics.errors++;
          thrown.push(e);
          metrics.durations.push(performance.now() - t0);
          return { label: pick.label, valid: false, errors: [`THROWN: ${String(e)}`] };
        }
      }),
    );

    metrics.endTime = performance.now();

    expect(thrown, "ingress must never throw").toHaveLength(0);
    for (const r of results) {
      expect(r.valid, `"${r.label}" must be rejected`).toBe(false);
      expect(containsLeak(r.errors), `leak from "${r.label}"`).toBeNull();
    }

    // Throughput sanity: even in this simulated flood p99 should stay small.
    const report = reportMetrics(metrics);
    expect(report.p99).toBeLessThan(500);
  });

  it("prototype-pollution payloads do not mutate Object.prototype", () => {
    const beforeTag = (Object.prototype as Record<string, unknown>).polluted;

    // Vector 1: JSON string with __proto__ key at top level
    const jsonVector = '{"contract_version":"jarvis.v1","__proto__":{"polluted":1}}';
    ingressValidate(jsonVector);

    // Vector 2: input-level __proto__ via JSON
    const inputVector = JSON.stringify(validEnvelope()).replace(
      '"input":{"messages":[{"role":"user","content":"hi"}]}',
      '"input":{"messages":[],"__proto__":{"polluted":2}}',
    );
    ingressValidate(inputVector);

    // The validator must not propagate pollution to Object.prototype.
    const afterTag = (Object.prototype as Record<string, unknown>).polluted;
    expect(afterTag).toBe(beforeTag);
    // Explicit: no "polluted" key ever appeared.
    expect("polluted" in Object.prototype).toBe(false);
  });

  it("double-check: JOB_TIMEOUT_SECONDS lookup survives adversarial type strings", () => {
    // Any code that does `JOB_TIMEOUT_SECONDS[envelope.type]` must not crash
    // for adversarial type values. This is a sanity guard because ingress
    // relies on that lookup to build envelopes downstream.
    for (const adv of adversarialEnvelopes) {
      const payload = typeof adv.payload === "object" && adv.payload !== null
        ? (adv.payload as Record<string, unknown>)
        : {};
      const type = payload.type;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lookup = (JOB_TIMEOUT_SECONDS as any)[type as string];
      // Undefined is fine; a thrown exception is not.
      expect(lookup === undefined || typeof lookup === "number").toBe(true);
    }
  });
});
