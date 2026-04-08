import { describe, expect, it, vi } from "vitest";
import { addFirewallRule, removeFirewallRule } from "../packages/jarvis-security-worker/src/firewall.ts";

describe("Firewall command safety", () => {
  it("rejects dangerous rule names before shell execution", async () => {
    const runner = { exec: vi.fn() };

    const result = await addFirewallRule(runner, {
      action: "add",
      rule_name: "safe\" & calc.exe",
      port: 4444,
    } as const);

    expect(result.success).toBe(false);
    expect(result.message).toContain("unsupported characters");
    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("rejects dangerous program paths before shell execution", async () => {
    const runner = { exec: vi.fn() };

    const result = await addFirewallRule(runner, {
      action: "add",
      rule_name: "Jarvis-Block-Test",
      program: "C:\\temp\\app.exe & calc.exe",
    } as const);

    expect(result.success).toBe(false);
    expect(result.message).toContain("unsupported characters");
    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("rejects dangerous rule names for deletes too", async () => {
    const runner = { exec: vi.fn() };

    const result = await removeFirewallRule(runner, "remove-me | powershell");

    expect(result.success).toBe(false);
    expect(result.message).toContain("unsupported characters");
    expect(runner.exec).not.toHaveBeenCalled();
  });
});
