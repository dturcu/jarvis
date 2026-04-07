# Y1-Q4 Appliance Reliability — Migration Plan

## No Database Migration

Q4 is a code-only change. No new tables, columns, or indexes. The doctor and readiness systems are enhanced at the code level.

## Behavioral Changes

- Doctor now checks daemon heartbeat freshness, migration status, and channel table existence
- Readiness report now checks config validity and channel table existence
- `ready` status requires `config_valid` and `channel_tables` to be true

## Rollback

Revert to the pre-Q4 branch. Doctor and readiness will revert to their previous check sets.
