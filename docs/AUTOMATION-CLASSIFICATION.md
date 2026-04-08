# Automation Classification Matrix

Maps daemon/scheduler responsibilities to ownership: Jarvis domain logic vs OpenClaw platform automation. See CONVERGENCE-ROADMAP.md Epic 7.

## Classification Rules

- **Domain automation**: Encoded in agent definitions, job contracts, or approval policy. Stays in Jarvis.
- **Platform automation**: Generic scheduling, polling, health checks, process management. Can delegate to OpenClaw.
- **Shared**: Both sides have legitimate interest. Jarvis defines semantics; OpenClaw provides the substrate.

## Daemon Responsibilities

| Responsibility | Current Owner | Classification | Convergence Target |
|---|---|---|---|
| **Claim queued agent_commands** | daemon.ts polling loop | Domain | Keep in Jarvis — domain command interpretation |
| **Check due schedules** | daemon.ts + scheduler | Shared | Jarvis defines schedule semantics; OpenClaw could provide the cron trigger |
| **Enqueue to AgentQueue** | daemon.ts | Domain | Keep in Jarvis — queue prioritization, resource locks |
| **Process agent queue** | daemon.ts orchestrator | Domain | Keep in Jarvis — concurrency limits, agent lifecycle |
| **Write heartbeats** | daemon.ts (every 10s) | Platform | Could be OpenClaw health probe, but low value to migrate |
| **Model rediscovery** | daemon.ts maintenance | Domain | Keep — Jarvis-specific model registry |
| **Dead letter checks** | daemon.ts maintenance | Shared | Jarvis defines what's dead; trigger could be OpenClaw |
| **Stale claim recovery** | daemon.ts maintenance | Shared | Jarvis defines recovery semantics; trigger could be OpenClaw |
| **Config reload** | daemon.ts | Platform | Could be OpenClaw lifecycle hook |
| **Graceful shutdown** | daemon.ts SIGINT/SIGTERM | Platform | Standard process management |

## Scheduler Responsibilities

| Responsibility | Current Owner | Classification | Convergence Target |
|---|---|---|---|
| **Cron schedule evaluation** | jarvis-scheduler | Shared | Jarvis defines when agents should run; OpenClaw could fire the trigger |
| **Schedule persistence** | runtime.db `schedules` table | Domain | Keep — agent schedule metadata is domain state |
| **Next-run calculation** | scheduler | Shared | Pure logic, could be OpenClaw TaskFlow |
| **Schedule CRUD** | scheduler tools | Domain | Keep — agent-specific scheduling semantics |

## Recommended Delegation

### High Value (migrate to OpenClaw)

1. **Cron trigger firing** — OpenClaw TaskFlow or webhook-triggered schedules replace the daemon's polling loop for time-based triggers. Jarvis keeps the schedule definitions; OpenClaw fires at the right time.

2. **External event routing** — Already addressed by Epic 4 (webhook convergence). External events enter via OpenClaw, not via dashboard webhook routes.

3. **Generic health monitoring** — Heartbeats and liveness checks could use OpenClaw's health infrastructure, but the migration value is low.

### Keep in Jarvis (domain-specific)

1. **Agent command interpretation** — What happens when a command is claimed is entirely domain logic.
2. **Queue management** — Priority, concurrency, resource locks, agent lifecycle are Jarvis-specific.
3. **Model rediscovery** — Local LLM model probing is Jarvis-specific.
4. **Dead letter/recovery semantics** — What constitutes a dead letter and how to recover are domain decisions.

### Keep But Thin

1. **The daemon polling loop itself** — Should become thinner as more triggers come from OpenClaw (webhooks, schedules) rather than daemon-internal polling. The daemon's role shifts from "poll everything" to "react to triggers + manage domain queue."

2. **Maintenance cycles** — Stale claim recovery, config reload, etc. can remain daemon-internal but run less frequently if OpenClaw surfaces provide better triggers.

## Migration Sequence

1. First: external event triggers move to OpenClaw (Epic 4 — already addressed)
2. Then: time-based schedule triggers can use OpenClaw cron/TaskFlow
3. Then: daemon loop frequency can decrease (from frequent poll to event-reactive + periodic sweep)
4. Finally: daemon becomes a pure domain kernel — reacts to OpenClaw events and manages the agent queue

The daemon is never deleted. It becomes thinner — less platform automation, more domain orchestration.
