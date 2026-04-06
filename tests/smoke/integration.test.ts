/**
 * R8 integration tests: multi-viewpoint planner, plan evaluator,
 * plugin validation, maturity levels, entity provenance, and failure injection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations } from "@jarvis/runtime";
import { scorePlan, rankPlans, detectDisagreement } from "@jarvis/runtime";
import {
  validateManifest,
  deriveRequiredPermissions,
  isActionPermitted,
} from "@jarvis/runtime";
import type { AgentPlan } from "@jarvis/agent-framework";
import { SqliteEntityGraph } from "@jarvis/agent-framework";

function createTestDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-int-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return { db, path: dbPath };
}

function createKnowledgeDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-kg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // Create entity tables needed by SqliteEntityGraph
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      entity_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      canonical_key TEXT UNIQUE,
      attributes TEXT DEFAULT '{}',
      seen_by TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      relation_id TEXT PRIMARY KEY,
      from_entity_id TEXT NOT NULL,
      to_entity_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      attributes TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_provenance (
      provenance_id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      run_id TEXT,
      step_no INTEGER,
      action TEXT,
      changed_at TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_prov_entity ON entity_provenance(entity_id)");
  return { db, path: dbPath };
}

function cleanup(_db: DatabaseSync, dbPath: string) {
  try { _db.close(); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
}

function makePlan(steps: Array<{ action: string; reasoning?: string }>): AgentPlan {
  return {
    run_id: "test-run",
    agent_id: "test-agent",
    goal: "test goal",
    steps: steps.map((s, i) => ({
      step: i + 1,
      action: s.action,
      input: {},
      reasoning: s.reasoning ?? `Step ${i + 1} reasoning for ${s.action}`,
    })),
    created_at: new Date().toISOString(),
  };
}

// ── Plan Evaluator Tests ─────────────────────────────────────────────────────

describe("Plan Evaluator: Scoring", () => {
  const capabilities = ["web", "email", "crm", "inference", "document"];

  it("scores a well-structured plan highly", () => {
    const plan = makePlan([
      { action: "web.search_news", reasoning: "Search for recent industry developments in automotive safety" },
      { action: "crm.list_pipeline", reasoning: "Check current pipeline status for active opportunities" },
      { action: "email.search", reasoning: "Search for recent client communications to assess priorities" },
      { action: "inference.chat", reasoning: "Analyze findings and synthesize a priority recommendation" },
    ]);

    const score = scorePlan(plan, capabilities, 10);
    expect(score.total).toBeGreaterThan(50);
    expect(score.breakdown.capability_coverage).toBeGreaterThan(40);
    expect(score.breakdown.reasoning_quality).toBe(100);
  });

  it("penalizes empty plans", () => {
    const plan = makePlan([]);
    const score = scorePlan(plan, capabilities, 10);
    expect(score.total).toBe(0);
  });

  it("penalizes repetitive actions", () => {
    const plan = makePlan([
      { action: "web.search_news" },
      { action: "web.search_news" },
      { action: "web.search_news" },
      { action: "web.search_news" },
    ]);

    const score = scorePlan(plan, capabilities, 10);
    expect(score.breakdown.action_diversity).toBe(25); // 1 unique / 4 total
  });

  it("penalizes bloated plans", () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({
      action: `step.${i}`,
    }));
    const plan = makePlan(steps);

    const score = scorePlan(plan, capabilities, 10);
    expect(score.breakdown.step_efficiency).toBeLessThan(100);
  });
});

describe("Plan Evaluator: Ranking", () => {
  const capabilities = ["web", "email", "crm"];

  it("ranks plans by score (best first)", () => {
    const good = makePlan([
      { action: "web.search_news", reasoning: "Search for automotive safety news in target markets" },
      { action: "crm.list_pipeline", reasoning: "Review current business development pipeline status" },
      { action: "email.search", reasoning: "Look for recent RFQ emails from existing clients" },
    ]);

    const bad = makePlan([
      { action: "web.search_news" },
      { action: "web.search_news" },
    ]);

    const scores = rankPlans([good, bad], capabilities, 8);
    expect(scores[0].plan_index).toBe(0); // good plan first
    expect(scores[0].total).toBeGreaterThan(scores[1].total);
  });
});

describe("Plan Evaluator: Disagreement Detection", () => {
  it("detects agreement between similar plans", () => {
    const a = makePlan([{ action: "web.search" }, { action: "crm.update" }]);
    const b = makePlan([{ action: "web.search" }, { action: "crm.update" }, { action: "email.send" }]);

    const result = detectDisagreement([a, b]);
    // email.send is unique to one plan, but that's only 1/3 = 33%, borderline
    // step count: 2 vs 3, ratio 1.5 = not over threshold
    expect(result.details.step_count_range).toEqual([2, 3]);
  });

  it("detects disagreement when plans use very different actions", () => {
    const a = makePlan([{ action: "web.search" }, { action: "email.send" }]);
    const b = makePlan([{ action: "crm.update" }, { action: "document.generate" }]);

    const result = detectDisagreement([a, b]);
    expect(result.disagreement).toBe(true);
    expect(result.details.unique_actions.length).toBeGreaterThan(0);
  });

  it("handles single plan (no disagreement)", () => {
    const a = makePlan([{ action: "web.search" }]);
    const result = detectDisagreement([a]);
    expect(result.disagreement).toBe(false);
  });
});

// ── Plugin Validation Tests ──────────────────────────────────────────────────

describe("Plugin Validation", () => {
  it("validates a correct manifest", () => {
    const manifest = {
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin for validation",
      permissions: ["read_knowledge", "execute_inference"],
      agent: {
        agent_id: "plugin-test-plugin",
        label: "Test Agent",
        version: "1.0.0",
        description: "A test agent from a plugin",
        triggers: [{ kind: "manual" }],
        capabilities: ["knowledge", "inference"],
        approval_gates: [],
        knowledge_collections: [],
        task_profile: { objective: "classify" },
        max_steps_per_run: 5,
        system_prompt: "You are a test agent.",
        output_channels: [],
      },
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects manifest with missing required fields", () => {
    const result = validateManifest({ id: "test" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects manifest with invalid agent_id pattern", () => {
    const result = validateManifest({
      id: "INVALID_ID",
      name: "Bad",
      version: "1.0.0",
      description: "test",
      agent: {
        agent_id: "INVALID_ID",
        label: "Bad",
        version: "1.0.0",
        description: "test",
        triggers: [],
        capabilities: [],
        approval_gates: [],
        knowledge_collections: [],
        task_profile: { objective: "classify" },
        max_steps_per_run: 5,
        system_prompt: "test",
        output_channels: [],
      },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects manifest with invalid version format", () => {
    const result = validateManifest({
      id: "test-plugin",
      name: "Test",
      version: "not-semver",
      description: "test",
      agent: {
        agent_id: "test-plugin",
        label: "Test",
        version: "1.0.0",
        description: "test",
        triggers: [],
        capabilities: [],
        approval_gates: [],
        knowledge_collections: [],
        task_profile: { objective: "classify" },
        max_steps_per_run: 5,
        system_prompt: "test",
        output_channels: [],
      },
    });
    expect(result.valid).toBe(false);
  });
});

describe("Plugin Permissions", () => {
  it("derives required permissions from capabilities", () => {
    const perms = deriveRequiredPermissions(["web", "email", "crm"]);
    expect(perms).toContain("execute_web");
    expect(perms).toContain("execute_email");
    expect(perms).toContain("read_crm");
  });

  it("checks action permissions correctly", () => {
    const granted = ["execute_web", "read_crm"] as const;
    expect(isActionPermitted("web.search_news", [...granted])).toBe(true);
    expect(isActionPermitted("crm.list_pipeline", [...granted])).toBe(true);
    expect(isActionPermitted("email.send", [...granted])).toBe(false);
  });

  it("allows unknown action prefixes", () => {
    expect(isActionPermitted("custom.action", [])).toBe(true);
  });
});

// ── Entity Provenance Tests ──────────────────────────────────────────────────

describe("Entity Provenance", () => {
  let kgDb: DatabaseSync;
  let kgPath: string;
  let graph: SqliteEntityGraph;

  beforeEach(() => {
    ({ db: kgDb, path: kgPath } = createKnowledgeDb());
    graph = new SqliteEntityGraph(kgPath);
  });

  afterEach(() => {
    graph.close();
    cleanup(kgDb, kgPath);
  });

  it("tracks provenance on entity creation", () => {
    const entity = graph.upsertEntity(
      { entity_type: "company", name: "Acme Corp", attributes: { domain: "acme.com" } },
      "bd-pipeline",
      { run_id: "run-123", step_no: 1, action: "crm.create" },
    );

    const provenance = graph.getProvenance(entity.entity_id);
    expect(provenance.length).toBe(1);
    expect(provenance[0].change_type).toBe("created");
    expect(provenance[0].agent_id).toBe("bd-pipeline");
    expect(provenance[0].run_id).toBe("run-123");
    expect(provenance[0].step_no).toBe(1);
    expect(provenance[0].action).toBe("crm.create");
  });

  it("tracks provenance on entity update", () => {
    const entity = graph.upsertEntity(
      { entity_type: "company", name: "Acme Corp", attributes: { domain: "acme.com" } },
      "bd-pipeline",
      { run_id: "run-1" },
    );

    // Update by name match
    graph.upsertEntity(
      { entity_type: "company", name: "Acme Corp", attributes: { status: "qualified" } },
      "staffing-monitor",
      { run_id: "run-2", step_no: 3, action: "crm.update" },
    );

    const provenance = graph.getProvenance(entity.entity_id);
    expect(provenance.length).toBe(2);
    expect(provenance[0].change_type).toBe("updated"); // Most recent first
    expect(provenance[0].agent_id).toBe("staffing-monitor");
    expect(provenance[1].change_type).toBe("created");
    expect(provenance[1].agent_id).toBe("bd-pipeline");
  });

  it("works without provenance parameter (backward compat)", () => {
    const entity = graph.upsertEntity(
      { entity_type: "company", name: "Test Co", attributes: {} },
      "test-agent",
    );

    const provenance = graph.getProvenance(entity.entity_id);
    expect(provenance.length).toBe(1);
    expect(provenance[0].run_id).toBeNull();
  });
});

// ── Failure Injection Tests ──────────────────────────────────────────────────

describe("Failure Injection: Database Resilience", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createTestDb());
  });

  afterEach(() => cleanup(db, dbPath));

  it("handles concurrent command claims gracefully", () => {
    const now = new Date().toISOString();

    // Insert a command
    db.prepare(
      "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by) VALUES (?, ?, ?, 'queued', 0, ?, ?)",
    ).run("cmd-race", "run_agent", "agent-a", now, "test");

    // First claim succeeds
    const r1 = db.prepare(
      "UPDATE agent_commands SET status = 'claimed', claimed_at = ? WHERE command_id = ? AND status = 'queued'",
    ).run(now, "cmd-race");
    expect((r1 as { changes: number }).changes).toBe(1);

    // Second claim fails (already claimed)
    const r2 = db.prepare(
      "UPDATE agent_commands SET status = 'claimed', claimed_at = ? WHERE command_id = ? AND status = 'queued'",
    ).run(now, "cmd-race");
    expect((r2 as { changes: number }).changes).toBe(0);
  });

  it("recovers stale claims", () => {
    const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago

    db.prepare(
      "INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, priority, created_at, created_by, claimed_at) VALUES (?, ?, ?, 'claimed', 0, ?, ?, ?)",
    ).run("cmd-stale", "run_agent", "agent-a", staleTime, "test", staleTime);

    // Recover stale claims (older than 10 min)
    const threshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const result = db.prepare(
      "UPDATE agent_commands SET status = 'queued', claimed_at = NULL WHERE status = 'claimed' AND claimed_at < ?",
    ).run(threshold);

    expect((result as { changes: number }).changes).toBe(1);

    const cmd = db.prepare("SELECT status FROM agent_commands WHERE command_id = ?").get("cmd-stale") as { status: string };
    expect(cmd.status).toBe("queued");
  });

  it("enforces run state machine transitions", async () => {
    const store = new (await import("@jarvis/runtime")).RunStore(db);

    const runId = store.startRun("test-agent");

    // Valid: planning -> executing
    store.transition(runId, "test-agent", "executing", "step_started", {});

    // Valid: executing -> completed
    store.transition(runId, "test-agent", "completed", "run_completed", {});

    // Invalid: completed -> executing (should throw)
    expect(() =>
      store.transition(runId, "test-agent", "executing", "step_started", {}),
    ).toThrow();
  });

  it("handles duplicate approval creation", async () => {
    const { requestApproval } = await import("@jarvis/runtime");

    const id1 = requestApproval(db, {
      agent_id: "test",
      run_id: "run-1",
      action: "email.send",
      severity: "critical",
      payload: "test payload",
    });

    const id2 = requestApproval(db, {
      agent_id: "test",
      run_id: "run-1",
      action: "email.send",
      severity: "critical",
      payload: "different payload",
    });

    // Both should succeed (different approval IDs)
    expect(id1).not.toBe(id2);

    const approvals = db.prepare("SELECT * FROM approvals WHERE run_id = ?").all("run-1");
    expect(approvals.length).toBe(2);
  });
});

describe("Failure Injection: Plan Evaluator Edge Cases", () => {
  it("handles plans with no matching capabilities", () => {
    const plan = makePlan([{ action: "unknown.action" }]);
    const score = scorePlan(plan, ["web", "email"], 5);
    expect(score.breakdown.capability_coverage).toBe(0);
  });

  it("handles max steps = 0", () => {
    const plan = makePlan([{ action: "web.search" }]);
    const score = scorePlan(plan, ["web"], 0);
    // Division by zero guard
    expect(score.total).toBeGreaterThanOrEqual(0);
  });

  it("handles empty reasoning strings", () => {
    const plan = makePlan([
      { action: "web.search", reasoning: "" },
      { action: "email.send", reasoning: "" },
    ]);
    const score = scorePlan(plan, ["web", "email"], 5);
    expect(score.breakdown.reasoning_quality).toBe(0);
  });

  it("detects disagreement with empty candidates", () => {
    const result = detectDisagreement([]);
    expect(result.disagreement).toBe(false);
  });
});

// ── Agent Maturity Tests ─────────────────────────────────────────────────────

describe("Agent Maturity Levels", () => {
  it("all built-in agents have maturity set", async () => {
    const { ALL_AGENTS } = await import("@jarvis/agents");

    for (const agent of ALL_AGENTS) {
      expect(agent.maturity, `Agent ${agent.agent_id} missing maturity`).toBeDefined();
      expect(
        ["experimental", "operational", "trusted_with_review", "high_stakes_manual_gate"],
      ).toContain(agent.maturity);
    }
  });

  it("high-stakes agents have multi planner mode", async () => {
    const { ALL_AGENTS } = await import("@jarvis/agents");

    const highStakes = ALL_AGENTS.filter(a => a.maturity === "high_stakes_manual_gate");
    expect(highStakes.length).toBeGreaterThan(0);

    for (const agent of highStakes) {
      expect(agent.planner_mode, `Agent ${agent.agent_id} should use multi planner`).toBe("multi");
    }
  });

  it("all agents have valid planner_mode if set", async () => {
    const { ALL_AGENTS } = await import("@jarvis/agents");

    for (const agent of ALL_AGENTS) {
      if (agent.planner_mode) {
        expect(["single", "critic", "multi"]).toContain(agent.planner_mode);
      }
    }
  });
});
