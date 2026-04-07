# Y1-Q4 Appliance Reliability — Rollback Note

## Scope

This quarter enhances the doctor diagnostic system and readiness report with additional checks (daemon heartbeat, migration status, config validation, channel table existence). No database changes.

## Rollback Steps

### 1. Code

Revert to the pre-Q4 branch.

### 2. No Database Changes

No migration to revert.

## Risk Assessment

**Very low risk.** Q4 adds diagnostic checks only. No schema changes, no behavioral changes to the runtime. Rollback removes the additional checks.
