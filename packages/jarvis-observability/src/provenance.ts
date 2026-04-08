import { createHash, createHmac, randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ProvenanceRecord = {
  record_id: string;
  job_id: string;
  job_type: string;
  agent_id?: string;
  run_id?: string;
  /** SHA-256 hash of the canonicalized job input */
  input_hash: string;
  /** SHA-256 hash of the canonicalized job output */
  output_hash: string;
  /** OpenTelemetry trace ID for correlation */
  trace_id?: string;
  /** Sequence number within this run (monotonically increasing, gap-free) */
  sequence: number;
  /** SHA-256 of the previous record's signature (chain model for gap detection) */
  prev_signature?: string;
  /** HMAC-SHA256 signature of the canonical record content */
  signature: string;
  signed_at: string;
};

// ─── Canonical Serialization ────────────────────────────────────────────────

/**
 * Canonical serialization for provenance records.
 *
 * Produces a deterministic string from a record's fields, ensuring:
 * - Keys are sorted alphabetically
 * - No whitespace variance
 * - Undefined values are excluded (not "null")
 *
 * This is the string that gets HMAC-signed.
 */
function canonicalize(
  record: Omit<ProvenanceRecord, "signature" | "record_id" | "signed_at">,
): string {
  const fields: Record<string, string | number> = {
    job_id: record.job_id,
    job_type: record.job_type,
    input_hash: record.input_hash,
    output_hash: record.output_hash,
    sequence: record.sequence,
  };
  if (record.agent_id) fields.agent_id = record.agent_id;
  if (record.run_id) fields.run_id = record.run_id;
  if (record.trace_id) fields.trace_id = record.trace_id;
  if (record.prev_signature) fields.prev_signature = record.prev_signature;

  // Sort keys for deterministic ordering
  const sorted = Object.keys(fields).sort();
  return sorted.map((k) => `${k}=${String(fields[k])}`).join("|");
}

/**
 * SHA-256 hash of arbitrary data (used for input/output content hashing).
 */
export function hashContent(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

// ─── ProvenanceSigner ───────────────────────────────────────────────────────

/**
 * Signs and verifies provenance records using HMAC-SHA256.
 *
 * Each record includes:
 * - Canonical serialization of job identity + input/output hashes
 * - Chained signatures (prev_signature) for gap detection
 * - Sequence numbers for ordering within a run
 *
 * This provides tamper evidence suitable for regulated audits.
 * For full ISO 26262 tool qualification, also ensure:
 * - Key rotation policy (rotate signing key periodically)
 * - Verification tooling (script to validate chain integrity)
 * - Linkage to run events and artifact lineage
 */
export class ProvenanceSigner {
  private secretKey: string;

  constructor(secretKey: string) {
    if (!secretKey || secretKey.length < 32) {
      throw new Error("Provenance signing key must be at least 32 characters.");
    }
    this.secretKey = secretKey;
  }

  /**
   * Sign a provenance record.
   *
   * @returns A complete ProvenanceRecord with record_id, signature, and signed_at.
   */
  sign(
    record: Omit<ProvenanceRecord, "signature" | "record_id" | "signed_at">,
  ): ProvenanceRecord {
    const canonical = canonicalize(record);
    const signature = createHmac("sha256", this.secretKey)
      .update(canonical, "utf-8")
      .digest("hex");

    return {
      ...record,
      record_id: randomUUID(),
      signature,
      signed_at: new Date().toISOString(),
    };
  }

  /**
   * Verify a provenance record's signature.
   *
   * Recomputes the HMAC from the record's fields and compares
   * against the stored signature using timing-safe comparison.
   */
  verify(record: ProvenanceRecord): boolean {
    const { signature: stored, record_id: _, signed_at: __, ...rest } = record;
    const canonical = canonicalize(rest);
    const expected = createHmac("sha256", this.secretKey)
      .update(canonical, "utf-8")
      .digest("hex");

    // Timing-safe comparison
    if (stored.length !== expected.length) return false;
    const storedBuf = Buffer.from(stored, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (storedBuf.length !== expectedBuf.length) return false;

    let diff = 0;
    for (let i = 0; i < storedBuf.length; i++) {
      diff |= storedBuf[i]! ^ expectedBuf[i]!;
    }
    return diff === 0;
  }

  /**
   * Verify chain integrity across a sequence of records.
   *
   * Checks:
   * 1. Each record's signature is valid
   * 2. Sequence numbers are monotonically increasing with no gaps
   * 3. Each record's prev_signature matches the previous record's signature
   *
   * @returns An object with `valid` flag and any `errors` found.
   */
  verifyChain(
    records: ProvenanceRecord[],
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (records.length === 0) return { valid: true, errors: [] };

    // Sort by sequence
    const sorted = [...records].sort((a, b) => a.sequence - b.sequence);

    for (let i = 0; i < sorted.length; i++) {
      const record = sorted[i]!;

      // Verify individual signature
      if (!this.verify(record)) {
        errors.push(`Record ${record.record_id} (seq ${record.sequence}): invalid signature`);
      }

      // Verify sequence continuity
      if (i > 0) {
        const prev = sorted[i - 1]!;
        if (record.sequence !== prev.sequence + 1) {
          errors.push(
            `Gap detected: seq ${prev.sequence} -> ${record.sequence} (expected ${prev.sequence + 1})`,
          );
        }
        // Verify chain linkage
        if (record.prev_signature !== prev.signature) {
          errors.push(
            `Chain break at seq ${record.sequence}: prev_signature doesn't match previous record's signature`,
          );
        }
      } else {
        // First record should have no prev_signature
        if (record.prev_signature) {
          errors.push(
            `First record (seq ${record.sequence}) has unexpected prev_signature`,
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
