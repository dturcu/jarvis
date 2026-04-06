# Jarvis

**Autonomous agent system for [Thinking in Code](https://thinking-in-code.com)** — an automotive safety consulting firm specializing in ISO 26262, ASPICE, AUTOSAR, and cybersecurity.

Jarvis runs 14 domain agents that handle business development, proposal generation, compliance auditing, contract review, staffing, content creation, portfolio management, and more — all powered by local LLMs via Ollama or LM Studio.

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
| Node.js | 22+ | 22 LTS |
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

## Agents

| Agent | What it does | Maturity |
|---|---|---|
| **bd-pipeline** | Scan for BD signals, enrich leads, draft outreach, update CRM | Trusted |
| **proposal-engine** | Analyze RFQ/SOW, build quote structure, draft proposal | High-stakes |
| **evidence-auditor** | Scan project for ISO 26262 work products, produce gap matrix | Trusted |
| **contract-reviewer** | Analyze NDA/MSA clauses, produce sign/negotiate/escalate recommendation | High-stakes |
| **staffing-monitor** | Calculate team utilization, forecast gaps, match skills to pipeline | Operational |
| **content-engine** | Draft LinkedIn post for today's content pillar | Operational |
| **portfolio-monitor** | Check crypto prices, calculate drift, recommend rebalance | Operational |
| **garden-calendar** | Generate weekly garden brief based on date + weather | Operational |
| **email-campaign** | Manage drip campaigns, follow-up sequences | Trusted |
| **social-engagement** | Monitor and respond to social media interactions | Operational |
| **security-monitor** | Track security advisories, vulnerability alerts | Operational |
| **drive-watcher** | Watch shared drives for new/changed documents | Operational |
| **invoice-generator** | Generate and track invoices for client engagements | Trusted |
| **meeting-transcriber** | Transcribe and summarize meeting recordings | Operational |

**Maturity levels:**
- **High-stakes**: Every mutating action requires human approval
- **Trusted**: Runs autonomously, outputs reviewed post-hoc
- **Operational**: Runs on schedule, standard approval gates

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Jarvis Dashboard                      │
│              http://localhost:4242                        │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│  │ CRM  │ │Agents│ │ Runs │ │Models│ │ Chat │          │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘          │
└─────────────────────┬───────────────────────────────────┘
                      │ REST API
┌─────────────────────┴───────────────────────────────────┐
│                   Jarvis Daemon                          │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐               │
│  │Scheduler │ │Orchestrator│ │  Queue   │               │
│  └──────────┘ └───────────┘ └──────────┘               │
│  ┌──────────────────────────────────────┐               │
│  │  Multi-viewpoint Planner             │               │
│  │  single │ critic │ multi             │               │
│  └──────────────────────────────────────┘               │
└──────────┬──────────────────┬───────────────────────────┘
           │                  │
    ┌──────┴──────┐    ┌──────┴──────┐
    │ Ollama      │    │ LM Studio   │
    │ localhost:  │    │ localhost:   │
    │ 11434       │    │ 1234         │
    └─────────────┘    └─────────────┘

Data: ~/.jarvis/
  ├── crm.db         CRM pipeline
  ├── knowledge.db   Knowledge store + entities
  ├── runtime.db     Control plane (runs, approvals, commands)
  └── config.json    Configuration
```

## CLI Reference

```bash
# Getting Started
jarvis setup              # Interactive setup wizard
jarvis doctor             # Check system health
jarvis doctor --fix       # Auto-fix what's possible
jarvis config             # View configuration

# Running
npm start                 # Start daemon + dashboard
jarvis start              # Start daemon only
jarvis dashboard          # Start dashboard only
jarvis stop               # Stop daemon
jarvis status             # Show daemon status
jarvis logs               # Tail daemon logs

# Operations
jarvis backup             # Create backup bundle
jarvis restore            # Restore from backup
jarvis benchmark-models   # Benchmark local models
jarvis health             # Ops health check
jarvis migrate            # Run pending DB migrations
```

## Configuration

Config lives at `~/.jarvis/config.json`. Use the setup wizard or edit directly:

```json
{
  "lmstudio_url": "http://localhost:1234",
  "default_model": "auto",
  "adapter_mode": "real",
  "poll_interval_ms": 60000,
  "max_concurrent": 2,
  "log_level": "info"
}
```

Environment variables override config file values. See `.env.example` for all options.

## Approval Rules

High-stakes actions require human approval before execution:

| Action | Severity | Gate |
|---|---|---|
| `email.send` | Critical | Always requires approval |
| `publish_post` | Critical | Always requires approval |
| `trade_execute` | Critical | Always requires approval |
| `crm.move_stage` | Warning | Requires approval |
| `document.generate_report` | Warning | Requires approval |

Agents with `high_stakes_manual_gate` maturity require approval for **every** mutating action.

## Docker

```bash
# Build and run
docker compose up -d

# Jarvis connects to Ollama/LM Studio on the host machine
# Make sure your model runtime is running before starting
```

## Development

```bash
npm run check              # Full pipeline: contracts + tests + build
npm test                   # Run tests (1019 tests)
npm run build              # TypeScript compilation
npm run dashboard:dev      # Dashboard dev mode (hot reload)
npm run validate:contracts # Schema + example validation
```

## Troubleshooting

**"Jarvis cannot start — setup required"**
Run `npm run jarvis setup` to initialize databases and config.

**Dashboard shows "Not Built" page**
Run `npm run dashboard:build` then refresh.

**"No model runtime detected"**
Install [Ollama](https://ollama.com) and run `ollama serve`, or start [LM Studio](https://lmstudio.ai).

**Agent run times out on approval**
Check the dashboard approvals page, or use the Telegram bot to approve/reject.

**Database corruption**
```bash
jarvis backup              # Backup current state
jarvis doctor --fix        # Attempt auto-repair
# If that fails:
rm ~/.jarvis/runtime.db    # Delete and reinit
jarvis setup
```

**Port 4242 already in use**
Set `PORT=4243` in your `.env` file.

For more help: `jarvis doctor`

## License

[MIT](LICENSE) - Thinking in Code (Daniel Turcu)
