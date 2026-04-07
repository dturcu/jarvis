# Jarvis -- Autonomous Agent System

Jarvis is an autonomous agent system for **Thinking in Code**, Daniel's automotive safety consulting firm (ISO 26262, ASPICE, AUTOSAR, cybersecurity). It runs 14 domain agents that handle BD pipeline intelligence, proposal generation, compliance auditing, contract review, staffing monitoring, LinkedIn content, crypto portfolio, garden management, email campaigns, social engagement, security monitoring, drive watching, invoice generation, and meeting transcription.

The system runs on **OpenClaw** (`^2026.4.5`) as a plugin pack. OpenClaw provides the chat OS layer (session routing, plugin lifecycle, tool execution, model abstraction, Telegram channel). Jarvis provides 17 domain plugins, 14 agent definitions, and a contract-validated job queue.

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
| `/email-campaign` | Manage drip campaigns, follow-up sequences, outreach automation |
| `/social-engagement` | Monitor and respond to social media interactions |
| `/security-monitor` | Track security advisories, vulnerability alerts, compliance updates |
| `/drive-watcher` | Watch shared drives for new/changed documents, trigger workflows |
| `/invoice-generator` | Generate and track invoices for client engagements |
| `/meeting-transcriber` | Transcribe and summarize meeting recordings |

Agents with schedules run automatically via scheduled tasks. Manual agents run on demand.

## Architecture

Jarvis has two execution modes:

### Claude Code Mode (Interactive)

Claude Code is the runtime. Jarvis provides domain knowledge, state persistence, and agent definitions as skills.

```
Claude Code (LLM reasoning + MCP integrations)
    |-- Skills (.claude/skills/*.md) -- agent workflows
    |-- Gmail MCP -- email search, read, draft, send
    |-- Chrome MCP -- browser automation
    |-- WebSearch/WebFetch -- web intelligence
    '-- Scheduled Tasks MCP -- cron triggers
```

### OpenClaw Mode (Autonomous)

OpenClaw is the plugin gateway. Jarvis plugins register tools, commands, and hooks. Workers execute jobs asynchronously.

```
OpenClaw Gateway (WebSocket + HTTP, plugin host)
    |-- 17 Jarvis Plugins
    |     |-- @jarvis/core     -- planning, approvals, model selection
    |     |-- @jarvis/jobs     -- job queue (claim/heartbeat/callback HTTP routes)
    |     |-- @jarvis/dispatch -- cross-session messaging
    |     |-- @jarvis/office   -- Excel/Word/PowerPoint automation
    |     |-- @jarvis/device   -- Windows desktop automation
    |     |-- @jarvis/email    -- email management
    |     '-- ... (11 more plugins)
    |-- Job Queue (submit -> claim -> heartbeat -> callback)
    |-- Worker Pool (in-process and child-process workers)
    '-- Model Router (TaskProfile -> SelectionPolicy -> local model)
```

### Shared State (SQLite)

```
~/.jarvis/
    |-- runtime.db    -- control plane: runs, approvals, jobs, heartbeats, model registry, agent memory
    |-- crm.db        -- CRM pipeline: contacts, notes, stages
    |-- knowledge.db  -- knowledge store: documents, playbooks, entities, decisions
    '-- config.json   -- configuration
```

## Packages (43)

### Core & Framework
- `jarvis-shared` -- base types, OpenClaw SDK integration, gateway utilities
- `jarvis-core` -- policy engine: planning, approvals, model selection
- `jarvis-agent-framework` -- agent runtime, memory, knowledge, entity graph, lesson capture
- `jarvis-agents` -- 14 agent definitions with system prompts
- `jarvis-runtime` -- standalone daemon

### Infrastructure
- `jarvis-jobs`, `jarvis-dispatch`, `jarvis-scheduler`, `jarvis-supervisor`
- `jarvis-inference`, `jarvis-interpreter`, `jarvis-security`, `jarvis-system`, `jarvis-voice`, `jarvis-device`

### Plugins (6)
- `jarvis-agent-plugin`, `jarvis-email-plugin`, `jarvis-calendar-plugin`
- `jarvis-crm-plugin`, `jarvis-web-plugin`, `jarvis-document-plugin`

### Workers (17)
- `jarvis-agent-worker`, `jarvis-email-worker`, `jarvis-calendar-worker`, `jarvis-crm-worker`
- `jarvis-web-worker`, `jarvis-document-worker`, `jarvis-browser-worker`, `jarvis-office-worker`
- `jarvis-inference-worker`, `jarvis-interpreter-worker`, `jarvis-security-worker`, `jarvis-system-worker`
- `jarvis-voice-worker`, `jarvis-social-worker`, `jarvis-time-worker`, `jarvis-drive-worker`
- `jarvis-desktop-host-worker`

### Services
- `jarvis-dashboard` -- React web dashboard
- `jarvis-telegram` -- Telegram bot
- `jarvis-browser`, `jarvis-office`, `jarvis-files`

## Key Directories

- `packages/jarvis-agents/src/definitions/` -- 14 agent definition files (TypeScript)
- `packages/jarvis-agents/src/prompts/` -- 14 system prompt files (Markdown)
- `packages/jarvis-agents/src/data/` -- Garden beds + planting calendar (JSON)
- `packages/jarvis-agent-framework/src/` -- Runtime, memory, knowledge, entity graph, lesson capture
- `contracts/jarvis/v1/` -- JSON schemas (22 families), 144 examples, job catalog (143 types), plugin surface
- `tests/` -- 48 test files, 1159 tests
- `scripts/` -- Setup, contract validation, DB initialization, ops (health, backup, recovery)
- `scripts/runtime/` -- OpenClaw gateway bootstrap and smoke harness
- `docs/` -- Architecture, usage guide, production target, release gates, specs, runbooks
- `.claude/skills/` -- Claude Code skill files for each agent

## Testing

```bash
npm run check                    # Full pipeline: contracts + tests + build
npm test                         # Tests only (48 files, 1159 tests)
npm run build                    # TypeScript compilation
npm run validate:contracts       # Schema + example validation (143 job types)
npm run smoke:runtime            # OpenClaw + LM Studio integration smoke test
```

## CRM Pipeline Stages

prospect -> qualified -> contacted -> meeting -> proposal -> negotiation -> won | lost | parked

## Approval Rules

- `email.send` -- always requires approval (critical)
- `publish_post` / `post_comment` -- always requires approval (critical)
- `trade_execute` -- always requires approval (critical)
- `crm.move_stage` -- requires approval (warning)
- `document.generate_report` -- requires approval (warning)

Of 143 total job types: 17 always require approval, 33 are conditional, 93 never require approval.

Read-only operations (search, analyze, list) never require approval.
