> **Note:** This document reflects the pre-v1.0.0 15-agent roster. The active roster was reset to 8 agents in v1.0.0 (2026-04-08). See docs/AGENT-ROSTER-RESET.md for the migration map.

# Y1-Q3 Core Workflow Focus — Release Notes

**Version:** TBD
**Date:** TBD

## Summary

The product surface now centers on the five core consulting workflows: BD Pipeline, Proposal Engine, Evidence Auditor, Contract Reviewer, and Staffing Monitor. Non-core agents are classified as experimental or personal and are visually secondary in the dashboard.

## What Changed

### Pack Classification

Every agent now declares its pack: `core`, `experimental`, or `personal`.

| Pack | Agents |
|------|--------|
| **Core** (5) | bd-pipeline, proposal-engine, evidence-auditor, contract-reviewer, staffing-monitor |
| **Experimental** (7) | content-engine, email-campaign, social-engagement, security-monitor, drive-watcher, invoice-generator, meeting-transcriber |
| **Personal** (2) | portfolio-monitor, garden-calendar |

### Dashboard

- Agent listing expanded from 8 to 14 agents (all agents now visible)
- Each agent includes its `pack` classification in the API response
- Agents API supports `?pack=core` filter for focused views

### Maturity Enforcement

- Experimental agents are now seeded as disabled in the scheduler
- Operators can re-enable them manually if desired
- Core and personal agents continue to schedule normally

### Workflow Classification

- All 5 V1 workflows tagged as `pack: "core"`
- Workflow definitions include pack metadata for UI filtering

## Configuration

No new configuration required. Pack classification is built into agent definitions.

## Rollback

See `docs/quarters/y1-q3/rollback-note.md`. Code-only revert, no data migration.
