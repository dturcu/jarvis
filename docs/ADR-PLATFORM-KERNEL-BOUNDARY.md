# ADR: Platform/Kernel Boundary — OpenClaw as Substrate, Jarvis as Domain Kernel

**Status**: Decided (April 2026)
**Supersedes**: Portions of ADR-CHAT-SURFACES.md (which documented the compromise; this ADR replaces that compromise with a convergence target)

## Context

Jarvis runs as a plugin pack on OpenClaw. The plugin API spec (jarvis-plugin-api-v1.md) already declares the correct ownership boundary:

- **OpenClaw owns**: sessions, session keys, channel connections, routing, Telegram delivery, browser runtime, web search/fetch, exec, session primitives, approval pauses via hooks
- **Jarvis owns**: policies, approvals, jarvis.v1 contracts, CRM/knowledge/runtime state, typed workers, domain agents

However, the implementation still duplicates four platform capabilities that should be owned solely by OpenClaw:

1. **Telegram transport** — `packages/jarvis-telegram` directly polls and sends via `api.telegram.org`
2. **Webhook ingress** — `packages/jarvis-dashboard/src/api/webhooks.ts` owns external trigger ingress with direct DB writes
3. **Operator LLM orchestration** — `packages/jarvis-dashboard/src/api/godmode.ts` runs its own chat-completions loop against LM Studio
4. **Browser runtime** — `packages/jarvis-browser-worker` directly owns Chrome via Puppeteer/CDP on port 9222

This ADR codifies the convergence target and the rules that prevent new duplication.

## Decision

### Hard Boundary Rules

1. **Only OpenClaw talks to Telegram.** Jarvis plugins use `sessions_send`, `sessions_spawn`, and `dispatch_*` tools to reach operators. No Jarvis package may import a Telegram SDK or call `api.telegram.org`.

2. **Only OpenClaw owns external ingress.** Webhooks, cron triggers, and external events enter through OpenClaw webhook/TaskFlow surfaces. Jarvis may define how to interpret normalized events, but does not own the HTTP listener or signature validation for external triggers.

3. **Only OpenClaw owns the operator chat loop.** Interactive operator chat (streaming, tool calls, intent classification) flows through OpenClaw sessions. Jarvis may register read-only tools and policy hooks, but does not maintain its own chat-completions orchestration.

4. **Only OpenClaw owns browser runtime.** Browser lifecycle, profile management, and CDP connections are OpenClaw's responsibility. Jarvis defines browser job contracts (`browser.run_task`, `browser.extract`, etc.) and submits them through the job queue. Jarvis workers do not directly connect to Chrome.

5. **Jarvis owns domain policy and typed execution.** The approval model, job contracts, domain agents, CRM, knowledge, runtime state, and worker orchestration are Jarvis's responsibility. OpenClaw does not define domain-specific job semantics or approval rules.

6. **Jarvis owns durable domain state.** `runtime.db`, `crm.db`, and `knowledge.db` are Jarvis's source of truth. OpenClaw session state is complementary (conversation continuity), not a replacement for domain truth.

### Forbidden Integration Patterns

The following patterns are **forbidden** in new code and scheduled for removal in existing code:

| Pattern | Why | Detection |
|---|---|---|
| Direct `api.telegram.org` HTTP calls from Jarvis | Duplicates OpenClaw channel ownership | Import/URL grep |
| Direct `fetch("http://localhost:1234/v1/chat/completions")` from dashboard API | Duplicates OpenClaw session/inference ownership | Import/URL grep |
| Direct Puppeteer/CDP `connect()` from Jarvis workers for primary browser flows | Duplicates OpenClaw browser runtime ownership | Import grep |
| Dashboard Express routes accepting external webhook POST with direct DB insert | Duplicates OpenClaw webhook ingress | Route + DB write pattern |
| Any Jarvis package importing `node-telegram-bot-api` or equivalent | Direct Telegram SDK usage | Package import grep |

### Allowed Integration Patterns

| Pattern | Example | Why |
|---|---|---|
| Jarvis plugin registers tools via `definePluginEntry` | `@jarvis/core` registering `jarvis_plan` | Standard OpenClaw plugin API |
| Jarvis plugin registers `before_tool_call` hooks | Approval gating in `@jarvis/core` | OpenClaw hook API |
| Jarvis uses `sessions_send` / `sessions_spawn` for delivery | `@jarvis/dispatch` sending completions | OpenClaw session API |
| Jarvis submits jobs to its own queue via plugin tools | `job_submit` in `@jarvis/jobs` | Jarvis-owned domain layer |
| Workers claim/callback via Jarvis HTTP routes | `POST /jarvis/jobs/claim` | Jarvis-owned worker contract |
| Dashboard reads OpenClaw session state for UI | Session history display | Read-only OpenClaw client |

## Package Migration Map

Every package in the monorepo is assigned one of four statuses:

### Core (keep and harden)

These packages embody Jarvis's domain value. They stay and get stronger.

