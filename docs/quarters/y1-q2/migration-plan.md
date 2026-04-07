# Y1-Q2 Execution Hardening — Migration Plan

## Migration 0004: Channel Fixes

Upgrades the `idx_channel_threads_ext` index from non-unique to UNIQUE, preventing race conditions from creating duplicate threads for the same external conversation.

```sql
DROP INDEX IF EXISTS idx_channel_threads_ext;
CREATE UNIQUE INDEX idx_channel_threads_ext ON channel_threads(channel, external_id);
```

## No Schema Changes for Execution Hardening

The execution policy, filesystem policy, worker health monitor, error boundaries, and auth mode enforcement are all code-level changes. No new database tables or columns are required.

## Rollback

```sql
DROP INDEX IF EXISTS idx_channel_threads_ext;
CREATE INDEX idx_channel_threads_ext ON channel_threads(channel, external_id);
DELETE FROM schema_migrations WHERE id = '0004';
```

Rollback reverts the UNIQUE constraint to a non-unique index. No data loss.
