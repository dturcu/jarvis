# Y1-Q1 Kernel Unification — Rollback Note

## Scope

This quarter adds channel persistence tables and refactors Telegram/Godmode into ingress adapters. Rollback restores direct execution paths and removes channel tables.

## Rollback Steps

### 1. Database

Drop the three new tables in reverse dependency order:

```sql
DROP TABLE IF EXISTS artifact_deliveries;
DROP TABLE IF EXISTS channel_messages;
DROP TABLE IF EXISTS channel_threads;
```

No existing tables are modified by Q1 migrations, so no column restores are needed.

### 2. Code

Revert to the pre-Q1 branch. The Telegram and Godmode endpoints will resume their original direct-execution behavior.

### 3. Runtime

Restart the daemon after reverting. No configuration changes are needed beyond the code revert.

## Data Loss on Rollback

- Channel thread/message history created during Q1 operation will be lost
- Artifact delivery tracking records will be lost
- Run records in the existing `runs` table are preserved (they predate Q1)
- CRM and knowledge databases are unaffected

## Risk Assessment

**Low risk.** Q1 adds new tables without modifying existing ones. The existing Telegram and Godmode code paths are refactored but not deleted until the quarter PR merges, so a revert cleanly restores them.
