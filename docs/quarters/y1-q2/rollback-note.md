# Y1-Q2 Execution Hardening — Rollback Note

## Scope

This quarter adds execution boundaries (error isolation, hard timeouts, filesystem policies, approval guards), auth mode enforcement, worker health monitoring, and fixes PR #60 review findings. Rollback restores the previous behavior.

## Rollback Steps

### 1. Database

Revert migration 0004 (UNIQUE constraint):

```sql
DROP INDEX IF EXISTS idx_channel_threads_ext;
CREATE INDEX idx_channel_threads_ext ON channel_threads(channel, external_id);
DELETE FROM schema_migrations WHERE id = '0004';
```

### 2. Code

Revert to the pre-Q2 branch. The worker registry, files bridge, auth middleware, and daemon will resume their Q1 behavior (no error boundaries, no filesystem policy, dev-mode auth bypass, no worker health tracking).

### 3. Environment

Remove `JARVIS_MODE` environment variable if set.

### 4. Runtime

Restart the daemon after reverting.

## Data Loss on Rollback

- No data loss. Worker health state is in-memory only (not persisted).
- Duplicate channel threads may be created after removing the UNIQUE constraint.

## Risk Assessment

**Low risk.** Q2 changes are primarily code-level enforcement. The only schema change (migration 0004) is an index upgrade that can be cleanly reverted.
