import { describe, it, expect } from "vitest";
import {
  WORKER_EXECUTION_POLICIES,
  getExecutionPolicy,
  type ExecutionPolicy,
} from "@jarvis/runtime";

// ─── Expected classification ───────────────────────────────────────────────

const CHILD_PROCESS_PREFIXES = [
  "interpreter",
  "browser",
  "device",
  "voice",
  "security",
  "social",
  "files",
];

const IN_PROCESS_PREFIXES = [
  "inference",
  "email",
  "document",
  "crm",
  "web",
  "calendar",
  "office",
  "time",
  "drive",
  "system",
];

const ALL_PREFIXES = [...IN_PROCESS_PREFIXES, ...CHILD_PROCESS_PREFIXES];

const APPROVAL_GUARD_PREFIXES = [
  "email",
  "calendar",
  "system",
  "files",
  "interpreter",
  "device",
  "security",
  "social",
];

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("ExecutionPolicy", () => {
  it("defines policies for all 17 worker prefixes", () => {
    const definedPrefixes = Object.keys(WORKER_EXECUTION_POLICIES);
    expect(definedPrefixes).toHaveLength(17);
    for (const prefix of ALL_PREFIXES) {
      expect(
        WORKER_EXECUTION_POLICIES,
        `Missing policy for prefix: ${prefix}`,
      ).toHaveProperty(prefix);
    }
  });

  describe("isolation classification", () => {
    it.each(CHILD_PROCESS_PREFIXES)(
      "%s is classified as child_process",
      (prefix) => {
        expect(WORKER_EXECUTION_POLICIES[prefix]!.isolation).toBe(
          "child_process",
        );
      },
    );

    it.each(IN_PROCESS_PREFIXES)(
      "%s is classified as in_process",
      (prefix) => {
        expect(WORKER_EXECUTION_POLICIES[prefix]!.isolation).toBe(
          "in_process",
        );
      },
    );
  });

  describe("getExecutionPolicy", () => {
    it("returns the policy for a known prefix", () => {
      const policy = getExecutionPolicy("email");
      expect(policy).toBeDefined();
      expect(policy!.prefix).toBe("email");
      expect(policy!.isolation).toBe("in_process");
      expect(policy!.timeout_seconds).toBe(60);
      expect(policy!.requires_approval_guard).toBe(true);
    });

    it("returns undefined for an unknown prefix", () => {
      expect(getExecutionPolicy("nonexistent")).toBeUndefined();
      expect(getExecutionPolicy("")).toBeUndefined();
    });
  });

  describe("timeout_seconds", () => {
    it("all policies have a positive timeout", () => {
      for (const [prefix, policy] of Object.entries(WORKER_EXECUTION_POLICIES)) {
        expect(
          policy.timeout_seconds,
          `${prefix} should have positive timeout`,
        ).toBeGreaterThan(0);
      }
    });
  });

  describe("approval guard", () => {
    it.each(APPROVAL_GUARD_PREFIXES)(
      "%s requires approval guard",
      (prefix) => {
        expect(WORKER_EXECUTION_POLICIES[prefix]!.requires_approval_guard).toBe(
          true,
        );
      },
    );

    it("non-approval-guard workers have requires_approval_guard = false", () => {
      const noGuard = ALL_PREFIXES.filter(
        (p) => !APPROVAL_GUARD_PREFIXES.includes(p),
      );
      for (const prefix of noGuard) {
        expect(
          WORKER_EXECUTION_POLICIES[prefix]!.requires_approval_guard,
          `${prefix} should not require approval guard`,
        ).toBe(false);
      }
    });
  });

  it("each policy prefix field matches its record key", () => {
    for (const [key, policy] of Object.entries(WORKER_EXECUTION_POLICIES)) {
      expect(policy.prefix).toBe(key);
    }
  });
});
