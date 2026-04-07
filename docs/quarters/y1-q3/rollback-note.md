# Y1-Q3 Core Workflow Focus — Rollback Note

## Scope

This quarter adds pack classification (core/experimental/personal) to agents and workflows, expands the dashboard agent listing from 8 to 14, and enforces maturity-based schedule enablement. No database changes.

## Rollback Steps

### 1. Code

Revert to the pre-Q3 branch. The `pack` field on AgentDefinition and WorkflowDefinition will be removed. Dashboard AGENT_META will revert to 8 agents.

### 2. Schedules

On next daemon restart, all agent schedules will be re-seeded as enabled (pre-Q3 behavior). No manual schedule adjustment needed.

### 3. No Database Changes

No migration to revert. No data loss.

## Risk Assessment

**Very low risk.** Q3 is purely code-level classification and UI filtering. No schema changes, no data migration, no external API changes.
