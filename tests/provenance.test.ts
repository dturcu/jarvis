import { describe, expect, it } from "vitest";
import { ProvenanceSigner, hashContent, type ProvenanceRecord } from "../packages/jarvis-observability/src/provenance.js";

const TEST_KEY = "test-key-for-provenance-signing-at-least-32-chars";

describe("ProvenanceSigner", () => {
  it("signs a provenance record with HMAC-SHA256", () => {
    const signer = new ProvenanceSigner(TEST_KEY);
    const record = signer.sign({
      job_id: "job-001",
      job_type: "document.analyze_compliance",
      agent_id: "evidence-auditor",
      run_id: "run-abc",
      input_hash: hashContent('{"path":"/docs/safety.pdf"}'),
      output_hash: hashContent('{"status":"PRESENT","gaps":0}'),
      trace_id: "trace-xyz",
      sequence: 0,
    });

    expect(record.record_id).toBeTruthy();
    expect(record.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(record.signed_at).toBeTruthy();
    expect(record.sequence).toBe(0);
  });

  it("verifies a valid record", () => {
    const signer = new ProvenanceSigner(TEST_KEY);
    const record = signer.sign({
      job_id: "job-002",
      job_type: "inference.chat",
      input_hash: hashContent("test input"),
      output_hash: hashContent("test output"),
      sequence: 0,
    });

    expect(signer.verify(record)).toBe(true);
  });

  it("detects tampered records", () => {
    const signer = new ProvenanceSigner(TEST_KEY);
    const record = signer.sign({
      job_id: "job-003",
      job_type: "email.send",
      input_hash: hashContent("original"),
      output_hash: hashContent("result"),
      sequence: 0,
    });

    // Tamper with the output hash
    const tampered: ProvenanceRecord = {
      ...record,
      output_hash: hashContent("modified result"),
    };

    expect(signer.verify(tampered)).toBe(false);
  });

  it("detects records signed with a different key", () => {
    const signer1 = new ProvenanceSigner(TEST_KEY);
    const signer2 = new ProvenanceSigner("different-key-for-verification-test");

    const record = signer1.sign({
      job_id: "job-004",
      job_type: "crm.move_stage",
      input_hash: hashContent("input"),
      output_hash: hashContent("output"),
      sequence: 0,
    });

    expect(signer2.verify(record)).toBe(false);
  });

  it("rejects short signing keys", () => {
    expect(() => new ProvenanceSigner("too-short")).toThrow("at least 32 characters");
  });
});

describe("ProvenanceSigner chain verification", () => {
  it("verifies a valid chain of records", () => {
    const signer = new ProvenanceSigner(TEST_KEY);

    const r0 = signer.sign({
      job_id: "job-chain",
      job_type: "document.ingest",
      run_id: "run-1",
      input_hash: hashContent("step0-in"),
      output_hash: hashContent("step0-out"),
      sequence: 0,
    });

    const r1 = signer.sign({
      job_id: "job-chain",
      job_type: "inference.chat",
      run_id: "run-1",
      input_hash: hashContent("step1-in"),
      output_hash: hashContent("step1-out"),
      sequence: 1,
      prev_signature: r0.signature,
    });

    const r2 = signer.sign({
      job_id: "job-chain",
      job_type: "document.generate_report",
      run_id: "run-1",
      input_hash: hashContent("step2-in"),
      output_hash: hashContent("step2-out"),
      sequence: 2,
      prev_signature: r1.signature,
    });

    const result = signer.verifyChain([r0, r1, r2]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects gap in sequence numbers", () => {
    const signer = new ProvenanceSigner(TEST_KEY);

    const r0 = signer.sign({
      job_id: "job-gap",
      job_type: "inference.chat",
      run_id: "run-2",
      input_hash: hashContent("s0"),
      output_hash: hashContent("o0"),
      sequence: 0,
    });

    const r2 = signer.sign({
      job_id: "job-gap",
      job_type: "inference.chat",
      run_id: "run-2",
      input_hash: hashContent("s2"),
      output_hash: hashContent("o2"),
      sequence: 2,
      prev_signature: r0.signature,
    });

    const result = signer.verifyChain([r0, r2]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Gap detected"))).toBe(true);
  });

  it("detects broken chain linkage", () => {
    const signer = new ProvenanceSigner(TEST_KEY);

    const r0 = signer.sign({
      job_id: "job-broken",
      job_type: "email.send",
      run_id: "run-3",
      input_hash: hashContent("s0"),
      output_hash: hashContent("o0"),
      sequence: 0,
    });

    const r1 = signer.sign({
      job_id: "job-broken",
      job_type: "email.send",
      run_id: "run-3",
      input_hash: hashContent("s1"),
      output_hash: hashContent("o1"),
      sequence: 1,
      prev_signature: "wrong-signature-not-matching-r0",
    });

    const result = signer.verifyChain([r0, r1]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Chain break"))).toBe(true);
  });

  it("accepts an empty chain", () => {
    const signer = new ProvenanceSigner(TEST_KEY);
    const result = signer.verifyChain([]);
    expect(result.valid).toBe(true);
  });

  it("verifies chain regardless of input order", () => {
    const signer = new ProvenanceSigner(TEST_KEY);

    const r0 = signer.sign({
      job_id: "j",
      job_type: "t",
      input_hash: "ih0",
      output_hash: "oh0",
      sequence: 0,
    });
    const r1 = signer.sign({
      job_id: "j",
      job_type: "t",
      input_hash: "ih1",
      output_hash: "oh1",
      sequence: 1,
      prev_signature: r0.signature,
    });

    // Pass in reverse order — should still work
    const result = signer.verifyChain([r1, r0]);
    expect(result.valid).toBe(true);
  });
});

describe("hashContent", () => {
  it("produces consistent SHA-256 hashes", () => {
    const hash1 = hashContent("test data");
    const hash2 = hashContent("test data");
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different inputs", () => {
    expect(hashContent("input A")).not.toBe(hashContent("input B"));
  });
});
