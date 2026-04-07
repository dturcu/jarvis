# Y2-Q3 Knowledge Loop — Release Notes

## Summary

The knowledge plane now supports decision-to-entity linking and canonical alias tracking for deduplication auditing. Operators can traverse from entities to the decisions that affected them, and the system records when entities are merged via canonical key matching.

## What Changed

### Migration 0005: Knowledge Links
- `decision_entity_links` table: links decisions to entities with typed relationships
- `canonical_aliases` table: records canonical key merges for dedup auditing
- Indexed on decision_id, entity_id, canonical_key, alias_key

### SqliteDecisionLog
- `linkDecisionToEntity(decisionId, entityId, linkType)`: creates decision-to-entity links
- `getDecisionsByEntity(entityId)`: traverses from entity to its related decisions
- `getEntitiesForDecision(decisionId)`: traverses from decision to affected entities

### SqliteEntityGraph
- `recordCanonicalAlias(canonicalKey, aliasKey, entityType)`: records dedup merges
- `getAliases(canonicalKey)`: retrieves all known aliases for a canonical key

## Rollback
Drop tables, delete migration row. See migration-plan.md.
