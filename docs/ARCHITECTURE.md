# Architecture

## System Shape

Jarvis is a single-node autonomous agent system. It runs on one Windows development machine with local LLM inference. The architecture has five planes:

```
Operator Plane          Control Plane           Execution Plane
 dashboard               runtime.db              daemon process
 CLI (jarvis)             command queue            orchestrator
 health/status            run lifecycle            worker registry
 backup/restore           approvals                isolated workers
 auth                     audit log                agent queue
                          heartbeats
                          notifications

Inference Plane         Knowledge Plane
 Ollama / LM Studio      crm.db
 model registry           knowledge.db
 benchmark cache          entity graph
 selection engine         lessons / playbooks
 task profiles            RAG index
```

## Database Layout

Three SQLite databases, each with a distinct purpose:

| Database | Purpose | Managed By |
|---|---|---|
| `~/.jarvis/runtime.db` | Control-plane state: commands, runs, approvals, heartbeats, notifications, audit, schedules, model registry, agent memory, settings | Migration framework |
| `~/.jarvis/crm.db` | CRM pipeline: contacts, notes, stage history | init-jarvis.ts |
| `~/.jarvis/knowledge.db` | Domain knowledge: documents, playbooks, entities, relations, decisions | init-jarvis.ts |

All databases use WAL mode for concurrent read/write safety between daemon and dashboard processes.

## Control Plane (runtime.db)

The control plane is the durable coordination layer. All runtime truth lives here.

### Tables

| Table | Replaces | Purpose |
|---|---|---|
| `agent_commands` | trigger-*.json files | Durable command queue. Webhook/manual/schedule triggers insert rows. Daemon claims and processes them. |
| `approvals` | approvals.json | Approval requests with status tracking. Polled by daemon, resolved by dashboard/Telegram. |
| `run_events` | (in-memory only) | Every run transition emits an event. Enables replay, diagnosis, and audit. |
| `daemon_heartbeats` | daemon-status.json | Daemon liveness. UPSERT every 10s. Stale = daemon dead. |
| `notifications` | telegram-queue.json | Outbound notification queue with delivery status. |
| `schedules` | in-memory SchedulerStore Map | Durable cron schedules. Seeded from agent definitions on first boot. |
| `agent_memory` | in-memory AgentMemoryStore Maps | Short-term (per-run) and long-term (persistent) agent memory. |
| `audit_log` | (none) | Immutable trail of security-sensitive actions. |
| `settings` | (scattered config) | Runtime-configurable settings. |
| `plugin_installs` | filesystem-only manifests | Plugin lifecycle tracking. |
| `model_registry` | (none) | Discovered local models with capabilities. |
| `model_benchmarks` | (none) | Cached benchmark results for evidence-based routing. |

### Deprecated Coordination Mechanisms

The following file-based coordination mechanisms are being removed:

| File | Status | Replaced By |
|---|---|---|
| `~/.jarvis/approvals.json` | **Removed** | `approvals` table in runtime.db |
| `~/.jarvis/trigger-{agent}.json` | **Removed** | `agent_commands` table in runtime.db |
| `~/.jarvis/daemon-status.json` | **Removed** | `daemon_heartbeats` table in runtime.db |
| `~/.jarvis/telegram-queue.json` | **Removed** | `notifications` table in runtime.db |

### Deprecated Model Abstractions

The `haiku` / `sonnet` / `opus` model tier system is **removed**. It was provider-shaped (modeled after Anthropic's Claude tiers) and inappropriate for a local-model-first system.

Replaced by:
- **TaskProfile**: describes what the task needs (objective, constraints, preferences)
- **SelectionPolicy**: describes how to choose a model (fastest_local, balanced_local, best_reasoning_local, etc.)

## Execution Plane

### Daemon Lifecycle

```
Boot
  load + validate config
  open runtime.db + run migrations
  open crm.db + knowledge.db
  register agents + plugins
  seed schedules (first boot only)
  write initial heartbeat
  start polling loop

Run
  single polling loop:
    claim queued agent_commands
    check due schedules
    enqueue to AgentQueue
    process queue (respecting concurrency + resource locks)

Drain (SIGINT/SIGTERM)
  stop accepting new work
  wait for running agents to complete (with timeout)
  flush final heartbeat
  close DB handles
  exit
```

### Run State Machine

```
queued -> planning -> executing -> completed
                  \-> awaiting_approval -> executing
                                      \-> cancelled
         planning -> failed
         executing -> failed
```

Every state transition emits a `run_events` row.

### Worker Isolation

Workers are categorized by risk level:

| Risk | Workers | Isolation |
|---|---|---|
| Low | inference, crm, system, office, time | In-process |
| Medium | email, calendar, drive, web, document | In-process with timeout |
| High | browser, interpreter, social, device, files | Child process with timeout, crash restart, filesystem allowlist |

### Agent Queue

- Max concurrent agents: configurable (default 2)
- The browser resource lock in agent-queue.ts is currently empty. Future agents that require browser access will be registered there
- Queue is priority-ordered, then FIFO
- Drain mode prevents new enqueues

## Inference Plane

### Model Selection

```
Agent definition specifies TaskProfile
  -> SelectionPolicy resolves to a model
     -> pinned: use explicit model from config
     -> fastest_local: smallest available model
     -> balanced_local: mid-range model (7-13B)
     -> best_reasoning_local: largest available model
     -> best_code_local: code-specialized, fallback to largest
     -> json_reliable_local: models with proven JSON output
     -> embedding_local: dedicated embedding models
     -> vision_local: vision-capable models
```

### Model Discovery

- Probes Ollama (localhost:11434) and LM Studio (localhost:1234) at startup
- Discovered models stored in `model_registry` table
- Benchmark results cached in `model_benchmarks` table
- Selection engine consults registry + benchmarks for evidence-based routing

## Knowledge Plane

### CRM Pipeline

```
prospect -> qualified -> contacted -> meeting -> proposal -> negotiation -> won | lost | parked
```

Stage transitions require approval (warning severity).

### Knowledge Collections

lessons, case-studies, proposals, iso26262, contracts, playbooks, garden

### Entity Graph

Cross-agent entity linkage. Entities deduped by canonical key. Relations tracked with provenance.

### Lesson Capture

Post-run extraction of lessons from decision logs. Feeds back into knowledge store for future agent context.

## Approval Model

| Action | Severity | Behavior |
|---|---|---|
| email.send | critical | Always requires human approval |
| publish_post / post_comment | critical | Always requires human approval |
| trade_execute | critical | Always requires human approval |
| crm.move_stage | warning | Requires approval |
| document.generate_report | warning | Requires approval |
| Read-only operations | none | Never requires approval |

## Migration Strategy

- runtime.db uses a migration framework with ordered, versioned migration files
- crm.db and knowledge.db use init-jarvis.ts (CREATE TABLE IF NOT EXISTS)
- Migration convergence (all DBs under migration framework) is a future option, not a current requirement
