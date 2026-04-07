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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        decision_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        step INTEGER NOT NULL,
        action TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decisions(agent_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_decisions_run ON decisions(agent_id, run_id)");
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

  /**
   * Link a decision to an entity it affects.
   * Enables knowledge graph traversal: entity → decisions → runs.
   */
  linkDecisionToEntity(decisionId: string, entityId: string, linkType: string): void {
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO decision_entity_links (link_id, decision_id, entity_id, link_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, decisionId, entityId, linkType, now);
    } catch {
      // Table may not exist on older DBs — best effort
    }
  }

  /**
   * Get all entities linked to decisions for a given entity.
   */
  getDecisionsByEntity(entityId: string): DecisionLog[] {
    try {
      const rows = this.db.prepare(`
        SELECT d.* FROM decisions d
        JOIN decision_entity_links l ON d.decision_id = l.decision_id
        WHERE l.entity_id = ?
        ORDER BY d.created_at DESC
      `).all(entityId) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToDecision(r));
    } catch {
      return [];
    }
  }

  /**
   * Get all entity IDs linked to a decision.
   */
  getEntitiesForDecision(decisionId: string): Array<{ entity_id: string; link_type: string }> {
    try {
      return this.db.prepare(
        "SELECT entity_id, link_type FROM decision_entity_links WHERE decision_id = ?",
      ).all(decisionId) as Array<{ entity_id: string; link_type: string }>;
    } catch {
      return [];
    }
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
