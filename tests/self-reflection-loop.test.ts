import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { runMigrations, KNOWLEDGE_MIGRATIONS, RunStore, getApprovalMetrics } from "@jarvis/runtime";
import { SqliteKnowledgeStore } from "@jarvis/agent-framework";
import { calculateHealthScore, assembleReport } from "@jarvis/agents";

// ─── Test helpers ───────────────────────────────────────────────────────────

function createRuntimeDb(): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-reflect-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return { db, path: dbPath };
}

// ─── RunStore analytics ─────────────────────────────────────────────────────

describe("RunStore analytics", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createRuntimeDb());
    store = new RunStore(db);
  });

  afterEach(() => {
    try { db.close(); } catch {}
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  it("getAgentStats returns per-agent metrics", () => {
    // Insert runs directly for analytics testing (bypass state machine)
    const now = new Date().toISOString();
    db.prepare("INSERT INTO runs (run_id, agent_id, status, started_at, current_step) VALUES (?, ?, ?, ?, ?)").run("r1", "evidence-auditor", "completed", now, 5);
    db.prepare("INSERT INTO runs (run_id, agent_id, status, started_at, current_step, error) VALUES (?, ?, ?, ?, ?, ?)").run("r2", "evidence-auditor", "failed", now, 3, "timeout");

    const stats = store.getAgentStats(7);
    const ea = stats.find(s => s.agent_id === "evidence-auditor");
    expect(ea).toBeDefined();
    expect(ea!.total).toBe(2);
    expect(ea!.completed).toBe(1);
    expect(ea!.failed).toBe(1);
    expect(ea!.success_rate).toBe(0.5);
  });

  it("getFailureModes returns error summaries", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO runs (run_id, agent_id, status, started_at, error) VALUES (?, ?, ?, ?, ?)").run("r3", "orchestrator", "failed", now, "timeout after 30s");
    db.prepare("INSERT INTO runs (run_id, agent_id, status, started_at, error) VALUES (?, ?, ?, ?, ?)").run("r4", "orchestrator", "failed", now, "timeout after 30s");

    const modes = store.getFailureModes(7);
    expect(modes.length).toBeGreaterThanOrEqual(1);
    expect(modes[0].count).toBe(2);
  });

  it("getSystemStats returns overall summary", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO runs (run_id, agent_id, status, started_at) VALUES (?, ?, ?, ?)").run("r5", "proposal-engine", "completed", now);
    db.prepare("INSERT INTO runs (run_id, agent_id, status, started_at) VALUES (?, ?, ?, ?)").run("r6", "staffing-monitor", "completed", now);

    const stats = store.getSystemStats(7);
    expect(stats.total_runs).toBeGreaterThanOrEqual(2);
    expect(stats.active_agents).toBeGreaterThanOrEqual(2);
    expect(stats.success_rate).toBeGreaterThan(0);
  });
});

// ─── Approval analytics ─────────────────────────────────────────────────────

