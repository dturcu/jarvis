/**
 * Unit tests for MemoryBoundaryChecker (Epic 7).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryBoundaryChecker,
  type MemoryCategory,
  type TargetStore,
} from "@jarvis/agent-framework";

describe("MemoryBoundaryChecker", () => {
  let checker: MemoryBoundaryChecker;

  beforeEach(() => {
    checker = new MemoryBoundaryChecker("warn");
  });

  describe("validate()", () => {
    it("allows conversation_context to session_state", () => {
      const result = checker.validate("conversation_context", "session_state");
      expect(result.valid).toBe(true);
    });

    it("rejects conversation_context to runtime_db", () => {
      const result = checker.validate("conversation_context", "runtime_db");
      expect(result.valid).toBe(false);
      expect(result.violation).toContain("conversation_context");
      expect(result.violation).toContain("session_state");
    });

    it("allows run_state to runtime_db", () => {
      const result = checker.validate("run_state", "runtime_db");
      expect(result.valid).toBe(true);
    });

    it("rejects run_state to knowledge_db", () => {
      const result = checker.validate("run_state", "knowledge_db");
      expect(result.valid).toBe(false);
    });

    it("allows domain_facts to crm_db and knowledge_db", () => {
      expect(checker.validate("domain_facts", "crm_db").valid).toBe(true);
      expect(checker.validate("domain_facts", "knowledge_db").valid).toBe(true);
    });

    it("rejects domain_facts to session_state", () => {
      const result = checker.validate("domain_facts", "session_state");
      expect(result.valid).toBe(false);
    });

    it("allows audit_trail to runtime_db", () => {
      expect(checker.validate("audit_trail", "runtime_db").valid).toBe(true);
    });

    it("rejects audit_trail to memory_wiki", () => {
      const result = checker.validate("audit_trail", "memory_wiki");
      expect(result.valid).toBe(false);
    });

    it("allows operator_preferences to session_state and memory_wiki", () => {
      expect(checker.validate("operator_preferences", "session_state").valid).toBe(true);
      expect(checker.validate("operator_preferences", "memory_wiki").valid).toBe(true);
    });
  });

  describe("compliance collections", () => {
    const COMPLIANCE = [
      "contracts", "iso26262", "aspice", "cybersecurity", "signed_records", "safety_case",
    ];

    for (const collection of COMPLIANCE) {
      it(`blocks ${collection} from memory_wiki`, () => {
        const result = checker.validateComplianceBoundary(collection, "memory_wiki");
        expect(result.valid).toBe(false);
        expect(result.violation).toContain("Compliance collection");
      });

      it(`blocks ${collection} from session_state`, () => {
        const result = checker.validateComplianceBoundary(collection, "session_state");
        expect(result.valid).toBe(false);
      });

      it(`allows ${collection} to knowledge_db`, () => {
        const result = checker.validateComplianceBoundary(collection, "knowledge_db");
        expect(result.valid).toBe(true);
      });
    }

    it("allows non-compliance collections to memory_wiki", () => {
      const result = checker.validateComplianceBoundary("lessons", "memory_wiki");
      expect(result.valid).toBe(true);
    });

    it("identifies compliance collections correctly", () => {
      expect(checker.isComplianceCollection("contracts")).toBe(true);
      expect(checker.isComplianceCollection("iso26262")).toBe(true);
      expect(checker.isComplianceCollection("lessons")).toBe(false);
      expect(checker.isComplianceCollection("playbooks")).toBe(false);
    });
  });

  describe("violation tracking", () => {
    it("records violations", () => {
      checker.validate("audit_trail", "memory_wiki");
      checker.validate("run_state", "session_state");
      expect(checker.getViolations()).toHaveLength(2);
    });

    it("clears violations", () => {
      checker.validate("audit_trail", "memory_wiki");
      expect(checker.getViolations()).toHaveLength(1);
      checker.clearViolations();
      expect(checker.getViolations()).toHaveLength(0);
    });

    it("reports enforcement mode", () => {
      expect(checker.getMode()).toBe("warn");
      const strict = new MemoryBoundaryChecker("enforce");
      expect(strict.getMode()).toBe("enforce");
    });
  });
});
