/**
 * Exhaustive Stress: Action Classifier + Plugin Permissions
 *
 * Thoroughly tests every read-only suffix, case sensitivity, multi-dot parsing,
 * edge cases, all mutating actions, capability-permission mapping, isActionPermitted
 * for every prefix, deriveRequiredPermissions, and PLUGIN_PERMISSIONS constant.
 */

import { describe, it, expect } from "vitest";
import {
  isReadOnlyAction, getReadOnlySuffixes,
  deriveRequiredPermissions, isActionPermitted,
  PLUGIN_PERMISSIONS,
} from "@jarvis/runtime";

// ── isReadOnlyAction — every suffix individually ───────────────────────────

describe("isReadOnlyAction — exhaustive suffix coverage", () => {
  const READ_ONLY_SUFFIXES = [
    "search", "list", "get", "find", "query", "count", "check", "scan",
    "read", "fetch", "inspect", "lookup", "analyze", "extract", "classify",
    "summarize", "validate", "monitor", "stats", "status", "health",
    "preview", "estimate", "compare", "diff",
  ];

  for (const suffix of READ_ONLY_SUFFIXES) {
    it(`"crm.${suffix}" is read-only`, () => {
      expect(isReadOnlyAction(`crm.${suffix}`)).toBe(true);
    });
  }

  it("getReadOnlySuffixes contains all expected suffixes", () => {
    const suffixes = getReadOnlySuffixes();
    for (const s of READ_ONLY_SUFFIXES) {
      expect(suffixes.has(s)).toBe(true);
    }
  });

  it("getReadOnlySuffixes returns at least 25 entries", () => {
    expect(getReadOnlySuffixes().size).toBeGreaterThanOrEqual(25);
  });
});

// ── isReadOnlyAction — case variations ─────────────────────────────────────

describe("isReadOnlyAction — case insensitive", () => {
  it("EMAIL.SEARCH → read-only", () => {
    expect(isReadOnlyAction("EMAIL.SEARCH")).toBe(true);
  });

  it("Crm.Search → read-only", () => {
    expect(isReadOnlyAction("Crm.Search")).toBe(true);
  });

  it("WEB.monitor → read-only", () => {
    expect(isReadOnlyAction("WEB.monitor")).toBe(true);
  });

  it("social.SCAN → read-only", () => {
    expect(isReadOnlyAction("social.SCAN")).toBe(true);
  });

  it("BROWSER.INSPECT → read-only", () => {
    expect(isReadOnlyAction("BROWSER.INSPECT")).toBe(true);
  });

  it("Device.Fetch → read-only", () => {
    expect(isReadOnlyAction("Device.Fetch")).toBe(true);
  });

  it("CALENDAR.PREVIEW → read-only", () => {
    expect(isReadOnlyAction("CALENDAR.PREVIEW")).toBe(true);
  });

  it("inference.SUMMARIZE → read-only", () => {
    expect(isReadOnlyAction("inference.SUMMARIZE")).toBe(true);
  });

  it("EMAIL.SEND → mutating even when uppercased", () => {
    expect(isReadOnlyAction("EMAIL.SEND")).toBe(false);
  });

  it("CRM.ADD_CONTACT → mutating even when uppercased", () => {
    expect(isReadOnlyAction("CRM.ADD_CONTACT")).toBe(false);
  });
});

// ── isReadOnlyAction — multi-dot actions ───────────────────────────────────

describe("isReadOnlyAction — multi-dot (last segment wins)", () => {
  it("a.b.search → read-only (last segment is 'search')", () => {
    expect(isReadOnlyAction("a.b.search")).toBe(true);
  });

  it("deep.nested.chain.list → read-only", () => {
    expect(isReadOnlyAction("deep.nested.chain.list")).toBe(true);
  });

  it("x.y.z.monitor → read-only", () => {
    expect(isReadOnlyAction("x.y.z.monitor")).toBe(true);
  });

  it("deep.nested.send → mutating", () => {
    expect(isReadOnlyAction("deep.nested.send")).toBe(false);
  });

  it("a.b.c.d.e.delete → mutating", () => {
    expect(isReadOnlyAction("a.b.c.d.e.delete")).toBe(false);
  });

  it("internal.admin.query → read-only", () => {
    expect(isReadOnlyAction("internal.admin.query")).toBe(true);
  });
});

