/**
 * Hook Catalog Tests
 *
 * Verifies the expanded hook infrastructure (Epic 8).
 * Tests each hook's behavior independently and the catalog completeness.
 */

import { describe, expect, it } from "vitest";
import {
  createBuiltInApprovalHook,
  createDomainApprovalHook,
  createCapabilityBoundaryHook,
  createProvenanceHook,
  createReplyGuardrailHook,
  createErrorPolicyHook,
  getHookCatalog,
  type ToolCallEvent,
  type ToolResultEvent,
  type ReplyEvent,
  type ErrorEvent,
} from "@jarvis/core/hooks";

describe("Hook Catalog", () => {
  describe("catalog completeness", () => {
    it("returns all six hooks", () => {
      const catalog = getHookCatalog();
      expect(catalog).toHaveLength(6);
    });

    it("covers all four hook points", () => {
      const catalog = getHookCatalog();
      const hookPoints = new Set(catalog.map((h) => h.hookPoint));
      expect(hookPoints).toContain("before_tool_call");
      expect(hookPoints).toContain("after_tool_call");
      expect(hookPoints).toContain("before_reply");
      expect(hookPoints).toContain("on_error");
    });

    it("every hook has a description", () => {
      const catalog = getHookCatalog();
      for (const hook of catalog) {
        expect(hook.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("built-in approval hook", () => {
    const hook = createBuiltInApprovalHook();

    it("gates exec with critical severity", () => {
      const result = hook.handler({ toolName: "exec" });
      expect(result?.requireApproval.severity).toBe("critical");
    });

    it("gates browser with warning severity", () => {
      const result = hook.handler({ toolName: "browser" });
      expect(result?.requireApproval.severity).toBe("warning");
    });

    it("passes read-only tools", () => {
      const result = hook.handler({ toolName: "jarvis_plan" });
      expect(result).toBeUndefined();
    });
  });

  describe("domain approval hook", () => {
    const hook = createDomainApprovalHook();

    it("gates email_send with critical severity", () => {
      const result = hook.handler({ toolName: "email_send" });
      expect(result?.requireApproval.severity).toBe("critical");
    });

    it("gates crm_move_stage with warning severity", () => {
      const result = hook.handler({ toolName: "crm_move_stage" });
      expect(result?.requireApproval.severity).toBe("warning");
    });

    it("passes non-mutating tools", () => {
      const result = hook.handler({ toolName: "email_search" });
      expect(result).toBeUndefined();
    });
  });

  describe("capability boundary hook", () => {
    const hook = createCapabilityBoundaryHook();

    it("allows read-only tools in read-only context", () => {
      const result = hook.handler({
        toolName: "email_search",
        context: { readOnly: true },
      } as ToolCallEvent & { context?: { readOnly?: boolean } });
      expect(result).toBeUndefined();
    });

    it("denies mutating tools in read-only context", () => {
      const result = hook.handler({
        toolName: "email_send",
        context: { readOnly: true },
      } as ToolCallEvent & { context?: { readOnly?: boolean } });
      expect(result).toHaveProperty("deny");
    });

    it("allows all tools when not in read-only context", () => {
      const result = hook.handler({ toolName: "email_send" });
      expect(result).toBeUndefined();
    });
  });

  describe("provenance hook", () => {
    const hook = createProvenanceHook();

    it("records tool execution provenance", () => {
      const result = hook.handler({
        toolName: "email_search",
        toolCallId: "tc-123",
        durationMs: 450,
      });
      expect(result?.provenance).toBeDefined();
      expect(result?.provenance.tool_name).toBe("email_search");
      expect(result?.provenance.duration_ms).toBe(450);
      expect(result?.provenance.timestamp).toBeDefined();
    });
  });

  describe("reply guardrail hook", () => {
    const hook = createReplyGuardrailHook();

    it("redacts API keys from replies", () => {
      const result = hook.handler({
        content: "Here is your key: sk-abcdefghijklmnopqrstuvwx",
      });
      expect(result?.modifiedContent).toContain("[REDACTED]");
      expect(result?.modifiedContent).not.toContain("sk-");
    });

    it("redacts GitHub tokens from replies", () => {
      const result = hook.handler({
        content: "Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      });
      expect(result?.modifiedContent).toContain("[REDACTED]");
    });

    it("passes clean replies", () => {
      const result = hook.handler({
        content: "The proposal is ready for review.",
      });
      expect(result).toBeUndefined();
    });
  });

  describe("error policy hook", () => {
    const hook = createErrorPolicyHook();

    it("retries connection refused errors", () => {
      const result = hook.handler({
        error: new Error("ECONNREFUSED: connection refused"),
        retryCount: 0,
      });
      expect(result?.action).toBe("retry");
      expect(result?.backoffMs).toBe(1000);
    });

    it("escalates after max retries", () => {
      const result = hook.handler({
        error: new Error("ECONNREFUSED: connection refused"),
        retryCount: 3,
      });
      expect(result?.action).toBe("escalate");
    });

    it("escalates non-retryable errors immediately", () => {
      const result = hook.handler({
        error: new Error("INVALID_INPUT: bad payload"),
        retryCount: 0,
      });
      expect(result?.action).toBe("escalate");
    });
  });
});
