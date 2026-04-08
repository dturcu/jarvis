# Convergence Roadmap: OpenClaw Substrate + Jarvis Domain Kernel

This document maps the 12 convergence epics onto the quarterly plan. It complements ROADMAP.md (which focuses on product milestones) with the platform/kernel convergence program defined in ADR-PLATFORM-KERNEL-BOUNDARY.md.

## Architectural Rule

OpenClaw owns channels, sessions, browser lifecycle, webhook ingress, automation surfaces, and the primary operator chat loop. Jarvis owns domain policy, approvals, jarvis.v1 contracts, CRM/knowledge/runtime state, and specialized workers.

## Epic Map

| # | Epic | Quarter | Primary Packages | Exit Criteria |
|---|---|---|---|---|
| 1 | Architecture Boundary Codification | Y1-Q1 | docs/, tests/, CI | ADR published, CI enforces forbidden patterns, migration map complete |
| 2 | OpenClaw Runtime Upgrade | Y1-Q1 | root, scripts/, plugins | Jarvis boots on current OpenClaw, compatibility matrix published |
| 3 | Channel Ownership Convergence | Y1-Q2 | jarvis-telegram, jarvis-dispatch | Zero primary-path Telegram API calls from Jarvis |
| 4 | Webhook Ingress Convergence | Y1-Q2 | jarvis-dashboard/webhooks | Zero primary-path dashboard-owned webhook ingress |
| 5 | Operator Chat Unification | Y1-Q3 | jarvis-dashboard/godmode, chat | Zero primary-path direct LM Studio operator loops |
| 6 | Browser Ownership Convergence | Y1-Q4 | jarvis-browser-worker, jarvis-browser | Zero primary-path direct browser runtime ownership |
| 7 | Automation & TaskFlow Convergence | Y2-Q1 | jarvis-runtime/daemon, jarvis-scheduler | Generic automation delegates to OpenClaw; daemon thinned |
| 8 | Approval & Hook Consolidation | Y2-Q1 | jarvis-core, jarvis-runtime | Multiple hook points active; policy centralized |
| 9 | Session Memory & Knowledge Roles | Y2-Q2 | jarvis-dashboard, agent-framework | Memory taxonomy ADR; session compaction operational |
| 10 | Security Gap Closure | Y2-Q3 | jarvis-runtime, config, audit | Encrypted credentials; credential-access audit; fuller provenance |
| 11 | Packaging & Release Train | Y3-Q1 | scripts/, plugin loader | Reliable install/upgrade/rollback; compatibility checks |
| 12 | Dead Code Removal & Conformance | Y3-Q2+ | All deprecated surfaces | Codebase smaller; docs match implementation |

## Year 1: Architecture Convergence and Duplicate Removal

### Q1: Boundary Codification + OpenClaw Upgrade (Epics 1-2)

**Deliverables:**
- ADR-PLATFORM-KERNEL-BOUNDARY.md (done)
- Architecture boundary tests in CI (done)
- OpenClaw upgrade to current stable release
- Compatibility matrix for plugin SDK
- Package migration map with status assignments

**Acceptance:**
- CI fails on forbidden import/URL patterns
- Jarvis boots and passes smoke tests on new OpenClaw
- Every package has assigned status: core, adapter, compatibility, deprecated

### Q2: Channel + Webhook Convergence (Epics 3-4)

**Deliverables:**
- OpenClaw-native channel adapter replacing `jarvis-telegram`
- Approval notifications via `sessions_send` / `dispatch_*`
- Command routing via OpenClaw session commands
- Webhook ingress via OpenClaw webhook/TaskFlow surfaces
- Normalized event-to-agent mapping layer

**Acceptance:**
- No primary-path `api.telegram.org` calls from Jarvis
- No primary-path dashboard webhook routes writing into `agent_commands`
- Approvals, notifications, commands still work end-to-end
- Architecture boundary tests still pass (legacy exclusions narrowed)

### Q3: Operator Chat Unification (Epic 5)

**Deliverables:**
- Operator chat gateway on OpenClaw sessions
- Godmode refactored as session client
- Read-only tool policy preserved on session layer
- Session-backed history replacing custom history

**Acceptance:**
- No primary-path direct LM Studio chat-completions loop in dashboard API
- Operator chat still supports streaming, artifacts, research mode
- Session state survives restart via OpenClaw semantics

