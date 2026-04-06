import { randomUUID } from "node:crypto";

export type MemoryEntry = {
  entry_id: string;
  agent_id: string;
  run_id: string;
  kind: "short_term" | "long_term";
  content: string;
  created_at: string;
};

export type EntityRecord = {
  entity_id: string;
  agent_id: string;
  entity_type: "contact" | "company" | "document" | "project" | "other";
  name: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DecisionLog = {
  decision_id: string;
  agent_id: string;
  run_id: string;
  step: number;
  action: string;
  reasoning: string;
  outcome: string;
  created_at: string;
};

export class AgentMemoryStore {
  private shortTerm = new Map<string, MemoryEntry>();
  private longTerm = new Map<string, MemoryEntry>();
  private entities = new Map<string, EntityRecord>();
  private decisions: DecisionLog[] = [];

  addShortTerm(agentId: string, runId: string, content: string): MemoryEntry {
    const entry: MemoryEntry = {
      entry_id: randomUUID(),
      agent_id: agentId,
      run_id: runId,
      kind: "short_term",
      content,
      created_at: new Date().toISOString(),
    };
    this.shortTerm.set(entry.entry_id, entry);
    return entry;
  }

  addLongTerm(agentId: string, runId: string, content: string): MemoryEntry {
    const entry: MemoryEntry = {
      entry_id: randomUUID(),
      agent_id: agentId,
      run_id: runId,
      kind: "long_term",
      content,
      created_at: new Date().toISOString(),
    };
    this.longTerm.set(entry.entry_id, entry);
    // Cap at 500 entries per agent
    const agentEntries = [...this.longTerm.values()].filter(e => e.agent_id === agentId);
    if (agentEntries.length > 500) {
      const oldest = agentEntries.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (oldest) {
        this.longTerm.delete(oldest.entry_id);
      }
    }
    return entry;
  }

  clearShortTerm(runId: string): void {
    for (const [id, entry] of this.shortTerm) {
      if (entry.run_id === runId) this.shortTerm.delete(id);
    }
  }

  getContext(agentId: string, runId: string): { short_term: MemoryEntry[]; long_term: MemoryEntry[] } {
    return {
      short_term: [...this.shortTerm.values()].filter(e => e.agent_id === agentId && e.run_id === runId),
      long_term: [...this.longTerm.values()].filter(e => e.agent_id === agentId),
    };
  }

  upsertEntity(params: Omit<EntityRecord, "entity_id" | "created_at" | "updated_at">): EntityRecord {
    const existing = [...this.entities.values()].find(
      e => e.agent_id === params.agent_id && e.name === params.name && e.entity_type === params.entity_type
    );
    const now = new Date().toISOString();
    if (existing) {
      const updated = { ...existing, ...params, updated_at: now };
      this.entities.set(existing.entity_id, updated);
      return updated;
    }
    const record: EntityRecord = { ...params, entity_id: randomUUID(), created_at: now, updated_at: now };
    this.entities.set(record.entity_id, record);
    return record;
  }

  getEntities(agentId: string, type?: EntityRecord["entity_type"]): EntityRecord[] {
    return [...this.entities.values()].filter(
      e => e.agent_id === agentId && (type == null || e.entity_type === type)
    );
  }

  logDecision(params: Omit<DecisionLog, "decision_id" | "created_at">): DecisionLog {
    const log: DecisionLog = { ...params, decision_id: randomUUID(), created_at: new Date().toISOString() };
    this.decisions.push(log);
    return log;
  }

  getDecisions(agentId: string, runId?: string): DecisionLog[] {
    return this.decisions.filter(d => d.agent_id === agentId && (runId == null || d.run_id === runId));
  }

  getStats(): { short_term_count: number; long_term_count: number; entity_count: number; decision_count: number } {
    return {
      short_term_count: this.shortTerm.size,
      long_term_count: this.longTerm.size,
      entity_count: this.entities.size,
      decision_count: this.decisions.length,
    };
  }
}
