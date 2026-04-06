import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { MemoryEntry } from "./memory.js";

/**
 * SQLite-backed agent memory store.
 * Persists short-term and long-term memory entries across daemon restarts.
 * Uses a `memory` table in the knowledge database.
 */
export class SqliteMemoryStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        entry_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('short_term', 'long_term')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        trigger_kind TEXT NOT NULL,
        trigger_data TEXT,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step INTEGER DEFAULT 0,
        total_steps INTEGER DEFAULT 0,
        plan_json TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory(agent_id, kind)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_id)");
  }

  close(): void {
    try { this.db.close(); } catch { /* best-effort */ }
  }

  // ─── Memory ─────────────────────────────────────────────────────────────

  addShortTerm(agentId: string, runId: string, content: string): MemoryEntry {
    const entry: MemoryEntry = {
      entry_id: randomUUID(), agent_id: agentId, run_id: runId,
      kind: "short_term", content, created_at: new Date().toISOString(),
    };
    this.db.prepare("INSERT INTO memory (entry_id, agent_id, run_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(entry.entry_id, entry.agent_id, entry.run_id, entry.kind, entry.content, entry.created_at);
    return entry;
  }

  addLongTerm(agentId: string, runId: string, content: string): MemoryEntry {
    const entry: MemoryEntry = {
      entry_id: randomUUID(), agent_id: agentId, run_id: runId,
      kind: "long_term", content, created_at: new Date().toISOString(),
    };
    this.db.prepare("INSERT INTO memory (entry_id, agent_id, run_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(entry.entry_id, entry.agent_id, entry.run_id, entry.kind, entry.content, entry.created_at);

    // Cap at 500 long-term entries per agent
    const count = (this.db.prepare("SELECT COUNT(*) AS cnt FROM memory WHERE agent_id = ? AND kind = 'long_term'").get(agentId) as { cnt: number }).cnt;
    if (count > 500) {
      this.db.prepare("DELETE FROM memory WHERE entry_id IN (SELECT entry_id FROM memory WHERE agent_id = ? AND kind = 'long_term' ORDER BY created_at ASC LIMIT ?)").run(agentId, count - 500);
    }
    return entry;
  }

  clearShortTerm(runId: string): void {
    this.db.prepare("DELETE FROM memory WHERE run_id = ? AND kind = 'short_term'").run(runId);
  }

  getContext(agentId: string, runId: string): { short_term: MemoryEntry[]; long_term: MemoryEntry[] } {
    const short = this.db.prepare("SELECT * FROM memory WHERE agent_id = ? AND run_id = ? AND kind = 'short_term' ORDER BY created_at ASC").all(agentId, runId) as MemoryEntry[];
    const long = this.db.prepare("SELECT * FROM memory WHERE agent_id = ? AND kind = 'long_term' ORDER BY created_at DESC LIMIT 50").all(agentId) as MemoryEntry[];
    return { short_term: short, long_term: long };
  }

  // ─── Run History ────────────────────────────────────────────────────────

  saveRun(run: {
    run_id: string; agent_id: string; trigger_kind: string; trigger_data?: string;
    goal: string; status: string; current_step: number; total_steps: number;
    plan_json?: string; started_at: string; updated_at: string;
    completed_at?: string; error?: string;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_runs (run_id, agent_id, trigger_kind, trigger_data, goal, status, current_step, total_steps, plan_json, started_at, updated_at, completed_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.run_id, run.agent_id, run.trigger_kind, run.trigger_data ?? null,
      run.goal, run.status, run.current_step, run.total_steps,
      run.plan_json ?? null, run.started_at, run.updated_at,
      run.completed_at ?? null, run.error ?? null,
    );
  }

  getRun(runId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM agent_runs WHERE run_id = ?").get(runId) as Record<string, unknown> | undefined;
  }

  getLastRun(agentId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1").get(agentId) as Record<string, unknown> | undefined;
  }

  getRunHistory(agentId?: string, limit = 50): Array<Record<string, unknown>> {
    if (agentId) {
      return this.db.prepare("SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?").all(agentId, limit) as Array<Record<string, unknown>>;
    }
    return this.db.prepare("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  }

  getRunCount(agentId?: string): number {
    if (agentId) {
      return (this.db.prepare("SELECT COUNT(*) AS cnt FROM agent_runs WHERE agent_id = ?").get(agentId) as { cnt: number }).cnt;
    }
    return (this.db.prepare("SELECT COUNT(*) AS cnt FROM agent_runs").get() as { cnt: number }).cnt;
  }
}
