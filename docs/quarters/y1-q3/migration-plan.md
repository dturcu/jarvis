# Y1-Q3 Core Workflow Focus — Migration Plan

## No Database Migration

Q3 is a code-only change. No new tables, columns, or indexes.

The pack classification is stored in agent definition source code (TypeScript), not in the database. The scheduler respects the `pack` and `maturity` fields at seed time to determine whether a schedule is enabled or disabled.

## Behavioral Change

Experimental agents that previously had enabled schedules will now be seeded as disabled on next daemon restart. Operators can re-enable them via the schedule management API if desired.

## Rollback

Revert to the pre-Q3 branch. All agents will resume their previous schedule behavior (all seeded as enabled regardless of pack classification).