### Q4: Browser Convergence (Epic 6)

**Deliverables:**
- OpenClaw browser bridge/adapter
- Browser job types re-mapped to managed profiles
- chrome-adapter.ts replaced or behind bridge
- Evidence artifact flow preserved

**Acceptance:**
- No primary-path direct browser ownership in Jarvis
- Browser tasks produce equivalent artifacts
- Approval enforcement still works for risky browser actions

### Progress (as of Wave 8 -- Final Cleanup)

| Duplication Target | Status | Notes |
|---|---|---|
| Webhook ingress | **Eliminated** | `webhooks.ts` deleted; v2 normalizer serves both paths |
| Telegram transport | **Session default** | Session mode is default; legacy available via `JARVIS_TELEGRAM_MODE=legacy` |
| Operator chat (godmode) | **Session default** | Session-backed adapter at `/api/godmode`; legacy at `/api/godmode/legacy`. All direct LM Studio functions in `godmode.ts` marked `@deprecated`. |
| Browser runtime | **OpenClaw default** | OpenClaw bridge is default; legacy available via `JARVIS_BROWSER_MODE=legacy` |

**Wave 8 cleanup completed:**
- All direct LM Studio call functions (`llmChat`, `streamLlm`, `classifyIntent`) in `godmode.ts` marked `@deprecated` with JSDoc
- Dead imports removed (`deprecated-bot`, `claude-fallback` references verified absent)
- Stale `/api/godmode/v2` path references cleaned from doc comments
- `CLAUDE.md` convergence section added with final status table
- `ARCHITECTURE-STATUS.md` updated to reflect session-backed adapter as primary path

**Year 1 Success Metric:** Four primary-path duplications eliminated. The biggest duplications (Telegram, webhooks, operator chat, browser) are gone or behind thin compatibility bridges. Legacy paths remain available via env vars for rollback safety.

## Year 2: Operational Strength

### Q5: Automation + Hook Consolidation (Epics 7-8)

- Daemon thinned; generic automation delegates to OpenClaw TaskFlow
- Hook catalog expanded beyond single `before_tool_call`
- Policy middleware standardized for mutating actions, reply guardrails, provenance

### Q6: Session Memory + Knowledge (Epic 9)

- Memory taxonomy ADR published
- OpenClaw compaction/checkpoint operational for operator sessions
- Jarvis stores remain authoritative for domain state

### Q7: Security Gap Closure (Epic 10)

- Credential storage hardened (encrypted or OS keystore)
- Credential-access audit logging
- Fuller provenance for channel deliveries and artifacts

### Q8: Product Hardening

- Compatibility shim removal
- Dead code deletion from old paths
- Dashboard API simplification
- Reduced places for accidental boundary bypass

**Year 2 Success Metric:** 80-90% of operator interactions flow through OpenClaw sessions. Architecture is stable, not aspirational.

## Year 3: Durable Product Platform

### Q9-12: Packaging, Extension, Controls, Consolidation (Epics 11-12)

- Reliable install/upgrade/rollback
- Plugin compatibility enforcement
- Final deprecated path removal
- Remaining Jarvis code reads as domain product, not second agent platform

**Year 3 Success Metric:** Codebase smaller in duplicated platform ownership than Year 1 start. New engineer can tell in minutes which layer owns what.

## Cross-Epic Definition of Done

Five global exit conditions for the full program:

1. Zero primary-path direct Telegram transport owned by Jarvis
2. Zero primary-path dashboard-owned public webhook ingress writing to runtime state
3. Zero primary-path direct dashboard-to-model orchestration outside approved inference boundary
4. Zero primary-path direct browser runtime ownership for managed browser workflows
5. Zero undocumented boundary exceptions between OpenClaw and Jarvis

## Capacity Split

| Year | Convergence/Deletion | Hardening/Quality | Packaging/Features |
|---|---|---|---|
| Y1 | 40% | 30% | 30% |
| Y2 | 20% | 40% | 40% |
| Y3 | 10% | 30% | 60% |

## Management Constraint

Each quarter needs **deletions**, not just wrappers. The program succeeds only if the codebase ends each year smaller in duplicated platform ownership than it was at the start.
