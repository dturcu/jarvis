# Agent Migration Map — Legacy to New Roster

Date: 2026-04-08

## New Active Roster (8 agents)

| Agent | Role | Maturity |
|-------|------|----------|
| orchestrator | Top-level workflow coordinator | high_stakes_manual_gate |
| self-reflection | System health analysis, improvement proposals | trusted_with_review |
| regulatory-watch | Standards/regulatory intelligence | operational |
| knowledge-curator | Knowledge store maintenance, document/meeting ingestion | operational |
| proposal-engine | RFQ analysis, quoting, invoicing | high_stakes_manual_gate |
| evidence-auditor | ISO 26262/ASPICE compliance auditing | trusted_with_review |
| contract-reviewer | NDA/MSA clause analysis | high_stakes_manual_gate |
| staffing-monitor | Team utilization, gap forecasting | operational |

## Legacy Roster Disposition (15 agents)

| Old Agent | Disposition | New Owner | Notes |
|-----------|-------------|-----------|-------|
| bd-pipeline | **Retired** | orchestrator (workflow) | BD scanning is now a workflow triggered via orchestrator, not a standalone agent |
| proposal-engine | **Replaced** | proposal-engine (v1.0.0) | Clean rewrite with invoice generation absorbed, regulatory awareness added |
| evidence-auditor | **Replaced** | evidence-auditor (v1.0.0) | Clean rewrite with regulatory delta check, multimodal support |
| contract-reviewer | **Replaced** | contract-reviewer (v1.0.0) | Clean rewrite with regulatory awareness, multimodal support |
| staffing-monitor | **Replaced** | staffing-monitor (v1.0.0) | Clean rewrite with CRM pipeline integration |
| content-engine | **Demoted to workflow** | orchestrator | LinkedIn content is a scheduled workflow, not an agent |
| portfolio-monitor | **Retired** | none | Personal crypto monitoring removed from production |
| garden-calendar | **Retired** | none | Personal garden management removed from production |
| social-engagement | **Retired** | none | Experimental social media engagement removed |
| security-monitor | **Retired** | none | Moved to infrastructure tooling, not agent scope |
| invoice-generator | **Merged** | proposal-engine | Invoice generation is now part of proposal-engine |
| email-campaign | **Demoted to workflow** | orchestrator | Campaign execution is a scheduled workflow |
| meeting-transcriber | **Merged** | knowledge-curator | Meeting ingestion is now part of knowledge-curator |
| drive-watcher | **Retired** | knowledge-curator (event) | Document ingestion triggered by events, not polling |
| self-reflection | **Replaced** | self-reflection (v1.0.0) | Clean rewrite with stricter no-auto-apply rules |

## New Agents (no legacy equivalent)

| Agent | Why it exists |
|-------|---------------|
| orchestrator | Replaces ad-hoc multi-agent workflows with explicit DAG coordination |
| regulatory-watch | Standards intelligence was implicit in other agents; now a dedicated feed |
| knowledge-curator | Knowledge store had no owner; meeting and document ingestion were fragmented |

## Responsibility Absorption Summary

```
meeting-transcriber  ──→  knowledge-curator (meeting ingestion)
invoice-generator    ──→  proposal-engine (invoice generation)
drive-watcher        ──→  knowledge-curator (document.received event)
bd-pipeline          ──→  orchestrator (BD workflow) + knowledge-curator (CRM data)
content-engine       ──→  orchestrator (content publishing workflow)
email-campaign       ──→  orchestrator (campaign execution workflow)
```

## Orphaned References (known, deferred)

The following files still contain references to retired agent IDs.
These are tracked for cleanup but do not affect production behavior:

- `packages/jarvis-runtime/src/workflows.ts` — V1_WORKFLOWS reference bd-pipeline (will be updated when workflows are rebuilt in Step 7)
- `packages/jarvis-telegram/src/commands.ts` — old slash commands (will be updated)
- `packages/jarvis-dashboard/src/api/agents.ts` — legacy agent config (dashboard data)
- `packages/jarvis-dashboard/src/api/history.ts`, `runs.ts`, `ui/types/` — display name mappings
- `tests/stress/` — stress tests use their own mock agent arrays (excluded from CI, not broken)
- `contracts/jarvis/v1/examples/` — JSON fixtures referencing old agent IDs in metadata fields (schema-valid, not broken)
- `docs/` — several docs reference old roster (documentation refresh needed)
- `CLAUDE.md` — agent table needs update
