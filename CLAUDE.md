# Jarvis -- Autonomous Agent System

Jarvis is an autonomous agent system for **Thinking in Code**, Daniel's automotive safety consulting firm (ISO 26262, ASPICE, AUTOSAR, cybersecurity). It runs 8 production agents: orchestrator, self-reflection, regulatory-watch, knowledge-curator, proposal-engine, evidence-auditor, contract-reviewer, and staffing-monitor.

The system runs on **OpenClaw** (`^2026.4.5`) as a plugin pack. OpenClaw provides the chat OS layer (session routing, plugin lifecycle, tool execution, model abstraction, Telegram channel). Jarvis provides 19 domain plugins, 8 agent definitions (15 legacy archived), and a contract-validated job queue.

## Quick Start

```bash
npm install
npx tsx scripts/init-jarvis.ts   # Initialize CRM + knowledge databases
npm run check                     # Validate contracts + run tests + build
```

## Running Agents

Each agent is a Claude Code skill invocable via slash command:

| Command | Maturity | What it does |
|---|---|---|
| `/orchestrator` | high_stakes | Decompose goals into agent DAGs, coordinate multi-agent workflows |
| `/self-reflection` | gated | Weekly system health analysis, ranked improvement proposals |
| `/regulatory-watch` | trusted | Track ISO 26262, ISO 21434, ASPICE, EU regulatory changes |
| `/knowledge-curator` | trusted | Ingest documents/meetings, maintain knowledge store, resolve entities |
| `/proposal-engine` | high_stakes | Analyze RFQs, build quotes, generate proposals, handle invoicing |
| `/evidence-auditor` | gated | Audit ISO 26262 / ASPICE evidence, produce gap matrices |
| `/contract-reviewer` | high_stakes | Analyze NDA/MSA clauses, produce sign/negotiate/escalate |
| `/staffing-monitor` | trusted | Track utilization, forecast gaps, match skills to pipeline |

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
    |-- 19 Jarvis Plugins
    |     |-- @jarvis/core     -- planning, approvals, model selection
    |     |-- @jarvis/jobs     -- job queue (claim/heartbeat/callback HTTP routes)
    |     |-- @jarvis/dispatch -- cross-session messaging
    |     |-- @jarvis/agent    -- agent registration and execution
    |     |-- @jarvis/office   -- Excel/Word/PowerPoint automation
    |     |-- @jarvis/device   -- Windows desktop automation
    |     |-- @jarvis/system   -- system monitoring and platform hooks
    |     |-- @jarvis/email    -- email management
    |     '-- ... (10 more plugins)
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
- `@jarvis/shared` -- base types, OpenClaw SDK integration, gateway utilities
- `@jarvis/core` -- policy engine: planning, approvals, model selection
- `@jarvis/agent-framework` -- agent runtime, memory, knowledge, entity graph, lesson capture
- `@jarvis/agents` -- 14 agent definitions with system prompts
- `@jarvis/runtime` -- standalone daemon

### Infrastructure
- `@jarvis/jobs`, `@jarvis/dispatch`, `@jarvis/scheduler`, `@jarvis/supervisor`
- `@jarvis/inference`, `@jarvis/interpreter`, `@jarvis/security`, `@jarvis/system`, `@jarvis/voice`, `@jarvis/device`

### Plugins (6)
- `@jarvis/agent-plugin`, `@jarvis/email-plugin`, `@jarvis/calendar-plugin`
- `@jarvis/crm-plugin`, `@jarvis/web-plugin`, `@jarvis/document-plugin`

### Workers (17)
- `@jarvis/agent-worker`, `@jarvis/email-worker`, `@jarvis/calendar-worker`, `@jarvis/crm-worker`
- `@jarvis/web-worker`, `@jarvis/document-worker`, `@jarvis/browser-worker`, `@jarvis/office-worker`
- `@jarvis/inference-worker`, `@jarvis/interpreter-worker`, `@jarvis/security-worker`, `@jarvis/system-worker`
- `@jarvis/voice-worker`, `@jarvis/social-worker`, `@jarvis/time-worker`, `@jarvis/drive-worker`
- `@jarvis/desktop-host-worker`

### Services
- `jarvis-dashboard` -- React web dashboard
- `jarvis-telegram` -- Telegram bot
- `@jarvis/browser`, `@jarvis/office`, `@jarvis/files`

## Key Directories

- `packages/jarvis-agents/src/definitions/` -- 8 active agent definitions (TypeScript)
- `packages/jarvis-agents/src/legacy/definitions/` -- 15 archived agent definitions
- `packages/jarvis-agents/src/prompts/` -- 8 system prompt files (Markdown)
- `packages/jarvis-agents/src/legacy/prompts/` -- 14 archived prompt files
- `packages/jarvis-agents/src/data/` -- Garden beds + planting calendar (JSON)
- `packages/jarvis-agent-framework/src/` -- Runtime, memory, knowledge, entity graph, lesson capture
- `contracts/jarvis/v1/` -- JSON schemas (23 families), 144 examples, job catalog (143 types), plugin surface
- `tests/` -- 92 test files (unit + smoke + stress), 2384+ test cases
- `scripts/` -- Setup, contract validation, DB initialization, ops (health, backup, recovery)
- `scripts/runtime/` -- OpenClaw gateway bootstrap and smoke harness
- `docs/` -- Architecture, usage guide, production target, release gates, specs, runbooks
- `.claude/skills/` -- Claude Code skill files for each agent

## Testing

```bash
npm run check                    # Full pipeline: contracts + tests + build
npm test                         # Tests only (92 files, 2384+ tests)
npm run build                    # TypeScript compilation
npm run validate:contracts       # Schema + example validation (143 job types)
npm run smoke:runtime            # OpenClaw + LM Studio integration smoke test
```

## Security Model

- Dashboard API binds to `127.0.0.1` by default (configurable via `JARVIS_BIND_HOST`)
- Auth: requires Bearer token in production; read-only access in dev mode without tokens
- Chat and Telegram surfaces are read-only ingress — no direct email sending, file writing, or shell execution
- All irreversible actions (email, publishing, trades) flow through the approval-backed job pipeline
- Agent memory is durable (SQLite-backed), not in-memory

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
