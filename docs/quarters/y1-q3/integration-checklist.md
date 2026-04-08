> **Note:** This document reflects the pre-v1.0.0 15-agent roster. The active roster was reset to 8 agents in v1.0.0 (2026-04-08). See docs/AGENT-ROSTER-RESET.md for the migration map.

# Y1-Q3 Core Workflow Focus — Integration Checklist

## Pack Classification

- [ ] AgentDefinition type includes `pack?: AgentPack` field
- [ ] AgentPack type: "core" | "experimental" | "personal"
- [ ] 5 core agents: bd-pipeline, proposal-engine, evidence-auditor, contract-reviewer, staffing-monitor
- [ ] 7 experimental agents: content-engine, email-campaign, social-engagement, security-monitor, drive-watcher, invoice-generator, meeting-transcriber
- [ ] 2 personal agents: portfolio-monitor, garden-calendar
- [ ] All 14 agent definitions have `pack` field set

## Dashboard

- [ ] AGENT_META includes all 14 agents (was 8)
- [ ] AGENT_META includes `pack` field per agent
- [ ] Agents API supports `?pack=core` filter
- [ ] Agent listing response includes `pack` field

## Workflow Classification

- [ ] WorkflowDefinition type includes `pack` field
- [ ] All 5 V1_WORKFLOWS tagged `pack: "core"`
- [ ] Each workflow references at least one core agent

## Maturity Enforcement

- [ ] Experimental agents seeded as disabled in scheduler
- [ ] Core agents seeded as enabled in scheduler
- [ ] Personal agents seeded as enabled (they have their own approval gates)

## Starter Pack Consistency

- [ ] "automotive-consulting" pack enables exactly the 5 core agents
- [ ] "solo-consultant" pack enables a core subset
- [ ] "development" pack enables all agents

## Tests

- [ ] Golden replay tests for pack classification
- [ ] All existing tests pass
- [ ] Build compiles cleanly
- [ ] Contract validation passes

## Docs

- [ ] Migration plan (no schema migration — code-only changes)
- [ ] Rollback note
- [ ] Release notes