// ── isReadOnlyAction — no-dot actions ──────────────────────────────────────

describe("isReadOnlyAction — no-dot (entire string is the suffix)", () => {
  it("'search' → read-only", () => {
    expect(isReadOnlyAction("search")).toBe(true);
  });

  it("'list' → read-only", () => {
    expect(isReadOnlyAction("list")).toBe(true);
  });

  it("'monitor' → read-only", () => {
    expect(isReadOnlyAction("monitor")).toBe(true);
  });

  it("'send' → mutating", () => {
    expect(isReadOnlyAction("send")).toBe(false);
  });

  it("'create' → mutating", () => {
    expect(isReadOnlyAction("create")).toBe(false);
  });

  it("'delete' → mutating", () => {
    expect(isReadOnlyAction("delete")).toBe(false);
  });
});

// ── isReadOnlyAction — empty string ────────────────────────────────────────

describe("isReadOnlyAction — empty string", () => {
  it("empty string → false (mutating / fail-closed)", () => {
    expect(isReadOnlyAction("")).toBe(false);
  });
});

// ── isReadOnlyAction — common mutating actions ─────────────────────────────

describe("isReadOnlyAction — mutating actions", () => {
  const MUTATING_ACTIONS = [
    "email.send", "email.draft", "email.label",
    "crm.create", "crm.update", "crm.delete", "crm.move",
    "crm.add_contact", "crm.update_contact", "crm.move_stage", "crm.add_note",
    "social.post", "social.comment", "social.like", "social.follow", "social.repost",
    "document.generate_report", "document.ingest",
    "calendar.create_event", "calendar.update_event",
    "browser.click", "browser.type", "browser.navigate",
    "system.execute", "system.run", "system.start", "system.stop", "system.restart",
    "workflow.approve", "workflow.reject",
    "crm.add", "crm.remove",
  ];

  for (const action of MUTATING_ACTIONS) {
    it(`"${action}" is mutating`, () => {
      expect(isReadOnlyAction(action)).toBe(false);
    });
  }
});

// ── isReadOnlyAction — compound suffixes (not in read-only set) ────────────

describe("isReadOnlyAction — compound suffixes are mutating", () => {
  const COMPOUND_SUFFIXES = [
    "crm.list_pipeline",
    "web.search_news",
    "web.track_jobs",
    "crm.enrich_contact",
    "web.scrape_profile",
    "web.competitive_intel",
    "document.extract_clauses",
    "document.analyze_compliance",
    "email.list_threads",
    "calendar.list_events",
    "calendar.create_event",
    "calendar.find_free",
  ];

  for (const action of COMPOUND_SUFFIXES) {
    it(`"${action}" is NOT read-only (compound suffix not in set)`, () => {
      expect(isReadOnlyAction(action)).toBe(false);
    });
  }
});

// ── isActionPermitted — each capability prefix with correct permission ─────

describe("isActionPermitted — correct permission grants access", () => {
  const CAPABILITY_MAP: Array<{ prefix: string; permission: string }> = [
    { prefix: "knowledge", permission: "read_knowledge" },
    { prefix: "crm", permission: "read_crm" },
    { prefix: "inference", permission: "execute_inference" },
    { prefix: "browser", permission: "execute_browser" },
    { prefix: "email", permission: "execute_email" },
    { prefix: "social", permission: "execute_social" },
    { prefix: "files", permission: "execute_files" },
    { prefix: "device", permission: "execute_device" },
    { prefix: "interpreter", permission: "execute_interpreter" },
    { prefix: "scheduler", permission: "execute_scheduler" },
    { prefix: "web", permission: "execute_web" },
    { prefix: "office", permission: "execute_office" },
    { prefix: "document", permission: "execute_files" },
  ];

  for (const { prefix, permission } of CAPABILITY_MAP) {
    it(`"${prefix}.search" allowed with ["${permission}"]`, () => {
      expect(isActionPermitted(`${prefix}.search`, [permission] as any[])).toBe(true);
    });

    it(`"${prefix}.do_something" allowed with ["${permission}"]`, () => {
      expect(isActionPermitted(`${prefix}.do_something`, [permission] as any[])).toBe(true);
    });
  }
});

