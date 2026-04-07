# Y2-Q3 Knowledge Loop — Migration Plan

## Migration 0005: Knowledge Links

Two new tables in runtime.db:

```sql
CREATE TABLE decision_entity_links (link_id, decision_id, entity_id, link_type, created_at);
CREATE TABLE canonical_aliases (alias_id, canonical_key, alias_key, entity_type, created_at);
```

## Rollback
```sql
DROP TABLE IF EXISTS canonical_aliases;
DROP TABLE IF EXISTS decision_entity_links;
DELETE FROM schema_migrations WHERE id = '0005';
```
