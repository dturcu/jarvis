import { describe, expect, it } from "vitest";
import { createJarvisApprovalHook } from "@jarvis/core";

describe("Jarvis core approval hook", () => {
  it("requires approval for risky built-in tools only", () => {
    const hook = createJarvisApprovalHook();

    expect(hook({ toolName: "exec" })).toEqual({
      requireApproval: {
        title: "Approve exec",
        description: "Jarvis requires operator approval before using exec.",
        severity: "critical",
        timeoutMs: 300000,
        timeoutBehavior: "deny"
      }
    });

    expect(hook({ toolName: "browser" })).toEqual({
      requireApproval: {
        title: "Approve browser",
        description: "Jarvis requires operator approval before using browser.",
        severity: "warning",
        timeoutMs: 300000,
        timeoutBehavior: "deny"
      }
    });

    expect(hook({ toolName: "web_fetch" })).toBeUndefined();
  });
});