describe("Approval analytics", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createRuntimeDb());
  });

  afterEach(() => {
    try { db.close(); } catch {}
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  it("getApprovalMetrics aggregates approval data", () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO approvals (approval_id, run_id, agent_id, action, severity, status, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("a1", "r1", "contract-reviewer", "document.generate_report", "warning", "pending", now);
    db.prepare(
      "INSERT INTO approvals (approval_id, run_id, agent_id, action, severity, status, requested_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("a2", "r2", "proposal-engine", "email.send", "critical", "approved", now, now);

    const metrics = getApprovalMetrics(db, 7);
    expect(metrics.total).toBe(2);
    expect(metrics.pending).toBe(1);
    expect(metrics.approved).toBe(1);
    expect(metrics.by_action.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Knowledge store analytics ──────────────────────────────────────────────

describe("SqliteKnowledgeStore analytics", () => {
  let store: SqliteKnowledgeStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(os.tmpdir(), `jarvis-kb-reflect-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    // Run knowledge migrations to create tables before opening the store
    const setupDb = new DatabaseSync(dbPath);
    setupDb.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    runMigrations(setupDb, KNOWLEDGE_MIGRATIONS);
    setupDb.close();
    store = new SqliteKnowledgeStore(dbPath);
  });

  afterEach(() => {
    store.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  it("getThinCollections finds collections with few documents", () => {
    store.addDocument({ collection: "proposals" as any, title: "Only one", content: "Single doc", tags: [] });
    const thin = store.getThinCollections(3);
    expect(thin.some(c => c.collection === "proposals" && c.count < 3)).toBe(true);
  });

  it("getCollectionFreshness returns per-collection dates", () => {
    store.addDocument({ collection: "contracts" as any, title: "Test", content: "Content", tags: [] });
    const freshness = store.getCollectionFreshness();
    expect(freshness.some(c => c.collection === "contracts")).toBe(true);
    expect(freshness[0].newest).toBeTruthy();
  });

  it("getStaleDocuments returns empty for fresh documents", () => {
    store.addDocument({ collection: "lessons" as any, title: "Fresh", content: "Content", tags: [] });
    const stale = store.getStaleDocuments(30);
    expect(stale).toHaveLength(0);
  });
});

// ─── Health score calculation ───────────────────────────────────────────────

describe("calculateHealthScore", () => {
  it("perfect system scores 100", () => {
    const score = calculateHealthScore(
      { success_rate: 1.0, active_agents: 8 },
      { rejection_rate: 0 },
      { thin_collections: [] },
      8,
    );
    expect(score).toBe(100);
  });

  it("50% success rate with full coverage still scores 80", () => {
    const score = calculateHealthScore(
      { success_rate: 0.5, active_agents: 8 },
      { rejection_rate: 0 },
      { thin_collections: [] },
      8,
    );
    // 20 (run: 0.5*40) + 20 (approval) + 20 (knowledge) + 20 (agent coverage) = 80
    expect(score).toBe(80);
  });

  it("zero runs and zero agents scores low", () => {
    const score = calculateHealthScore(
      { success_rate: 0, active_agents: 0 },
      { rejection_rate: 0 },
      { thin_collections: [] },
      8,
    );
    // 0 (run) + 20 (approval) + 20 (knowledge) + 0 (agents) = 40
    expect(score).toBe(40);
  });

  it("thin collections reduce knowledge score", () => {
    const scoreClean = calculateHealthScore(
      { success_rate: 1.0, active_agents: 8 },
      { rejection_rate: 0 },
      { thin_collections: [] },
      8,
    );
    const scoreThin = calculateHealthScore(
      { success_rate: 1.0, active_agents: 8 },
      { rejection_rate: 0 },
      { thin_collections: [1, 2, 3] as any[] },
      8,
    );
    expect(scoreThin).toBeLessThan(scoreClean);
  });

  it("high rejection rate reduces approval score", () => {
    const score = calculateHealthScore(
      { success_rate: 1.0, active_agents: 8 },
      { rejection_rate: 0.5 },
      { thin_collections: [] },
      8,
    );
    // 40 (run) + 10 (approval: (1-0.5)*20) + 20 (knowledge) + 20 (agents) = 90
    expect(score).toBe(90);
  });
});

// ─── Report assembly ────────────────────────────────────────────────────────

describe("assembleReport", () => {
  it("produces a valid ReviewReport structure", () => {
    const report = assembleReport({
      agentMetrics: [{ agent_id: "evidence-auditor", total: 10, completed: 8, failed: 2, success_rate: 0.8, avg_steps: 5 }],
      systemMetrics: { total_runs: 10, completed: 8, failed: 2, success_rate: 0.8, active_agents: 3 },
      approvalMetrics: { total: 5, approved: 4, rejected: 1, rejection_rate: 0.2, avg_latency_ms: 5000, by_action: [] },
      knowledgeMetrics: {
        total_documents: 50,
        collections: { lessons: 20, proposals: 15, contracts: 15 },
        stale_count: 3,
        thin_collections: [],
        freshness: [{ collection: "lessons", count: 20, newest: new Date().toISOString() }],
      },
      failureModes: [{ error: "timeout", count: 2, agent_id: "orchestrator" }],
      healthScore: 75,
    });

    expect(report.report_id).toBeTruthy();
    expect(report.health_score).toBe(75);
    expect(report.proposals).toHaveLength(0);
    expect(report.agent_metrics).toHaveLength(1);
    expect(report.system_metrics.total_runs).toBe(10);
    expect(report.period_start).toBeTruthy();
  });

  it("links to previous report when provided", () => {
    const report = assembleReport({
      agentMetrics: [],
      systemMetrics: { total_runs: 0, completed: 0, failed: 0, success_rate: 0, active_agents: 0 },
      approvalMetrics: { total: 0, approved: 0, rejected: 0, rejection_rate: 0, avg_latency_ms: null, by_action: [] },
      knowledgeMetrics: { total_documents: 0, collections: {}, stale_count: 0, thin_collections: [], freshness: [] },
      failureModes: [],
      healthScore: 50,
      previousReportId: "prev-report-123",
    });
    expect(report.previous_report_id).toBe("prev-report-123");
  });
});
