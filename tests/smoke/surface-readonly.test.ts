/**
 * Frozen contract: copilot surfaces (chat and godmode) expose ONLY read-only tools.
 * This test prevents accidental re-addition of mutation tools.
 *
 * Also includes fuzz-style tests for tool-call extraction regex resilience.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

// ===========================================================================
// Copilot Surface: Frozen Read-Only Contract
// ===========================================================================

describe("Copilot Surface: Frozen Read-Only Contract", () => {
  const MUTATION_TOOLS = [
    "run_command", "write_file", "gmail_send", "gmail_reply",
    "crm_update", "email_send", "execute_shell",
    "file_write", "publish_post", "trade_execute",
  ];

  it("chat.ts AGENT_TOOLS contains no mutation tools", () => {
    const chatSrc = fs.readFileSync(join(ROOT, "packages/jarvis-dashboard/src/api/chat.ts"), "utf8");
    for (const tool of MUTATION_TOOLS) {
      // Check tool isn't in the AGENT_TOOLS array (allow comments/error handlers)
      const inToolDef = new RegExp(`name:\\s*'${tool}'`).test(chatSrc);
      expect(inToolDef, `chat.ts should not define tool '${tool}'`).toBe(false);
    }
  });

  it("godmode.ts contains no mutation tools in TOOL_DESCRIPTIONS", () => {
    const godmodeSrc = fs.readFileSync(join(ROOT, "packages/jarvis-dashboard/src/api/godmode.ts"), "utf8");
    for (const tool of MUTATION_TOOLS) {
      const inDesc = new RegExp(`\\[TOOL:${tool}\\]`).test(godmodeSrc);
      expect(inDesc, `godmode.ts should not expose tool '${tool}'`).toBe(false);
    }
  });

  it("tool-infra.ts READONLY_TOOL_NAMES does not include mutation tools", () => {
    const infraSrc = fs.readFileSync(join(ROOT, "packages/jarvis-dashboard/src/api/tool-infra.ts"), "utf8");
    for (const tool of MUTATION_TOOLS) {
      expect(infraSrc).not.toContain(`"${tool}"`);
    }
  });

  it("trigger_agent is NOT declared as a callable tool in legacy chat", () => {
    // trigger_agent was removed from the legacy Telegram chat surface because
    // queuing agent runs from an un-approval-gated ingress bypassed the
    // approval pipeline. The case branch still exists but now returns a
    // user-facing refusal instead of inserting into agent_commands.
    // See docs/ARCHITECTURE-UPDATE-2026-04.md #8.
    const chatSrc = fs.readFileSync(join(ROOT, "packages/jarvis-dashboard/src/api/chat.ts"), "utf8");
    expect(new RegExp("name:\\s*'trigger_agent'").test(chatSrc)).toBe(false);
    // The handler must still be present as a refusal so the LLM gets a
    // deterministic response rather than an unhandled tool error.
    expect(chatSrc).toContain("trigger_agent is disabled on the legacy chat surface");
  });
});

// ===========================================================================
// Tool-call extraction: fuzz cases
// ===========================================================================

describe("Tool-call extraction: fuzz cases", () => {
  // These test the extractToolCalls regex from tool-infra.ts
  // We replicate the regex here to test pattern resilience without
  // importing from a package that requires a full build context.
  const TOOL_REGEX = /\[TOOL:(\w+)\]\((\{[\s\S]*?\})\)/g;

  it("handles malformed JSON gracefully", () => {
    const text = '[TOOL:web_search]({"query": broken})';
    const matches = [...text.matchAll(new RegExp(TOOL_REGEX.source, "g"))];
    expect(matches.length).toBe(1); // Regex matches but JSON.parse would fail
  });

  it("handles nested braces", () => {
    const text = '[TOOL:test]({"a":{"b":"c"}})';
    const matches = [...text.matchAll(new RegExp(TOOL_REGEX.source, "g"))];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects tool names with special characters", () => {
    const text = '[TOOL:rm -rf]({"path":"/"})';
    const matches = [...text.matchAll(new RegExp(TOOL_REGEX.source, "g"))];
    expect(matches.length).toBe(0); // \w+ won't match spaces
  });

  it("handles empty params", () => {
    const text = '[TOOL:system_info]({})';
    const matches = [...text.matchAll(new RegExp(TOOL_REGEX.source, "g"))];
    expect(matches.length).toBe(1);
  });

  it("rejects tool names with path separators", () => {
    const text = '[TOOL:../../etc/passwd]({"read":true})';
    const matches = [...text.matchAll(new RegExp(TOOL_REGEX.source, "g"))];
    expect(matches.length).toBe(0); // \w+ won't match dots or slashes
  });

  it("handles multiple tool calls in one string", () => {
    const text = 'First [TOOL:web_search]({"query":"test"}) then [TOOL:web_fetch]({"url":"https://x.com"})';
    const matches = [...text.matchAll(new RegExp(TOOL_REGEX.source, "g"))];
    expect(matches.length).toBe(2);
    expect(matches[0]![1]).toBe("web_search");
    expect(matches[1]![1]).toBe("web_fetch");
  });

  it("does not match incomplete tool syntax", () => {
    const text = '[TOOL:web_search]';
    const matches = [...text.matchAll(new RegExp(TOOL_REGEX.source, "g"))];
    expect(matches.length).toBe(0); // Missing params section
  });

  it("does not match if curly braces are absent", () => {
    const text = '[TOOL:web_search](no-braces)';
    const matches = [...text.matchAll(new RegExp(TOOL_REGEX.source, "g"))];
    expect(matches.length).toBe(0);
  });
});
