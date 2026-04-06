# Jarvis — Autonomous Agent System

Jarvis is an autonomous agent system for **Thinking in Code**, Daniel's automotive safety consulting firm (ISO 26262, ASPICE, AUTOSAR, cybersecurity). It runs 8 domain agents that handle BD pipeline intelligence, proposal generation, compliance auditing, contract review, staffing monitoring, LinkedIn content, crypto portfolio, and garden management.

## Quick Start

```bash
npm install
npx tsx scripts/init-jarvis.ts   # Initialize CRM + knowledge databases
npm run check                     # Validate contracts + run tests + build
```

## Running Agents

Each agent is a Claude Code skill invocable via slash command:

| Command | What it does |
|---|---|
| `/bd-pipeline` | Scan for BD signals, enrich leads, draft outreach, update CRM |
| `/proposal-engine` | Analyze RFQ/SOW, build quote structure, draft proposal |
| `/evidence-auditor` | Scan project for ISO 26262 work products, produce gap matrix |
| `/contract-reviewer` | Analyze NDA/MSA clauses, produce sign/negotiate/escalate recommendation |
| `/staffing-monitor` | Calculate team utilization, forecast gaps, match skills to pipeline |
| `/content-engine` | Draft LinkedIn post for today's content pillar |
| `/portfolio-monitor` | Check crypto prices, calculate drift, recommend rebalance |
| `/garden-calendar` | Generate weekly garden brief based on date + weather |

Agents with schedules run automatically via scheduled tasks. Manual agents run on demand.

## Architecture

Claude Code is the runtime. Jarvis provides domain knowledge, state persistence, and agent definitions.

```
Claude Code (LLM reasoning + MCP integrations)
    ├── Skills (.claude/skills/*.md) — agent workflows
    ├── Gmail MCP — email search, read, draft, send
    ├── Chrome MCP — browser automation
    ├── WebSearch/WebFetch — web intelligence
    └── Scheduled Tasks MCP — cron triggers
Jarvis State (SQLite)
    ├── ~/.jarvis/crm.db — CRM pipeline (contacts, notes, stages)
    └── ~/.jarvis/knowledge.db — knowledge store (documents, playbooks, entities, decisions)
Jarvis Packages (29 packages, typed infrastructure)
    ├── Agent definitions + prompts (packages/jarvis-agents/)
    ├── Agent framework (packages/jarvis-agent-framework/)
    ├── Job contracts + schemas (contracts/jarvis/v1/)
    └── Workers + plugins (packages/jarvis-*-worker/, packages/jarvis-*-plugin/)
```

## Key Directories

- `packages/jarvis-agents/src/definitions/` — 8 agent definition files (TypeScript)
- `packages/jarvis-agents/src/prompts/` — 14 system prompt files (Markdown)
- `packages/jarvis-agents/src/data/` — Garden beds + planting calendar (JSON)
- `packages/jarvis-agent-framework/src/` — Runtime, memory, knowledge, entity graph, lesson capture
- `contracts/jarvis/v1/` — JSON schemas, examples, catalog, plugin surface
- `tests/` — 29 test files, 769 tests
- `scripts/` — Contract validation, DB initialization
- `.claude/skills/` — Claude Code skill files for each agent

## Testing

```bash
npm run check                    # Full pipeline: contracts + tests + build
npm test                         # Tests only (769 tests, 29 files)
npm run build                    # TypeScript compilation
npm run validate:contracts       # Schema + example validation
```

## CRM Pipeline Stages

prospect → qualified → contacted → meeting → proposal → negotiation → won | lost | parked

## Approval Rules

- `email.send` — always requires approval (critical)
- `publish_post` / `post_comment` — always requires approval (critical)
- `trade_execute` — always requires approval (critical)
- `crm.move_stage` — requires approval (warning)
- `document.generate_report` — requires approval (warning)

Read-only operations (search, analyze, list) never require approval.