| Package | Role |
|---|---|
| `@jarvis/core` | Policy engine, approvals, model selection, planning |
| `@jarvis/jobs` | Job queue, claim/heartbeat/callback, artifact registry |
| `@jarvis/dispatch` | Cross-session delivery via OpenClaw sessions |
| `@jarvis/shared` | Base types, OpenClaw SDK bridge |
| `@jarvis/agent-framework` | Agent runtime, memory, knowledge, entity graph |
| `@jarvis/agents` | 14 agent definitions and system prompts |
| `@jarvis/runtime` | Daemon, orchestrator, run lifecycle (thinned) |
| `@jarvis/scheduler` | Domain-specific scheduling (thinned) |
| `@jarvis/supervisor` | Process supervision |
| `@jarvis/inference` | Model registry, selection, task profiles |
| `@jarvis/security` | Security policy, audit |
| `@jarvis/observability` | Metrics, tracing |
| `@jarvis/office` | Office job compilation |
| `@jarvis/device` | Device observation/control via desktop host worker |
| `@jarvis/files` | Scoped filesystem operations |
| `@jarvis/interpreter` | Code execution sandbox |
| `@jarvis/voice` | Voice processing |
| `@jarvis/system` | System monitoring |

### Core Workers (keep, may need adapter changes)

| Package | Role | Convergence Notes |
|---|---|---|
| `@jarvis/agent-worker` | Agent execution | Keep |
| `@jarvis/email-worker` | Email operations | Keep |
| `@jarvis/calendar-worker` | Calendar operations | Keep |
| `@jarvis/crm-worker` | CRM operations | Keep |
| `@jarvis/web-worker` | Web scraping/search | Keep |
| `@jarvis/document-worker` | Document processing | Keep |
| `@jarvis/office-worker` | Office file processing | Keep |
| `@jarvis/inference-worker` | LLM inference delegation | Keep |
| `@jarvis/interpreter-worker` | Code sandbox | Keep |
| `@jarvis/security-worker` | Security scanning | Keep |
| `@jarvis/system-worker` | System monitoring | Keep |
| `@jarvis/voice-worker` | Voice transcription | Keep |
| `@jarvis/social-worker` | Social media | Keep |
| `@jarvis/time-worker` | Time/scheduling | Keep |
| `@jarvis/drive-worker` | Drive watching | Keep |
| `@jarvis/desktop-host-worker` | Windows desktop automation | Keep |

### Core Plugins (keep)

| Package | Role |
|---|---|
| `@jarvis/agent-plugin` | Agent management tools |
| `@jarvis/email-plugin` | Email tools |
| `@jarvis/calendar-plugin` | Calendar tools |
| `@jarvis/crm-plugin` | CRM tools |
| `@jarvis/web-plugin` | Web tools |
| `@jarvis/document-plugin` | Document tools |

### Adapter (wrap then replace)

These packages currently duplicate platform capabilities. They will be wrapped behind OpenClaw-native interfaces, then the direct implementation removed.

| Package | Current Role | Target | Timeline |
|---|---|---|---|
| `@jarvis/browser` | Browser job contracts | Keep contracts, remove runtime ownership | Y1-Q4 |
| `@jarvis/browser-worker` | Direct Chrome/Puppeteer | Replace with OpenClaw browser bridge | Y1-Q4 |

### Deprecated (replace then delete)

These packages duplicate platform ownership and will be removed once convergence is complete.

| Package | Current Role | Replacement | Timeline |
|---|---|---|---|
| `@jarvis/telegram` | Direct Telegram polling/sending | OpenClaw native Telegram channel | Y1-Q2 |
| `jarvis-dashboard` (webhook routes) | External trigger HTTP ingress | OpenClaw webhook/TaskFlow ingress | Y1-Q2 |
| `jarvis-dashboard` (godmode LLM loop) | Direct LM Studio orchestration | OpenClaw session-backed operator chat | Y1-Q3 |
| `jarvis-dashboard` (chat/telegram LLM loop) | Direct LM Studio for Telegram relay | OpenClaw session-backed query | Y1-Q3 |

### Services (evolve)

| Package | Role | Convergence Notes |
|---|---|---|
| `jarvis-dashboard` | React web dashboard + API | Keep UI; thin API to OpenClaw session client |
| `jarvis-telegram` | Telegram bot | Replace with OpenClaw channel config |

## Consequences

- Four duplicate ownership paths are explicitly scheduled for removal
- CI will enforce the forbidden patterns, preventing regression
- New code must use the allowed patterns or get an explicit ADR exception
- The existing ADR-CHAT-SURFACES.md compromise (separate LLM loops acceptable) is superseded by a convergence commitment
- The ROADMAP.md quarterly plan aligns with this boundary

## Review Trigger

Revisit this decision when:
- OpenClaw's session API gains a feature that makes a Jarvis-side workaround unnecessary
- A new Jarvis capability needs platform-level integration not covered here
- The convergence timeline needs adjustment based on OpenClaw release cadence
