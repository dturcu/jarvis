# ADR: Memory Taxonomy — Session State vs Domain Knowledge

**Status**: Decided (April 2026, advanced from Proposed per Epic 1 of Platform Adoption Roadmap)
**Context**: The convergence from direct LLM loops to OpenClaw session-backed operator chat creates a need to clarify what belongs in OpenClaw session memory versus Jarvis durable domain knowledge.

## Problem

Today Jarvis has two distinct memory systems that don't interact:

1. **Jarvis domain state** — SQLite-backed in `runtime.db`, `crm.db`, `knowledge.db`:
   - Agent memory (short-term per-run + long-term persistent)
   - CRM contacts, notes, pipeline stages
   - Knowledge documents, playbooks, entities, relations, decisions
   - Run history, approvals, audit log
   - Lessons captured from completed runs

2. **Conversation state** — currently in-process or custom history:
   - Telegram: durable via ChannelStore (thread-scoped messages)
   - Dashboard/godmode: per-session SSE streaming state
   - No compaction, no checkpoints, no branch/restore

When operator chat moves to OpenClaw sessions (Epic 5), a third memory layer appears:
3. **OpenClaw session state** — compaction, checkpoints, branch/restore, memory-wiki

Without clear taxonomy, facts will be stored in the wrong place, creating fragmentation.

## Decision

### Memory Categories

| Category | Description | Owner | Store | Lifecycle |
|---|---|---|---|---|
| **Conversation context** | What was said in the current operator chat session | OpenClaw | Session state + compaction | Session-scoped, compacted over time |
| **Run state** | Active runs, their progress, intermediate results | Jarvis | `runtime.db` | Run-scoped, persists after completion |
| **Domain facts** | CRM contacts, pipeline stages, entity relationships | Jarvis | `crm.db`, `knowledge.db` | Persistent, updated by agent runs |
| **Operational knowledge** | Lessons, decisions, playbooks, work products | Jarvis | `knowledge.db` | Persistent, curated by agents |
| **Audit trail** | Who did what, when, through which channel | Jarvis | `runtime.db` audit_log | Append-only, never deleted |
| **Operator preferences** | Operator-level settings, recent context, working memory | OpenClaw | Session checkpoints / memory-wiki | Long-lived, operator-scoped |

### Translation Rules

When information crosses boundaries between conversation and domain:

1. **Session to Domain**: When an operator conversation produces a domain-relevant fact (new contact, pipeline decision, lesson), the agent must explicitly write it to the appropriate Jarvis store. Session compaction summaries are not a substitute for structured domain writes.

2. **Domain to Session**: When an operator asks about domain state, the session should query Jarvis stores (via read-only tools), not rely on stale session summaries. Domain truth lives in Jarvis DBs.

3. **Session Summaries**: OpenClaw compaction summaries capture conversation intent and flow. They should reference Jarvis entities by ID (run_id, contact_id, etc.) rather than duplicating facts.

4. **Checkpoint/Restore**: Restoring a session checkpoint resumes conversation context but does not roll back domain state. Jarvis state may have advanced since the checkpoint.

### What Goes Where (Decision Guide)

Ask: "Would a different operator need this information?"

- **Yes, and it's a fact** → Jarvis knowledge.db (entity, document, lesson)
- **Yes, and it's about a person/company** → Jarvis crm.db (contact, note, stage)
- **Yes, and it's about a run/decision** → Jarvis runtime.db (run, approval, audit)
- **No, it's about this conversation** → OpenClaw session state
- **No, but I want it next time I chat** → OpenClaw operator preferences / memory-wiki

### Retention Rules

| Store | Retention | Backup |
|---|---|---|
| `runtime.db` | Indefinite (core audit trail) | Daily backup via ops:backup |
| `crm.db` | Indefinite (business data) | Daily backup via ops:backup |
| `knowledge.db` | Indefinite (institutional knowledge) | Daily backup via ops:backup |
| OpenClaw sessions | Compacted per OpenClaw policy | Session checkpoints |
| OpenClaw memory-wiki | Persistent within OpenClaw | OpenClaw managed |

## Consequences

- Operators get persistent conversation continuity via OpenClaw sessions without Jarvis reimplementing session management
- Domain facts remain authoritative in Jarvis SQLite stores
- No ambiguity about where a fact should live
- Session restore does not create domain state inconsistencies
- Compaction can aggressively summarize conversation turns without losing domain traceability

## Review Trigger

Revisit when:
- OpenClaw memory-wiki gains structured query capabilities
- Knowledge.db gains conversation-aware retrieval
- Multi-operator scenarios create ownership conflicts in session state
