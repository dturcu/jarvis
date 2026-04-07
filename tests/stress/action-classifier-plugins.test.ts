/**
 * Stress: Action Classifier + Plugin Permissions
 *
 * Tests read-only action classification and plugin permission system:
 * permission derivation, action checks, manifest validation, fail-closed behavior.
 */

import { describe, it, expect } from "vitest";
import {
  isReadOnlyAction, getReadOnlySuffixes,
  deriveRequiredPermissions, isActionPermitted, validateManifest,
  PLUGIN_PERMISSIONS,
} from "@jarvis/runtime";

// ── Action Classifier ───────────────────────────────────────────────────────

describe("Action Classifier", () => {
  it("all read-only suffixes recognized", () => {
    const suffixes = getReadOnlySuffixes();
    expect(suffixes.size).toBeGreaterThan(20);

    const readOnlyActions = [
      "email.search", "email.read", "email.list", "email.get",
      "crm.search", "crm.list", "crm.find", "crm.query",
      "web.search", "web.fetch", "web.monitor", "web.scan",
      "document.extract", "document.analyze", "document.classify",
      "inference.summarize", "inference.validate",
      "system.status", "system.health", "system.stats",
      "browser.inspect", "browser.lookup",
      "calendar.preview", "calendar.estimate",
      "security.check", "security.diff", "security.compare",
    ];

    for (const action of readOnlyActions) {
      expect(isReadOnlyAction(action)).toBe(true);
    }
  });

  it("mutating actions correctly identified", () => {
    const mutatingActions = [
      "email.send", "email.draft", "email.label",
      "crm.add_contact", "crm.update_contact", "crm.move_stage",
      "social.post", "social.comment", "social.like", "social.follow",
      "document.generate_report", "document.ingest",
      "calendar.create_event", "calendar.update_event",
      "browser.click", "browser.type", "browser.navigate",
      "crm.add_note", "crm.delete",
    ];

    for (const action of mutatingActions) {
      expect(isReadOnlyAction(action)).toBe(false);
    }
  });

  it("unknown suffixes default to mutating (fail-closed)", () => {
    expect(isReadOnlyAction("email.custom_action")).toBe(false);
    expect(isReadOnlyAction("crm.unknown_op")).toBe(false);
    expect(isReadOnlyAction("")).toBe(false);
    expect(isReadOnlyAction("no_dot_at_all")).toBe(false);
  });

  it("case insensitive suffix matching", () => {
    // The classifier lowercases before checking
    expect(isReadOnlyAction("email.SEARCH")).toBe(true);
    expect(isReadOnlyAction("crm.Search")).toBe(true);
    expect(isReadOnlyAction("web.MONITOR")).toBe(true);
  });

  it("multi-dot actions use last segment", () => {
    expect(isReadOnlyAction("web.api.search")).toBe(true);
    expect(isReadOnlyAction("internal.admin.send")).toBe(false);
    expect(isReadOnlyAction("deep.nested.chain.list")).toBe(true);
  });
});

// ── Plugin Permissions ──────────────────────────────────────────────────────

describe("Plugin Permissions", () => {
  it("deriveRequiredPermissions maps capabilities correctly", () => {
    const perms = deriveRequiredPermissions(["email", "crm", "web", "browser"]);
    expect(perms).toContain("execute_email");
    expect(perms).toContain("read_crm");
    expect(perms).toContain("execute_web");
    expect(perms).toContain("execute_browser");
  });

  it("deriveRequiredPermissions handles empty capabilities", () => {
    expect(deriveRequiredPermissions([])).toHaveLength(0);
  });

  it("deriveRequiredPermissions deduplicates", () => {
    const perms = deriveRequiredPermissions(["email", "email", "email"]);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toBe("execute_email");
  });

  it("isActionPermitted: granted actions allowed", () => {
    const granted = ["execute_email", "read_crm", "execute_web"] as any[];

    expect(isActionPermitted("email.send", granted)).toBe(true);
    expect(isActionPermitted("email.search", granted)).toBe(true);
    expect(isActionPermitted("crm.list_pipeline", granted)).toBe(true);
    expect(isActionPermitted("web.search_news", granted)).toBe(true);
  });

  it("isActionPermitted: non-granted actions denied", () => {
    const granted = ["execute_email"] as any[];

    expect(isActionPermitted("crm.add_contact", granted)).toBe(false);
    expect(isActionPermitted("browser.navigate", granted)).toBe(false);
    expect(isActionPermitted("social.post", granted)).toBe(false);
  });

  it("isActionPermitted: unknown prefixes denied (fail-closed)", () => {
    const granted = PLUGIN_PERMISSIONS.slice() as any[];
    expect(isActionPermitted("custom.action", granted)).toBe(false);
    expect(isActionPermitted("unknown.operation", granted)).toBe(false);
  });

  it("all PLUGIN_PERMISSIONS are valid strings", () => {
    expect(PLUGIN_PERMISSIONS.length).toBeGreaterThan(10);
    for (const perm of PLUGIN_PERMISSIONS) {
      expect(typeof perm).toBe("string");
      expect(perm.length).toBeGreaterThan(3);
    }
  });
});

// ── Manifest Validation ─────────────────────────────────────────────────────

describe("Manifest Validation", () => {
  const validManifest = {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin for stress testing",
    agent: {
      agent_id: "plugin-test-plugin",
      label: "Test Agent",
      version: "1.0.0",
      description: "Test agent for plugin validation",
      system_prompt: "You are a test agent",
      capabilities: ["email", "crm"],
      triggers: [{ kind: "manual" as const }],
      approval_gates: [],
      knowledge_collections: [],
      task_profile: { objective: "execute" as const },
      max_steps_per_run: 5,
      output_channels: [],
    },
    permissions: ["execute_email", "read_crm"],
    installed_at: new Date().toISOString(),
  };

  it("valid manifest passes", () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("missing required fields fails", () => {
    const result = validateManifest({ id: "incomplete" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("agent_id must match manifest id", () => {
    const bad = { ...validManifest, agent: { ...validManifest.agent, agent_id: "wrong-id" } };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("agent_id"))).toBe(true);
  });

  it("permissions must cover capabilities", () => {
    const missingPerms = {
      ...validManifest,
      agent: { ...validManifest.agent, capabilities: ["email", "crm", "browser"] },
      permissions: ["execute_email"], // missing read_crm and execute_browser
    };
    const result = validateManifest(missingPerms);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("permissions"))).toBe(true);
  });

  it("null/undefined/number all rejected", () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest(undefined).valid).toBe(false);
    expect(validateManifest(42).valid).toBe(false);
    expect(validateManifest("string").valid).toBe(false);
  });
});
