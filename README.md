# Jarvis

**Autonomous agent system for [Thinking in Code](https://thinking-in-code.com)** — an automotive safety consulting firm specializing in ISO 26262, ASPICE, AUTOSAR, and cybersecurity.

Jarvis runs 14 domain agents that handle business development, proposal generation, compliance auditing, contract review, staffing, content creation, portfolio management, and more. It runs on [OpenClaw](https://openclaw.dev) as a plugin pack, with local LLM inference via Ollama, LM Studio, or llama.cpp.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/dturcu/jarvis.git
cd jarvis
npm install

# 2. Run the setup wizard (creates databases, config, builds dashboard)
npm run jarvis setup

# 3. Start everything (daemon + dashboard)
npm start
```

Dashboard: **http://localhost:4242**

## Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| Node.js | >=22.5.0 | 22 LTS |
| OpenClaw | ^2026.4.8 | Latest |
| RAM | 8 GB | 16+ GB |
| Disk | 2 GB free | 10+ GB |
| Model Runtime | Ollama **or** LM Studio | Both |

### Model Runtime

Jarvis needs at least one local LLM runtime:

- **[Ollama](https://ollama.com)** — Lightweight, CLI-based. Install and run: `ollama serve`
- **[LM Studio](https://lmstudio.ai)** — GUI-based with model browser. Start the local server.

After installing, pull a model:
```bash
ollama pull llama3.2        # Fast, good for most agents
ollama pull qwen2.5:14b     # Better reasoning, needs 16GB+ RAM
```

## Architecture

Jarvis is a plugin pack for OpenClaw. OpenClaw provides the chat OS layer (session routing, plugin lifecycle, tool execution, model abstraction, channel integration). Jarvis provides 19 domain plugins that sit on top.

```
Channels (Telegram, CLI, Web, API)
        |
OpenClaw Gateway (WebSocket + HTTP)
  |-- Plugin Manager (19 plugins)
  |     |-- @jarvis/core        Planning, approvals, model selection
  |     |-- @jarvis/jobs        Job queue (submit, claim, heartbeat, callback)
  |     |-- @jarvis/dispatch    Cross-session messaging
  |     |-- @jarvis/agent       Agent registration and execution
  |     |-- @jarvis/office      Excel, Word, PowerPoint automation
  |     |-- @jarvis/device      Windows desktop automation
  |     |-- @jarvis/email       Gmail search, read, draft, send
  |     |-- @jarvis/calendar    Calendar intelligence
  |     |-- @jarvis/browser     Chrome automation
  |     |-- @jarvis/files       Safe file operations
  |     |-- @jarvis/system      System monitoring and platform hooks
  |     |-- @jarvis/inference   Local LLM routing
  |     |-- @jarvis/crm         CRM pipeline management
  |     |-- @jarvis/web         Web intelligence
  |     |-- @jarvis/document    Document analysis
  |     |-- @jarvis/security    Security monitoring
  |     |-- @jarvis/scheduler   Cron scheduling
  |     |-- @jarvis/interpreter Multi-step automation
  |     '-- @jarvis/voice       Voice I/O
  |-- Native Tools (browser, fetch, exec)
  '-- Agent Execution (TaskProfile -> model routing)
        |                       |
   LM Studio (:1234)     Ollama (:11434)

Data: ~/.jarvis/
  |-- runtime.db     Control plane (runs, approvals, jobs, model registry)
  |-- crm.db         CRM pipeline (contacts, notes, stages)
  |-- knowledge.db   Knowledge store (documents, entities, decisions)
  '-- config.json    Configuration
```

### How It Works

1. **Agents** define what to do (system prompts, capabilities, approval gates, schedules)
2. **Plugins** (19 total) expose tools to agents via the OpenClaw plugin SDK (`definePluginEntry`)
3. **Tools** submit deterministic job specs to the **job queue**
4. **Workers** claim jobs via HTTP, execute, and return results via callback
5. **Model routing** matches agent needs (TaskProfile) to available local models (SelectionPolicy)

### Execution Modes

Jarvis supports two execution modes:

- **Claude Code mode** — Agents run as Claude Code skills (`.claude/skills/*.md`), using MCP integrations (Gmail, Chrome, WebSearch) directly. Good for interactive use.
- **OpenClaw mode** — Agents run through the OpenClaw gateway with the full plugin stack, job queue, and worker pool. Good for autonomous scheduled execution.

The dashboard also provides two read-only copilot surfaces (`/api/chat/telegram` and `/api/godmode`) with their own LLM loops for interactive queries. These cannot mutate state or trigger agents — all mutations flow through the runtime kernel. See [docs/ADR-CHAT-SURFACES.md](docs/ADR-CHAT-SURFACES.md) for the architectural decision behind this.

## Agents

### Core (production workflows)

| Agent | What it does | Schedule | Tier | Maturity |
|---|---|---|---|---|
| **bd-pipeline** | Scan for BD signals, enrich leads, draft outreach, update CRM | Weekdays 8:00 AM | Core | Trusted |
| **proposal-engine** | Analyze RFQ/SOW, build quote structure, draft proposal | Manual | Core | High-stakes |
| **evidence-auditor** | Scan project for ISO 26262 work products, produce gap matrix | Mondays 9:00 AM | Core | Trusted |
| **contract-reviewer** | Analyze NDA/MSA clauses, produce sign/negotiate/escalate recommendation | Manual | Core | High-stakes |
| **staffing-monitor** | Calculate team utilization, forecast gaps, match skills to pipeline | Mondays 9:00 AM | Core | Operational |

### Extended

| Agent | What it does | Schedule | Tier | Maturity |
|---|---|---|---|---|
| **content-engine** | Draft LinkedIn post for today's content pillar | Mon/Wed/Thu 7:00 AM | Extended | Operational |
| **email-campaign** | Manage drip campaigns, follow-up sequences | Manual | Extended | Trusted |
| **invoice-generator** | Generate and track invoices for client engagements | Manual | Extended | Trusted |
| **meeting-transcriber** | Transcribe and summarize meeting recordings | Manual | Extended | Operational |

### Personal / Experimental

| Agent | What it does | Schedule | Tier | Maturity |
|---|---|---|---|---|
| **portfolio-monitor** | Check crypto prices, calculate drift, recommend rebalance | Daily 8 AM + 8 PM | Personal | Operational |
| **garden-calendar** | Generate weekly garden brief based on date + weather | Mondays 7:00 AM | Personal | Operational |
| **social-engagement** | Monitor and respond to social media interactions | Weekdays 8:30 AM + 6 PM | Experimental | Experimental |
| **security-monitor** | Track security advisories, vulnerability alerts | Daily 3:00 AM | Experimental | Experimental |
| **drive-watcher** | Watch shared drives for new/changed documents | Every 5 minutes | Experimental | Experimental |

**Maturity levels:**
- **High-stakes**: Every mutating action requires human approval
- **Trusted**: Runs autonomously, outputs reviewed post-hoc
- **Operational**: Runs on schedule, standard approval gates

## Packages

43 TypeScript packages organized as an npm workspace monorepo.

### Core & Framework

| Package | Purpose |
|---|---|
| `@jarvis/shared` | Base types, OpenClaw runtime foundation, gateway utilities |
| `@jarvis/core` | Policy engine: planning, approvals, model selection |
| `@jarvis/agent-framework` | Agent runtime, memory, knowledge, entity graph, lesson capture |
| `@jarvis/agents` | 14 agent definitions with system prompts and registry |
| `@jarvis/runtime` | Standalone daemon for autonomous agent execution |

### Infrastructure

| Package | Purpose |
|---|---|
| `@jarvis/jobs` | Job queue: submission, claiming, callbacks, retries |
| `@jarvis/dispatch` | Cross-session messaging and follow-ups |
| `@jarvis/scheduler` | Cron scheduling and alert management |
| `@jarvis/supervisor` | Agent supervision and governance |
| `@jarvis/inference` | LLM inference coordination and model routing |
| `@jarvis/interpreter` | Code/prompt interpretation |
| `@jarvis/security` | Security policies and validation |
| `@jarvis/system` | System monitoring (CPU, memory, disk, processes) |
| `@jarvis/voice` | Voice I/O (Whisper STT, Piper TTS) |
| `@jarvis/device` | Device integration and notifications |

### Plugins (Agent-Facing Interfaces)

| Package | Purpose |
|---|---|
| `@jarvis/agent-plugin` | Agent orchestration plugin |
| `@jarvis/email-plugin` | Email operations (Gmail) |
| `@jarvis/calendar-plugin` | Calendar operations |
| `@jarvis/crm-plugin` | CRM pipeline management |
| `@jarvis/web-plugin` | Web intelligence and scraping |
| `@jarvis/document-plugin` | Document analysis and compliance checking |

### Workers (Async Job Processors)

| Package | Purpose |
|---|---|
| `@jarvis/agent-worker` | Agent execution |
| `@jarvis/email-worker` | Email sending/receiving |
| `@jarvis/calendar-worker` | Calendar sync |
| `@jarvis/crm-worker` | CRM operations |
| `@jarvis/web-worker` | Web scraping and search |
| `@jarvis/document-worker` | Document processing |
| `@jarvis/browser-worker` | Chrome automation |
| `@jarvis/office-worker` | Office document handling |
| `@jarvis/inference-worker` | LLM inference execution |
| `@jarvis/interpreter-worker` | Code/prompt execution |
| `@jarvis/security-worker` | Security checks |
| `@jarvis/system-worker` | System commands |
| `@jarvis/voice-worker` | Voice I/O processing |
| `@jarvis/social-worker` | Social media monitoring |
| `@jarvis/time-worker` | Time/timezone utilities |
| `@jarvis/drive-worker` | Google Drive monitoring |
| `@jarvis/desktop-host-worker` | Windows desktop automation |

### Services

| Package | Purpose |
|---|---|
| `jarvis-dashboard` | Web dashboard (React) at http://localhost:4242 |
| `jarvis-telegram` | Telegram bot integration |
| `@jarvis/browser` | Chrome DevTools Protocol integration |
| `@jarvis/office` | Office (Word, Excel, PowerPoint) operations |
| `@jarvis/files` | File system operations |

## Contract System

All job types, tool responses, and worker callbacks conform to the `jarvis.v1` contract — a frozen JSON Schema specification.

- **144 job types** across **27 schema families**: agent, browser, calendar, crm, device, document, drive, email, files, inference, interpreter, office, python, scheduler, search, security, social, system, time, voice, web
- **Schema validation** via `npm run validate:contracts` — validates all schemas and 145 example payloads against full envelope/result schemas
- **Contract files** live in `contracts/jarvis/v1/`

### Job Lifecycle

```
Agent calls tool -> submitJob(type, input)
  -> Job queued in SQLite (status: queued)
    -> Worker claims via POST /jarvis/jobs/claim (status: running)
      -> Worker sends heartbeats to renew lease
        -> Worker posts result to POST /jarvis/jobs/callback (status: completed|failed)
          -> Agent notified via dispatch
```

### Versioning Rules

- Additive optional fields are allowed within v1
- Breaking changes (field meaning, required fields, enum values, job types, tool names) require v2

## Approval Rules

High-stakes actions require human approval before execution. Of 144 job types:

| Approval | Count | Examples |
|---|---|---|
| **Required** (always) | 17 | `email.send`, `device.click`, `device.type_text`, `python.run`, `security.lockdown`, `calendar.create_event` |
| **Conditional** (policy-gated) | 33 | `crm.move_stage`, `document.generate_report`, `device.open_app`, `files.write` |
| **Not required** (read-only) | 94 | `email.search`, `crm.list_pipeline`, `device.snapshot`, `system.cpu_usage` |

Agents with `high_stakes_manual_gate` maturity require approval for **every** mutating action.

## CRM Pipeline

```
prospect -> qualified -> contacted -> meeting -> proposal -> negotiation -> won | lost | parked
```

Stage transitions require approval (warning severity).

## Dashboard

Start the web dashboard:

```bash
npm run dashboard          # Production (http://localhost:4242)
npm run dashboard:dev      # Development (API :4242, UI hot-reload :4243)
```

Pages: Home (agent cards), CRM Pipeline (kanban), Knowledge Base (search), Decisions (audit trail), Schedule (cron tasks).

## Telegram Bot

Get agent updates and approve actions from Telegram. See [docs/USAGE.md](docs/USAGE.md#telegram-bot-setup) for setup instructions.

Available commands: `/status`, `/crm`, `/portfolio`, `/garden`, `/bd`, `/content`, `/approve <id>`, `/reject <id>`.

## CLI Reference

```bash
# Getting Started
npm run jarvis setup          # Interactive setup wizard
npm run jarvis -- doctor      # Check system health
npm run jarvis -- doctor --fix  # Auto-fix what's possible
npm run jarvis -- config      # View configuration

# Running
npm start                     # Start daemon + dashboard
npm run daemon                # Start daemon only
npm run dashboard             # Start dashboard only

# Operations
npm run ops:health            # Ops health check
npm run ops:backup            # Create backup bundle
npm run ops:recover           # Restore from backup
```

## Security

Jarvis is designed as a **local operator appliance**, not a cloud service.

- **Localhost by default**: Dashboard API binds to `127.0.0.1` (override with `JARVIS_BIND_HOST`)
- **Token auth**: API requires Bearer tokens. `init-jarvis.ts` generates one automatically on first run
- **Fail-closed**: Production/appliance mode blocks startup without tokens. Dev mode allows read-only access only
- **Appliance mode**: Set `appliance_mode: true` in config for strict enforcement (tokens required, webhook secrets checked)
- **No side-door execution**: Chat and Telegram surfaces are read-only — no shell, file writes, or email sending. All mutations flow through the approval-backed runtime kernel
- **Rate limiting**: Auth failures trigger IP blocking after repeated attempts

See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) for trust boundaries and [docs/KNOWN-TRUST-GAPS.md](docs/KNOWN-TRUST-GAPS.md) for what's not yet enforced.

## Configuration

Config lives at `~/.jarvis/config.json`. The init script creates it with a secure token. Use the setup wizard to add integrations:

```json
{
  "api_token": "generated-on-init",
  "lmstudio_url": "http://localhost:1234",
  "default_model": "auto",
  "adapter_mode": "real",
  "poll_interval_ms": 60000,
  "max_concurrent": 2,
  "log_level": "info",
  "appliance_mode": false
}
```

Environment variables override config file values. See `.env.example` for all options.

## Development

```bash
npm run check              # Full pipeline: contracts + tests + build
npm test                   # Run tests (125 files, 2860+ tests)
npm run build              # TypeScript compilation
npm run validate:contracts # Schema + example validation (144 job types)
npm run dashboard:dev      # Dashboard dev mode (hot reload)
npm run smoke:runtime      # OpenClaw + LM Studio integration smoke test
```

## Docker

```bash
# Build and run
docker compose up -d

# Jarvis connects to Ollama/LM Studio on the host machine
# Make sure your model runtime is running before starting
```

## Troubleshooting

**"Jarvis cannot start -- setup required"**
Run `npm run jarvis setup` to initialize databases and config.

**Dashboard shows "Not Built" page**
Run `npm run dashboard:build` then refresh.

**"No model runtime detected"**
Install [Ollama](https://ollama.com) and run `ollama serve`, or start [LM Studio](https://lmstudio.ai).

**Agent run times out on approval**
Check the dashboard approvals page, or use the Telegram bot to approve/reject.

**Database corruption**
```bash
npm run ops:backup         # Backup current state
npm run jarvis -- doctor --fix  # Attempt auto-repair
# If that fails:
rm ~/.jarvis/runtime.db    # Delete and reinit
npm run jarvis setup
```

**Port 4242 already in use**
Set `PORT=4243` in your `.env` file.

For more help: `npm run jarvis -- doctor`

## Documentation

| Document | Description |
|---|---|
| [USAGE.md](docs/USAGE.md) | Detailed agent usage with examples, Telegram setup, CRM guide |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Five-plane architecture, database layout, execution model |
| [PRODUCTION-TARGET.md](docs/PRODUCTION-TARGET.md) | Deployment model, trust boundaries, non-goals |
| [RELEASE-GATES.md](docs/RELEASE-GATES.md) | Five release gates (A-E) with pass criteria |
| [THREAT-MODEL.md](docs/THREAT-MODEL.md) | Trust boundaries, attack vectors, security invariants |
| [KNOWN-TRUST-GAPS.md](docs/KNOWN-TRUST-GAPS.md) | Honest list of what's not yet enforced |
| [ADR-CHAT-SURFACES.md](docs/ADR-CHAT-SURFACES.md) | Why chat/godmode have separate LLM loops |
| [OPERATOR-RUNBOOK.md](docs/OPERATOR-RUNBOOK.md) | Secure installation, daily ops, failure recovery |
| [GLOSSARY.md](docs/GLOSSARY.md) | Canonical vocabulary (agent, plugin, worker, job, run, etc.) |
| [WHAT-JARVIS-IS-NOT.md](docs/WHAT-JARVIS-IS-NOT.md) | Explicit non-goals and boundaries |
| [LIFECYCLE-DIAGRAMS.md](docs/LIFECYCLE-DIAGRAMS.md) | Mermaid state machines for runs, approvals, jobs |
| [ARCHITECTURE-STATUS.md](docs/ARCHITECTURE-STATUS.md) | Target design vs shipped implementation comparison |
| [alpha-operating-guide.md](docs/alpha-operating-guide.md) | Daily workflow, failure taxonomy, metrics |

### Specs

| Spec | Description |
|---|---|
| [jarvis-plugin-api-v1.md](docs/specs/jarvis-plugin-api-v1.md) | Plugin SDK contract and tool registration |
| [jarvis-device-agent-v1.md](docs/specs/jarvis-device-agent-v1.md) | Device control plugin specification |
| [local-model-runtime-strategy.md](docs/specs/local-model-runtime-strategy.md) | LM Studio/Ollama integration and model selection |
| [v1-workflows.md](docs/specs/v1-workflows.md) | Five production workflows |

### Runbooks

| Runbook | Description |
|---|---|
| [jarvis-recovery.md](docs/runbooks/jarvis-recovery.md) | Recovery procedures, backup/restore |
| [openclaw-lmstudio-smoke.md](docs/runbooks/openclaw-lmstudio-smoke.md) | Integration smoke test harness |

## License

[MIT](LICENSE) - Thinking in Code (Daniel Turcu)
