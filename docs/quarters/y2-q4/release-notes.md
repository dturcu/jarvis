# Y2-Q4 Small-Team Mode — Release Notes

## Summary

Jarvis now supports small-team operation. Runs track ownership (who initiated) and assignment (who is responsible). Approvals can be delegated to specific operators with audit trail. No multi-tenant abstractions — the architecture remains single-node.

## What Changed

### Migration 0006: Team Mode
- `runs` table: added `owner` and `assignee` columns
- `approvals` table: added `assignee`, `delegated_by`, `delegation_note` columns
- Indexes on owner, assignee for efficient filtering

### RunStore
- `setRunOwner(runId, owner)`: set who initiated a run
- `assignRun(runId, assignee)`: assign a run for review/action
- `getRunsByUser(userId)`: get runs owned by or assigned to a user

### Approval Delegation
- `delegateApproval(db, approvalId, assignee, delegatedBy, note?)`: delegate a pending approval to another operator
- `listApprovalsByAssignee(db, assignee)`: get approvals assigned to a specific user
- Delegation recorded in audit_log with actor, target, and delegation note

## Rollback
Migration 0006 uses ALTER TABLE which cannot be rolled back in SQLite. To rollback, recreate tables from scratch via init-jarvis.ts.