// ── isActionPermitted — each prefix WITHOUT required permission → denied ───

describe("isActionPermitted — missing permission denies access", () => {
  const PREFIX_PERMISSION_PAIRS: Array<{ prefix: string; wrongPermission: string }> = [
    { prefix: "email", wrongPermission: "read_crm" },
    { prefix: "crm", wrongPermission: "execute_email" },
    { prefix: "web", wrongPermission: "execute_browser" },
    { prefix: "browser", wrongPermission: "execute_web" },
    { prefix: "social", wrongPermission: "execute_files" },
    { prefix: "document", wrongPermission: "execute_social" },
    { prefix: "calendar", wrongPermission: "execute_email" },
    { prefix: "knowledge", wrongPermission: "execute_web" },
    { prefix: "inference", wrongPermission: "read_crm" },
    { prefix: "device", wrongPermission: "execute_browser" },
    { prefix: "interpreter", wrongPermission: "read_knowledge" },
    { prefix: "scheduler", wrongPermission: "execute_files" },
    { prefix: "office", wrongPermission: "execute_social" },
    { prefix: "files", wrongPermission: "execute_device" },
  ];

  for (const { prefix, wrongPermission } of PREFIX_PERMISSION_PAIRS) {
    it(`"${prefix}.action" denied with only ["${wrongPermission}"]`, () => {
      expect(isActionPermitted(`${prefix}.action`, [wrongPermission] as any[])).toBe(false);
    });
  }
});

// ── isActionPermitted — unknown prefix → always denied (fail-closed) ───────

describe("isActionPermitted — unknown prefix (fail-closed)", () => {
  it("'custom.action' denied even with all permissions", () => {
    expect(isActionPermitted("custom.action", PLUGIN_PERMISSIONS.slice() as any[])).toBe(false);
  });

  it("'unknown.operation' denied even with all permissions", () => {
    expect(isActionPermitted("unknown.operation", PLUGIN_PERMISSIONS.slice() as any[])).toBe(false);
  });

  it("'xyz.search' denied — prefix not recognized", () => {
    expect(isActionPermitted("xyz.search", PLUGIN_PERMISSIONS.slice() as any[])).toBe(false);
  });

  it("'' (empty) denied even with all permissions", () => {
    expect(isActionPermitted("", PLUGIN_PERMISSIONS.slice() as any[])).toBe(false);
  });
});

// ── isActionPermitted — empty permissions array ────────────────────────────

describe("isActionPermitted — empty permissions", () => {
  it("'email.search' denied with empty permissions", () => {
    expect(isActionPermitted("email.search", [])).toBe(false);
  });

  it("'crm.list' denied with empty permissions", () => {
    expect(isActionPermitted("crm.list", [])).toBe(false);
  });

  it("'web.monitor' denied with empty permissions", () => {
    expect(isActionPermitted("web.monitor", [])).toBe(false);
  });
});

// ── isActionPermitted — all permissions granted ────────────────────────────

describe("isActionPermitted — all permissions grant all known prefixes", () => {
  const allPerms = PLUGIN_PERMISSIONS.slice() as any[];

  const KNOWN_PREFIXES = [
    "knowledge", "crm", "inference", "browser", "email", "social",
    "files", "device", "interpreter", "scheduler", "web", "office", "document",
  ];

  for (const prefix of KNOWN_PREFIXES) {
    it(`"${prefix}.any_action" allowed with all permissions`, () => {
      expect(isActionPermitted(`${prefix}.any_action`, allPerms)).toBe(true);
    });
  }
});

