import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import {
  validateManifest,
  JARVIS_PLATFORM_VERSION,
  type ManifestValidationResult,
} from "@jarvis/runtime";
import {
  isValidTransition,
  getAllowedTransitions,
  requiresApproval,
  canDeliver,
  isTerminal,
  type ArtifactState,
} from "@jarvis/runtime";
import {
  CURRENT_RELEASE,
  checkUpgrade,
  getPlatformVersion,
  type ReleaseInfo,
} from "@jarvis/runtime";
import {
  RunStore,
  runMigrations,
  requestApproval,
  delegateApproval,
} from "@jarvis/runtime";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid plugin manifest for testing. */
function makeManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    agent: {
      agent_id: "test-plugin",
      label: "Test Agent",
      version: "1.0.0",
      description: "Test agent for unit tests",
      triggers: [{ kind: "manual" }],
      capabilities: [],
      approval_gates: [],
      knowledge_collections: [],
      task_profile: { objective: "execute" },
      max_steps_per_run: 5,
      system_prompt: "You are a test agent.",
      output_channels: [],
    },
    ...overrides,
  };
}

// ── Q9: Plugin Platform ────────────────────────────────────────────────────

describe("Q9: Plugin platform", () => {
  it("validateManifest rejects manifest with incompatible min_jarvis_version", () => {
    const manifest = makeManifest({ min_jarvis_version: "99.0.0" });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Requires Jarvis >="))).toBe(true);
  });

  it("validateManifest accepts manifest with compatible version range", () => {
    const manifest = makeManifest({
      min_jarvis_version: "0.0.1",
      max_jarvis_version: "99.0.0",
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validateManifest accepts manifest without version constraints (backward compat)", () => {
    const manifest = makeManifest();
    // Ensure no version fields are present
    delete (manifest as any).min_jarvis_version;
    delete (manifest as any).max_jarvis_version;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("JARVIS_PLATFORM_VERSION is a valid semver string", () => {
    expect(JARVIS_PLATFORM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("compareSemver correctly orders versions (test via validateManifest behavior)", () => {
    // Current version is too low for the min requirement => rejected
    const tooHigh = makeManifest({ min_jarvis_version: `${Number(JARVIS_PLATFORM_VERSION.split(".")[0]) + 1}.0.0` });
    expect(validateManifest(tooHigh).valid).toBe(false);

    // Current version exceeds max => rejected
    const tooLow = makeManifest({ max_jarvis_version: "0.0.0" });
    const lowResult = validateManifest(tooLow);
    // 0.0.0 < any real version, so should fail unless platform is also 0.0.0
    if (JARVIS_PLATFORM_VERSION !== "0.0.0") {
      expect(lowResult.valid).toBe(false);
      expect(lowResult.errors.some((e) => e.includes("Requires Jarvis <="))).toBe(true);
    }

    // Exact match on both ends => accepted
    const exact = makeManifest({
      min_jarvis_version: JARVIS_PLATFORM_VERSION,
      max_jarvis_version: JARVIS_PLATFORM_VERSION,
    });
    expect(validateManifest(exact).valid).toBe(true);
  });
});

// ── Q10: Artifact Lifecycle ────────────────────────────────────────────────

describe("Q10: Artifact lifecycle", () => {
  const validPaths: [ArtifactState, ArtifactState][] = [
    ["draft", "review"],
    ["review", "approved"],
    ["approved", "delivered"],
    ["delivered", "superseded"],
  ];

  it.each(validPaths)(
    "valid transition: %s -> %s",
    (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    },
  );

  const invalidPaths: [ArtifactState, ArtifactState][] = [
    ["draft", "delivered"],
    ["delivered", "draft"],
    ["superseded", "draft"],
    ["superseded", "review"],
    ["superseded", "approved"],
    ["superseded", "delivered"],
  ];

  it.each(invalidPaths)(
    "invalid transition: %s -> %s",
    (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    },
  );

  it("getAllowedTransitions returns correct states for each state", () => {
    expect(getAllowedTransitions("draft")).toEqual(expect.arrayContaining(["review"]));
    expect(getAllowedTransitions("review")).toEqual(expect.arrayContaining(["approved", "draft"]));
    expect(getAllowedTransitions("approved")).toEqual(expect.arrayContaining(["delivered"]));
    expect(getAllowedTransitions("delivered")).toEqual(expect.arrayContaining(["superseded"]));
    expect(getAllowedTransitions("superseded")).toEqual([]);
  });

  it("requiresApproval is true for draft and review", () => {
    expect(requiresApproval("draft")).toBe(true);
    expect(requiresApproval("review")).toBe(true);
    expect(requiresApproval("approved")).toBe(false);
    expect(requiresApproval("delivered")).toBe(false);
    expect(requiresApproval("superseded")).toBe(false);
  });

  it("canDeliver is true only for approved", () => {
    expect(canDeliver("approved")).toBe(true);
    expect(canDeliver("draft")).toBe(false);
    expect(canDeliver("review")).toBe(false);
    expect(canDeliver("delivered")).toBe(false);
    expect(canDeliver("superseded")).toBe(false);
  });

  it("isTerminal is true only for superseded", () => {
    expect(isTerminal("superseded")).toBe(true);
    expect(isTerminal("draft")).toBe(false);
    expect(isTerminal("review")).toBe(false);
    expect(isTerminal("approved")).toBe(false);
    expect(isTerminal("delivered")).toBe(false);
  });
});

// ── Q11: Release Metadata ──────────────────────────────────────────────────

describe("Q11: Release metadata", () => {
  it("CURRENT_RELEASE has valid version, migrations list, changelog", () => {
    expect(CURRENT_RELEASE.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Array.isArray(CURRENT_RELEASE.migrations)).toBe(true);
    expect(CURRENT_RELEASE.migrations.length).toBeGreaterThan(0);
    expect(typeof CURRENT_RELEASE.changelog_summary).toBe("string");
    expect(CURRENT_RELEASE.changelog_summary.length).toBeGreaterThan(0);
  });

  it("checkUpgrade identifies pending migrations", () => {
    // Simulate a node that has only applied the first two migrations
    const applied = CURRENT_RELEASE.migrations.slice(0, 2);
    const result = checkUpgrade(applied, CURRENT_RELEASE);
    expect(result.can_upgrade).toBe(true);
    expect(result.pending_migrations.length).toBe(CURRENT_RELEASE.migrations.length - 2);
    expect(result.pending_migrations).toEqual(CURRENT_RELEASE.migrations.slice(2));
  });

  it("checkUpgrade returns requires_backup when migrations pending", () => {
    const result = checkUpgrade([], CURRENT_RELEASE);
    expect(result.requires_backup).toBe(true);
    // When fully up-to-date, no backup needed
    const upToDate = checkUpgrade([...CURRENT_RELEASE.migrations], CURRENT_RELEASE);
    expect(upToDate.requires_backup).toBe(false);
  });

  it("checkUpgrade warns when many migrations pending", () => {
    // CURRENT_RELEASE has 6 migrations, applying 0 leaves 6 pending (> 3 threshold)
    const result = checkUpgrade([], CURRENT_RELEASE);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/pending migrations/);
  });

  it("getPlatformVersion returns JARVIS_PLATFORM_VERSION", () => {
    expect(getPlatformVersion()).toBe(JARVIS_PLATFORM_VERSION);
  });
});

// ── Q12: Y2 Review Fixes ──────────────────────────────────────────────────

describe("Q12: Y2 review fixes", () => {
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dbPath = join(os.tmpdir(), `jarvis-y3-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  });

  it("RunStore.startRun with owner parameter stores owner in DB", () => {
    const store = new RunStore(db);
    const runId = store.startRun("evidence-auditor", "manual", undefined, "audit ISO gap", undefined, "daniel");

    const run = store.getRun(runId) as any;
    expect(run).not.toBeNull();
    expect(run.owner).toBe("daniel");
    expect(run.agent_id).toBe("evidence-auditor");

    // Verify getRunsByUser returns the run
    const userRuns = store.getRunsByUser("daniel");
    expect(userRuns.length).toBeGreaterThanOrEqual(1);
    expect(userRuns.some((r) => r.run_id === runId)).toBe(true);
  });

  it("delegateApproval is transactional: creates approval, delegates, verify both approval update and audit_log exist", () => {
    // Create a run and an approval to delegate
    const store = new RunStore(db);
    const runId = store.startRun("contract-reviewer", "manual");
    const approvalId = requestApproval(db, {
      agent_id: "contract-reviewer",
      run_id: runId,
      action: "email.send",
      severity: "critical",
      payload: JSON.stringify({ to: "client@example.com" }),
    });

    // Delegate to another operator
    const success = delegateApproval(db, approvalId, "alice", "daniel", "Alice handles contracts");
    expect(success).toBe(true);

    // Verify approval was updated with delegation info
    const approval = db.prepare(
      "SELECT assignee, delegated_by, delegation_note, status FROM approvals WHERE approval_id = ?",
    ).get(approvalId) as any;
    expect(approval.assignee).toBe("alice");
    expect(approval.delegated_by).toBe("daniel");
    expect(approval.delegation_note).toBe("Alice handles contracts");
    expect(approval.status).toBe("pending"); // delegation does not resolve

    // Verify audit_log entry was written
    const auditRows = db.prepare(
      "SELECT * FROM audit_log WHERE target_id = ? AND action = 'approval.delegated'",
    ).all(approvalId) as any[];
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].actor_id).toBe("daniel");
    expect(JSON.parse(auditRows[0].payload_json)).toMatchObject({ assignee: "alice" });
  });

  it("delegateApproval on non-pending approval returns false", () => {
    const store = new RunStore(db);
    const runId = store.startRun("bd-pipeline", "manual");
    const approvalId = requestApproval(db, {
      agent_id: "bd-pipeline",
      run_id: runId,
      action: "crm.move_stage",
      severity: "warning",
      payload: "{}",
    });

    // Resolve the approval first so it is no longer pending
    db.prepare("UPDATE approvals SET status = 'approved' WHERE approval_id = ?").run(approvalId);

    // Now delegation should fail
    const result = delegateApproval(db, approvalId, "bob", "daniel");
    expect(result).toBe(false);

    // Verify no audit_log entry was written for the failed delegation
    const auditRows = db.prepare(
      "SELECT * FROM audit_log WHERE target_id = ? AND action = 'approval.delegated'",
    ).all(approvalId) as any[];
    expect(auditRows.length).toBe(0);
  });
});
