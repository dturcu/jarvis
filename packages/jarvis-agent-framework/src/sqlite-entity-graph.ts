import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { EntityType, GraphEntity, EntityRelation, EntityGraphStats } from "./entity-graph.js";

/**
 * SQLite-backed entity graph.
 *
 * Persistent version of {@link EntityGraph} that reads/writes the `entities`
 * and `relations` tables in `~/.jarvis/knowledge.db`.  The in-memory version
 * remains available for unit testing.
 */
export class SqliteEntityGraph {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    // entity_provenance table is created by init-jarvis.ts during bootstrap.
    // No CREATE TABLE IF NOT EXISTS here — schema lives in the init script.
  }

  close(): void {
    try { this.db.close(); } catch { /* best-effort */ }
  }

  // ─── Entity operations ──────────────────────────────────────────────────────

  /**
   * Provenance context for tracking which agent run caused a change.
   */
  upsertEntity(
    params: Omit<GraphEntity, "entity_id" | "seen_by" | "created_at" | "updated_at">,
    agentId: string,
    provenance?: { run_id: string; step_no?: number; action?: string },
  ): GraphEntity {
    const now = new Date().toISOString();

    // Try canonical key first
    if (params.canonical_key) {
      const existing = this.db
        .prepare("SELECT * FROM entities WHERE canonical_key = ?")
        .get(params.canonical_key) as Record<string, unknown> | undefined;

      if (existing) {
        const oldAttrs = this.parseJson(existing.attributes as string);
        const oldSeenBy = this.parseJsonArray(existing.seen_by as string);
        const merged = { ...oldAttrs, ...params.attributes };
        const seenBy = oldSeenBy.includes(agentId) ? oldSeenBy : [...oldSeenBy, agentId];

        this.db.prepare(`
          UPDATE entities SET name = ?, attributes = ?, seen_by = ?, updated_at = ?
          WHERE entity_id = ?
        `).run(
          params.name, JSON.stringify(merged), JSON.stringify(seenBy),
          now, existing.entity_id as string,
        );

        this.writeProvenance(existing.entity_id as string, "updated", agentId, provenance);

        return this.rowToEntity({ ...existing, name: params.name, attributes: JSON.stringify(merged), seen_by: JSON.stringify(seenBy), updated_at: now });
      }
    }

    // Fall back to name + type match
    const byName = this.db
      .prepare("SELECT * FROM entities WHERE entity_type = ? AND LOWER(name) = LOWER(?)")
      .get(params.entity_type, params.name) as Record<string, unknown> | undefined;

    if (byName) {
      const oldAttrs = this.parseJson(byName.attributes as string);
      const oldSeenBy = this.parseJsonArray(byName.seen_by as string);
      const merged = { ...oldAttrs, ...params.attributes };
      const seenBy = oldSeenBy.includes(agentId) ? oldSeenBy : [...oldSeenBy, agentId];
      const canonicalKey = params.canonical_key ?? (byName.canonical_key as string | null);

      this.db.prepare(`
        UPDATE entities SET canonical_key = ?, attributes = ?, seen_by = ?, updated_at = ?
        WHERE entity_id = ?
      `).run(
        canonicalKey, JSON.stringify(merged), JSON.stringify(seenBy),
        now, byName.entity_id as string,
      );

      this.writeProvenance(byName.entity_id as string, "updated", agentId, provenance);

      return this.rowToEntity({ ...byName, canonical_key: canonicalKey, attributes: JSON.stringify(merged), seen_by: JSON.stringify(seenBy), updated_at: now });
    }

    // New entity
    const entityId = randomUUID();
    const seenBy = [agentId];

    this.db.prepare(`
      INSERT INTO entities (entity_id, entity_type, name, canonical_key, attributes, seen_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId, params.entity_type, params.name, params.canonical_key ?? null,
      JSON.stringify(params.attributes), JSON.stringify(seenBy), now, now,
    );

    this.writeProvenance(entityId, "created", agentId, provenance);

    return {
      entity_id: entityId,
      entity_type: params.entity_type,
      name: params.name,
      canonical_key: params.canonical_key,
      attributes: params.attributes,
      seen_by: seenBy,
      created_at: now,
      updated_at: now,
    };
  }

  getEntity(entityId: string): GraphEntity | undefined {
    const row = this.db
      .prepare("SELECT * FROM entities WHERE entity_id = ?")
      .get(entityId) as Record<string, unknown> | undefined;
    return row ? this.rowToEntity(row) : undefined;
  }

  findByCanonicalKey(key: string): GraphEntity | undefined {
    const row = this.db
      .prepare("SELECT * FROM entities WHERE canonical_key = ?")
      .get(key) as Record<string, unknown> | undefined;
    return row ? this.rowToEntity(row) : undefined;
  }

  findByName(name: string, type?: EntityType): GraphEntity[] {
    const needle = `%${name.toLowerCase()}%`;
    const rows = type
      ? this.db.prepare("SELECT * FROM entities WHERE LOWER(name) LIKE ? AND entity_type = ?").all(needle, type) as Array<Record<string, unknown>>
      : this.db.prepare("SELECT * FROM entities WHERE LOWER(name) LIKE ?").all(needle) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToEntity(r));
  }

  listEntities(type?: EntityType): GraphEntity[] {
    const rows = type
      ? this.db.prepare("SELECT * FROM entities WHERE entity_type = ? ORDER BY created_at ASC").all(type) as Array<Record<string, unknown>>
      : this.db.prepare("SELECT * FROM entities ORDER BY created_at ASC").all() as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToEntity(r));
  }

  entitiesSeenBy(agentId: string): GraphEntity[] {
    // seen_by is stored as JSON array, use LIKE for filtering
    const rows = this.db
      .prepare("SELECT * FROM entities WHERE seen_by LIKE ?")
      .all(`%"${agentId}"%`) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToEntity(r));
  }

  // ─── Relation operations ────────────────────────────────────────────────────

  addRelation(
    fromId: string,
    toId: string,
    kind: string,
    attributes: Record<string, unknown> = {},
  ): EntityRelation {
    // Deduplicate by from+to+kind
    const existing = this.db
      .prepare("SELECT * FROM relations WHERE from_entity_id = ? AND to_entity_id = ? AND kind = ?")
      .get(fromId, toId, kind) as Record<string, unknown> | undefined;

    if (existing) return this.rowToRelation(existing);

    const relationId = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO relations (relation_id, from_entity_id, to_entity_id, kind, attributes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(relationId, fromId, toId, kind, JSON.stringify(attributes), now);

    return { relation_id: relationId, from_entity_id: fromId, to_entity_id: toId, kind, attributes, created_at: now };
  }

  getRelations(entityId: string, direction: "from" | "to" | "both" = "both"): EntityRelation[] {
    let rows: Array<Record<string, unknown>>;
    if (direction === "from") {
      rows = this.db.prepare("SELECT * FROM relations WHERE from_entity_id = ?").all(entityId) as Array<Record<string, unknown>>;
    } else if (direction === "to") {
      rows = this.db.prepare("SELECT * FROM relations WHERE to_entity_id = ?").all(entityId) as Array<Record<string, unknown>>;
    } else {
      rows = this.db.prepare("SELECT * FROM relations WHERE from_entity_id = ? OR to_entity_id = ?").all(entityId, entityId) as Array<Record<string, unknown>>;
    }
    return rows.map(r => this.rowToRelation(r));
  }

  removeRelation(relationId: string): boolean {
    const result = this.db.prepare("DELETE FROM relations WHERE relation_id = ?").run(relationId);
    return result.changes > 0;
  }

  neighborhood(entityId: string): { center: GraphEntity | undefined; neighbors: GraphEntity[]; relations: EntityRelation[] } {
    const center = this.getEntity(entityId);
    const rels = this.getRelations(entityId, "both");
    const neighborIds = new Set(rels.flatMap(r => [r.from_entity_id, r.to_entity_id]));
    neighborIds.delete(entityId);
    const neighbors = [...neighborIds]
      .map(id => this.getEntity(id))
      .filter((e): e is GraphEntity => e != null);
    return { center, neighbors, relations: rels };
  }

  getStats(): EntityGraphStats {
    const entityCount = (this.db.prepare("SELECT COUNT(*) AS cnt FROM entities").get() as { cnt: number }).cnt;
    const relationCount = (this.db.prepare("SELECT COUNT(*) AS cnt FROM relations").get() as { cnt: number }).cnt;
    const typeRows = this.db.prepare("SELECT entity_type, COUNT(*) AS cnt FROM entities GROUP BY entity_type").all() as Array<{ entity_type: string; cnt: number }>;
    const by_type: Record<string, number> = {};
    for (const r of typeRows) by_type[r.entity_type] = r.cnt;
    return { entity_count: entityCount, relation_count: relationCount, by_type };
  }

  // ─── Provenance ─────────────────────────────────────────────────────────────

  /**
   * Get provenance history for an entity (who changed it, when, which run).
   */
  getProvenance(entityId: string, limit = 20): Array<{
    change_type: string;
    agent_id: string;
    run_id: string | null;
    step_no: number | null;
    action: string | null;
    changed_at: string;
  }> {
    try {
      return this.db.prepare(`
        SELECT change_type, agent_id, run_id, step_no, action, changed_at
        FROM entity_provenance
        WHERE entity_id = ?
        ORDER BY changed_at DESC
        LIMIT ?
      `).all(entityId, limit) as Array<{
        change_type: string; agent_id: string; run_id: string | null;
        step_no: number | null; action: string | null; changed_at: string;
      }>;
    } catch {
      // Table may not exist yet (pre-migration)
      return [];
    }
  }

  private writeProvenance(
    entityId: string,
    changeType: "created" | "updated" | "deleted",
    agentId: string,
    provenance?: { run_id: string; step_no?: number; action?: string },
  ): void {
    try {
      this.db.prepare(`
        INSERT INTO entity_provenance (provenance_id, entity_id, change_type, agent_id, run_id, step_no, action, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), entityId, changeType, agentId,
        provenance?.run_id ?? null, provenance?.step_no ?? null,
        provenance?.action ?? null, new Date().toISOString(),
      );
    } catch {
      // Table may not exist yet — non-fatal
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private parseJson(s: string | null): Record<string, unknown> {
    if (!s) return {};
    try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
  }

  private parseJsonArray(s: string | null): string[] {
    if (!s) return [];
    try { return JSON.parse(s) as string[]; } catch { return []; }
  }

  private rowToEntity(row: Record<string, unknown>): GraphEntity {
    return {
      entity_id: row.entity_id as string,
      entity_type: row.entity_type as EntityType,
      name: row.name as string,
      canonical_key: (row.canonical_key as string) ?? undefined,
      attributes: this.parseJson(row.attributes as string),
      seen_by: this.parseJsonArray(row.seen_by as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private rowToRelation(row: Record<string, unknown>): EntityRelation {
    return {
      relation_id: row.relation_id as string,
      from_entity_id: row.from_entity_id as string,
      to_entity_id: row.to_entity_id as string,
      kind: row.kind as string,
      attributes: this.parseJson(row.attributes as string),
      created_at: row.created_at as string,
    };
  }
}
