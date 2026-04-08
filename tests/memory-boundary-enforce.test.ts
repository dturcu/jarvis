/**
 * Memory boundary enforcement regression tests (Epic 4 completion).
 *
 * Proves that enforce mode BLOCKS compliance-grade evidence from
 * leaking into wiki/session paths — not just warns.
 */

import { describe, it, expect } from "vitest";
import { MemoryBoundaryChecker, MemoryBoundaryError } from "@jarvis/agent-framework";

describe("MemoryBoundaryChecker: enforce mode", () => {
  it("throws MemoryBoundaryError on category violation", () => {
    const checker = new MemoryBoundaryChecker("enforce");
    expect(() => checker.validate("audit_trail", "memory_wiki")).toThrow(MemoryBoundaryError);
  });

  it("throws on compliance collection written to wiki", () => {
    const checker = new MemoryBoundaryChecker("enforce");
    expect(() => checker.validateComplianceBoundary("contracts", "memory_wiki")).toThrow(MemoryBoundaryError);
  });

  it("throws on compliance collection written to session", () => {
    const checker = new MemoryBoundaryChecker("enforce");
    expect(() => checker.validateComplianceBoundary("iso26262", "session_state")).toThrow(MemoryBoundaryError);
  });

  it("blocks all 7 compliance collections from wiki", () => {
    const checker = new MemoryBoundaryChecker("enforce");
    const compliance = ["contracts", "iso26262", "aspice", "cybersecurity", "signed_records", "safety_case", "audit_trail"];
    for (const collection of compliance) {
      expect(
        () => checker.validateComplianceBoundary(collection, "memory_wiki"),
        `Expected ${collection} to be blocked from wiki`,
      ).toThrow(MemoryBoundaryError);
    }
  });

  it("allows compliance collections to knowledge_db (correct store)", () => {
    const checker = new MemoryBoundaryChecker("enforce");
    const result = checker.validateComplianceBoundary("contracts", "knowledge_db");
    expect(result.valid).toBe(true);
  });

  it("allows non-compliance collections to wiki", () => {
    const checker = new MemoryBoundaryChecker("enforce");
    // lessons, playbooks — these are synthesized knowledge, wiki is fine
    expect(checker.validateComplianceBoundary("lessons", "memory_wiki").valid).toBe(true);
    expect(checker.validateComplianceBoundary("playbooks", "memory_wiki").valid).toBe(true);
  });

  it("warn mode does NOT throw (only logs)", () => {
    const checker = new MemoryBoundaryChecker("warn");
    // Should not throw even for compliance violations
    expect(() => checker.validateComplianceBoundary("contracts", "memory_wiki")).not.toThrow();
    const result = checker.validateComplianceBoundary("contracts", "memory_wiki");
    expect(result.valid).toBe(false);
  });

  it("graduate() returns an enforce-mode instance", () => {
    const warn = new MemoryBoundaryChecker("warn");
    const enforced = warn.graduate();
    expect(enforced.getMode()).toBe("enforce");
    expect(() => enforced.validate("audit_trail", "memory_wiki")).toThrow(MemoryBoundaryError);
  });

  it("MemoryBoundaryError has correct name", () => {
    const checker = new MemoryBoundaryChecker("enforce");
    try {
      checker.validate("audit_trail", "memory_wiki");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MemoryBoundaryError);
      expect((e as Error).name).toBe("MemoryBoundaryError");
      expect((e as Error).message).toContain("BLOCKED");
    }
  });
});
