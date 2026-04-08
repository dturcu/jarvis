import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityType = "contact" | "company" | "document" | "project" | "engagement" | "other";

export type GraphEntity = {
  entity_id: string;
  entity_type: EntityType;
  name: string;
  /** Canonical identifier for deduplication (email, company domain, etc.) */
  canonical_key?: string;
  attributes: Record<string, unknown>;
  /** Which agents have referenced this entity */
  seen_by: string[];
  created_at: string;
  updated_at: string;
};

export type EntityRelation = {
  relation_id: string;
  from_entity_id: string;
  to_entity_id: string;
  /** "works_at" | "reports_to" | "related_to" | "authored" | "referenced_in" */
  kind: string;
  attributes: Record<string, unknown>;
  created_at: string;
};

export type EntityGraphStats = {
  entity_count: number;
  relation_count: number;
  by_type: Record<string, number>;
};

// ─── EntityGraph ─────────────────────────────────────────────────────────────

/**
 * Cross-agent entity graph.
 * Links contacts, companies, documents, and projects across all agents.
 * When orchestrator enriches a contact and proposal-engine references the same
 * company, the graph lets the system recognise they share context.
 */
export class EntityGraph {
  private entities = new Map<string, GraphEntity>();
  /** Secondary index: canonical_key → entity_id */
  private canonicalIndex = new Map<string, string>();
  private relations = new Map<string, EntityRelation>();

  // ─── Entity operations ────────────────────────────────────────────────────

  /**
   * Upsert by canonical_key (if provided) or by name + type.
   * Updates attributes and adds agentId to seen_by.
   */
  upsertEntity(
    params: Omit<GraphEntity, "entity_id" | "seen_by" | "created_at" | "updated_at">,
    agentId: string
  ): GraphEntity {
    const now = new Date().toISOString();

    // Try canonical key first
    if (params.canonical_key) {
      const existingId = this.canonicalIndex.get(params.canonical_key);
      if (existingId) {
        const existing = this.entities.get(existingId)!;
        const updated: GraphEntity = {
          ...existing,
          attributes: { ...existing.attributes, ...params.attributes },
          seen_by: existing.seen_by.includes(agentId)
            ? existing.seen_by
            : [...existing.seen_by, agentId],
          updated_at: now,
        };
        this.entities.set(existingId, updated);
        return updated;
      }
    }

    // Fall back to name + type match
    const byName = [...this.entities.values()].find(
      e => e.entity_type === params.entity_type && e.name.toLowerCase() === params.name.toLowerCase()
    );
    if (byName) {
      const updated: GraphEntity = {
        ...byName,
        canonical_key: params.canonical_key ?? byName.canonical_key,
        attributes: { ...byName.attributes, ...params.attributes },
        seen_by: byName.seen_by.includes(agentId) ? byName.seen_by : [...byName.seen_by, agentId],
        updated_at: now,
      };
      this.entities.set(byName.entity_id, updated);
      if (params.canonical_key) this.canonicalIndex.set(params.canonical_key, byName.entity_id);
      return updated;
    }

    // New entity
    const entity: GraphEntity = {
      ...params,
      entity_id: randomUUID(),
      seen_by: [agentId],
      created_at: now,
      updated_at: now,
    };
    this.entities.set(entity.entity_id, entity);
    if (entity.canonical_key) this.canonicalIndex.set(entity.canonical_key, entity.entity_id);
    return entity;
  }

  getEntity(entityId: string): GraphEntity | undefined {
    return this.entities.get(entityId);
  }

  findByCanonicalKey(key: string): GraphEntity | undefined {
    const id = this.canonicalIndex.get(key);
    return id ? this.entities.get(id) : undefined;
  }

  findByName(name: string, type?: EntityType): GraphEntity[] {
    const needle = name.toLowerCase();
    return [...this.entities.values()].filter(
      e =>
        e.name.toLowerCase().includes(needle) &&
        (type == null || e.entity_type === type)
    );
  }

  listEntities(type?: EntityType): GraphEntity[] {
    const all = [...this.entities.values()];
    return type ? all.filter(e => e.entity_type === type) : all;
  }

  /** Returns all entities seen by a given agent */
  entitiesSeenBy(agentId: string): GraphEntity[] {
    return [...this.entities.values()].filter(e => e.seen_by.includes(agentId));
  }

  // ─── Relation operations ──────────────────────────────────────────────────

  addRelation(
    fromId: string,
    toId: string,
    kind: string,
    attributes: Record<string, unknown> = {}
  ): EntityRelation {
    // Deduplicate by from+to+kind
    const existing = [...this.relations.values()].find(
      r => r.from_entity_id === fromId && r.to_entity_id === toId && r.kind === kind
    );
    if (existing) return existing;

    const relation: EntityRelation = {
      relation_id: randomUUID(),
      from_entity_id: fromId,
      to_entity_id: toId,
      kind,
      attributes,
      created_at: new Date().toISOString(),
    };
    this.relations.set(relation.relation_id, relation);
    return relation;
  }

  getRelations(entityId: string, direction: "from" | "to" | "both" = "both"): EntityRelation[] {
    return [...this.relations.values()].filter(r => {
      if (direction === "from") return r.from_entity_id === entityId;
      if (direction === "to") return r.to_entity_id === entityId;
      return r.from_entity_id === entityId || r.to_entity_id === entityId;
    });
  }

  removeRelation(relationId: string): boolean {
    return this.relations.delete(relationId);
  }

  // ─── Graph traversal ──────────────────────────────────────────────────────

  /**
   * Return the immediate neighbourhood of an entity:
   * the entity itself + all directly connected entities + the relations between them.
   */
  neighborhood(entityId: string): {
    center: GraphEntity | undefined;
    neighbors: GraphEntity[];
    relations: EntityRelation[];
  } {
    const center = this.entities.get(entityId);
    const rels = this.getRelations(entityId, "both");
    const neighborIds = new Set(rels.flatMap(r => [r.from_entity_id, r.to_entity_id]));
    neighborIds.delete(entityId);
    const neighbors = [...neighborIds]
      .map(id => this.entities.get(id))
      .filter((e): e is GraphEntity => e != null);
    return { center, neighbors, relations: rels };
  }

  getStats(): EntityGraphStats {
    const by_type: Record<string, number> = {};
    for (const e of this.entities.values()) {
      by_type[e.entity_type] = (by_type[e.entity_type] ?? 0) + 1;
    }
    return { entity_count: this.entities.size, relation_count: this.relations.size, by_type };
  }
}
