import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { DecisionLog } from "./memory.js";

/**
 * SQLite-backed decision log.
 *
 * Persists agent decisions to the `decisions` table in `~/.jarvis/knowledge.db`.
 * The in-memory `AgentMemoryStore` retains decisions for the current run; this
 * class provides durable cross-session storage for audit trails.
 */
export class SqliteDecisionLog {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  close(): void {
    try { this.db.close(); } catch { /* best-effort */ }
  }

  logDecision(
    params: Omit<DecisionLog, "decision_id" | "created_at">,
  ): DecisionLog {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO decisions (decision_id, agent_id, run_id, step, action, reasoning, outcome, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, params.agent_id, params.run_id, params.step,
      params.action, params.reasoning, params.outcome, now,
    );

    return { ...params, decision_id: id, created_at: now };
  }

  getDecisions(agentId: string, runId?: string): DecisionLog[] {
    const rows = runId
      ? this.db.prepare("SELECT * FROM decisions WHERE agent_id = ? AND run_id = ? ORDER BY step ASC").all(agentId, runId) as Array<Record<string, unknown>>
      : this.db.prepare("SELECT * FROM decisions WHERE agent_id = ? ORDER BY created_at DESC").all(agentId) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToDecision(r));
  }

  getRecentDecisions(limit = 50, agentId?: string): DecisionLog[] {
    const rows = agentId
      ? this.db.prepare("SELECT * FROM decisions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?").all(agentId, limit) as Array<Record<string, unknown>>
      : this.db.prepare("SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToDecision(r));
  }

  getDecisionCount(agentId?: string): number {
    if (agentId) {
      return (this.db.prepare("SELECT COUNT(*) AS cnt FROM decisions WHERE agent_id = ?").get(agentId) as { cnt: number }).cnt;
    }
    return (this.db.prepare("SELECT COUNT(*) AS cnt FROM decisions").get() as { cnt: number }).cnt;
  }

  private rowToDecision(row: Record<string, unknown>): DecisionLog {
    return {
      decision_id: row.decision_id as string,
      agent_id: row.agent_id as string,
      run_id: row.run_id as string,
      step: row.step as number,
      action: row.action as string,
      reasoning: row.reasoning as string,
      outcome: row.outcome as string,
      created_at: row.created_at as string,
    };
  }
}
