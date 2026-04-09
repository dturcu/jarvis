import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AgentMemoryStore, type MemoryEntry } from "./memory.js";

/**
 * SQLite-backed agent memory store.
 * Persists short-term and long-term memory entries across daemon restarts.
 * Uses a `memory` table in the knowledge database.
 */
export class SqliteMemoryStore extends AgentMemoryStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    super();
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
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory(agent_id, kind)");
  }

  close(): void {
    try { this.db.close(); } catch { /* best-effort */ }
  }

  // ─── Memory ─────────────────────────────────────────────────────────────

  override addShortTerm(agentId: string, runId: string, content: string): MemoryEntry {
    const entry: MemoryEntry = {
      entry_id: randomUUID(), agent_id: agentId, run_id: runId,
      kind: "short_term", content, created_at: new Date().toISOString(),
    };
    this.db.prepare("INSERT INTO memory (entry_id, agent_id, run_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(entry.entry_id, entry.agent_id, entry.run_id, entry.kind, entry.content, entry.created_at);
    return entry;
  }

  override addLongTerm(agentId: string, runId: string, content: string): MemoryEntry {
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

  override clearShortTerm(runId: string): void {
    this.db.prepare("DELETE FROM memory WHERE run_id = ? AND kind = 'short_term'").run(runId);
  }

  override getContext(agentId: string, runId: string): { short_term: MemoryEntry[]; long_term: MemoryEntry[] } {
    const short = this.db.prepare("SELECT * FROM memory WHERE agent_id = ? AND run_id = ? AND kind = 'short_term' ORDER BY created_at ASC").all(agentId, runId) as MemoryEntry[];
    const long = this.db.prepare("SELECT * FROM memory WHERE agent_id = ? AND kind = 'long_term' ORDER BY created_at DESC LIMIT 50").all(agentId) as MemoryEntry[];
    return { short_term: short, long_term: long };
  }

}
