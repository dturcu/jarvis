# ADR: Chat and Godmode Surface Architecture

**Status**: Decided (April 2026)
**Context**: Jarvis has two interactive chat surfaces beyond the runtime kernel: `/api/chat/telegram` and `/api/godmode`. This document records what they are, what they are not, and why they exist as separate surfaces.

## Decision

### /api/chat/telegram — Read-Only Copilot Surface

**What it is**: A read-only copilot surface with its own LLM function-calling loop. It can search the web, read files (within project root), query CRM and knowledge DBs, search and read Gmail, and check agent status.

**What it is NOT**: An execution surface. It cannot:
- Trigger agents (removed: trigger_agent requires operator role via /slash commands)
- Send or reply to emails (removed: must go through approval-backed job pipeline)
- Write files or run commands (removed: direct privileged execution eliminated)
- Modify CRM, knowledge, or any persistent state

**Why it has its own LLM loop**: The Telegram relay needs native function calling (tool_calls) for interactive multi-turn Q&A with live data. The runtime kernel's orchestrator is designed for structured agent plans, not interactive chat. These are different interaction models.

**Why this is acceptable**: Every tool in the function-calling loop is read-only and comes from tool-infra.ts. The surface cannot mutate state. Agent triggering requires explicit /slash commands through the Telegram command handler, which routes through createCommand() in the kernel.

**What would make this better**: Replacing the separate LLM loop with a "read-only query agent" registered in the kernel, so all inference flows through one path. This is a future convergence target, not a current priority.

### /api/godmode — Read-Only Research Surface

**What it is**: An interactive research and artifact generation surface with its own LLM streaming loop. It classifies user intent (chat, research, artifact, code, cowork), selects surface-specific system prompts, and uses read-only tools from tool-infra.ts.

**What it is NOT**: An execution surface. Same constraints as /api/chat/telegram — no mutations, no agent triggering, no file writing, no email sending.

**Why it has its own LLM loop**: Godmode serves a different UX model than the kernel — multi-surface SSE streaming with artifact extraction, intent classification, and research synthesis. The kernel orchestrator is not designed for this interaction pattern.

**Why this is acceptable**: Same as /api/chat/telegram — all tools are read-only, no mutations possible, documented clearly in the file header.

**What would make this better**: Same convergence path — a "research agent" in the kernel with streaming support. Future work.

## Consequences

- Two chat surfaces exist alongside the runtime kernel. Both are read-only.
- The kernel is the sole authority for mutations, approvals, and agent execution.
- Chat surfaces are thin ingress adapters for interactive queries, not competing execution engines.
- This is an explicit architectural compromise, not an oversight.

## Review Trigger

Revisit this decision when:
- The kernel gains a streaming query interface suitable for interactive chat
- A security audit identifies read-only tool access as insufficient isolation
- The maintenance cost of two separate LLM loops exceeds the UX benefit