// ── deriveRequiredPermissions ──────────────────────────────────────────────

describe("deriveRequiredPermissions", () => {
  it("empty capabilities → empty array", () => {
    expect(deriveRequiredPermissions([])).toHaveLength(0);
  });

  it("single capability → single permission", () => {
    const perms = deriveRequiredPermissions(["email"]);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toBe("execute_email");
  });

  it("crm → read_crm", () => {
    const perms = deriveRequiredPermissions(["crm"]);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toBe("read_crm");
  });

  it("knowledge → read_knowledge", () => {
    const perms = deriveRequiredPermissions(["knowledge"]);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toBe("read_knowledge");
  });

  it("multiple capabilities → correct set", () => {
    const perms = deriveRequiredPermissions(["email", "crm", "web", "browser"]);
    expect(perms).toContain("execute_email");
    expect(perms).toContain("read_crm");
    expect(perms).toContain("execute_web");
    expect(perms).toContain("execute_browser");
    expect(perms).toHaveLength(4);
  });

  it("duplicate capabilities → deduplicated", () => {
    const perms = deriveRequiredPermissions(["email", "email", "email"]);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toBe("execute_email");
  });

  it("all known capabilities → all corresponding permissions", () => {
    const allCaps = [
      "knowledge", "crm", "inference", "browser", "email", "social",
      "files", "device", "interpreter", "scheduler", "web", "office", "document",
    ];
    const perms = deriveRequiredPermissions(allCaps);
    expect(perms).toContain("read_knowledge");
    expect(perms).toContain("read_crm");
    expect(perms).toContain("execute_inference");
    expect(perms).toContain("execute_browser");
    expect(perms).toContain("execute_email");
    expect(perms).toContain("execute_social");
    expect(perms).toContain("execute_files");
    expect(perms).toContain("execute_device");
    expect(perms).toContain("execute_interpreter");
    expect(perms).toContain("execute_scheduler");
    expect(perms).toContain("execute_web");
    expect(perms).toContain("execute_office");
    // document maps to execute_files (same as files), so deduped
  });

  it("unknown capability → not mapped (no permission derived)", () => {
    const perms = deriveRequiredPermissions(["unknown_capability"]);
    // unknown capability should not produce any permission
    expect(perms).toHaveLength(0);
  });

  it("mix of known + unknown → only known mapped", () => {
    const perms = deriveRequiredPermissions(["email", "nonexistent", "web"]);
    expect(perms).toHaveLength(2);
    expect(perms).toContain("execute_email");
    expect(perms).toContain("execute_web");
  });
});

// ── PLUGIN_PERMISSIONS constant ────────────────────────────────────────────

describe("PLUGIN_PERMISSIONS constant", () => {
  it("contains all expected permissions", () => {
    const expected = [
      "read_knowledge", "read_crm",
      "execute_inference", "execute_browser", "execute_email",
      "execute_social", "execute_files", "execute_device",
      "execute_interpreter", "execute_scheduler", "execute_web",
      "execute_office",
    ];
    for (const perm of expected) {
      expect(PLUGIN_PERMISSIONS).toContain(perm);
    }
  });

  it("has no duplicates", () => {
    const unique = new Set(PLUGIN_PERMISSIONS);
    expect(unique.size).toBe(PLUGIN_PERMISSIONS.length);
  });

  it("all entries are strings", () => {
    for (const perm of PLUGIN_PERMISSIONS) {
      expect(typeof perm).toBe("string");
    }
  });

  it("count matches expected (at least 12)", () => {
    expect(PLUGIN_PERMISSIONS.length).toBeGreaterThanOrEqual(12);
  });

  it("all permission strings have length > 3", () => {
    for (const perm of PLUGIN_PERMISSIONS) {
      expect(perm.length).toBeGreaterThan(3);
    }
  });
});
