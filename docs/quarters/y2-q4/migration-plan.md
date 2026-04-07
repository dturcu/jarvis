# Y2-Q4 Small-Team Mode — Migration Plan

## Migration 0006: Team Mode

ALTER TABLE operations on existing tables:

```sql
ALTER TABLE runs ADD COLUMN owner TEXT;
ALTER TABLE runs ADD COLUMN assignee TEXT;
ALTER TABLE approvals ADD COLUMN assignee TEXT;
ALTER TABLE approvals ADD COLUMN delegated_by TEXT;
ALTER TABLE approvals ADD COLUMN delegation_note TEXT;
```

New columns are nullable — existing rows are unaffected.

## Rollback
SQLite ALTER TABLE ADD COLUMN cannot be reverted. To rollback, reinitialize databases via `npx tsx scripts/init-jarvis.ts` (destroys existing data).
