# Platform Adoption Roadmap: Deep OpenClaw Integration

> Supersedes Epics 7-12 of CONVERGENCE-ROADMAP.md.
> Builds on the completed convergence work (Waves 1-8) which eliminated
> four primary-path duplications. This roadmap moves from deduplication
> into deep platform adoption: TaskFlows, `openclaw infer`, memory-wiki,
> dreaming, managed browser profiles, and `/tasks` operator visibility.

**Last updated:** 2026-04-08
**Status:** Approved
**Depends on:** ADR-PLATFORM-KERNEL-BOUNDARY.md (Decided), ADR-MEMORY-TAXONOMY.md (Proposed -> Decided in Epic 1)

## Strategic Goal

At the end of this program, Jarvis should be a domain kernel sitting on top
of OpenClaw's operating substrate. OpenClaw owns session delivery, task/flow
orchestration, webhook ingress, long-horizon operator memory tooling, and
canonical headless inference. Jarvis owns typed domain contracts, CRM/knowledge/
evidence schemas, approval policy, work package logic, and specialized domain
workers.

**Hard rule:** Compliance-grade evidence (contracts, audit trails, safety-case
artifacts, ISO 26262/ASPICE/cybersecurity evidence, signed operational records)
remains authoritatively in Jarvis runtime/CRM/knowledge DBs with cryptographic
signing. OpenClaw memory/wiki/dreaming are for synthesized knowledge, heuristics,
operator notes, and curated summaries only.

## Pre-Conditions and Current State

### Convergence Exit Conditions (from Waves 1-8)

| # | Condition | Status |
|---|-----------|--------|
| 1 | Zero primary-path Telegram from Jarvis | **Pass** |
| 2 | Zero primary-path dashboard webhook ingress | **Partial** (domain logic separated; HTTP surface still dashboard-owned) |
| 3 | Zero primary-path dashboard-to-model orchestration | **Pass** |
| 4 | Zero primary-path browser runtime ownership | **Partial** (high-level bridge-backed; low-level ops still use legacy adapter) |
| 5 | Zero undocumented boundary exceptions | **Pass** |

### Existing Seams (injection points created in Waves 1-8)

- `createWebhookRouter({ onEvent })` — injectable persistence in `packages/jarvis-dashboard/src/api/webhooks-v2.ts`
- `ScheduleTriggerSource` interface — `db` | `external` in `packages/jarvis-runtime/src/schedule-trigger.ts`
- `BrowserBridge` interface — `openclaw` | `legacy` in `packages/jarvis-browser/src/openclaw-bridge.ts`
- `SessionChatAdapter` — session-backed operator chat in `packages/jarvis-dashboard/src/api/session-chat-adapter.ts`
- Transport-agnostic webhook normalizer in `packages/jarvis-shared/src/webhook-normalizer.ts`

### Known Gaps to Address

- **Agent roster is empty** (`ALL_AGENTS = []` in `packages/jarvis-agents/src/registry.ts`). Epics 8-10 require runtime-registered agents producing memory/knowledge writes.
- **Encrypted credentials are unaddressed** (sole "Gap" in ARCHITECTURE-STATUS.md). Plaintext in `~/.jarvis/config.json`. Blocks Gate C.
- **`check:convergence` not in CI** (exists as script but `.github/workflows/ci.yml` does not invoke it).
- **Hook consolidation dropped** — `before_reply`, `after_tool_call`, `on_error` hooks listed in OPENCLAW-COMPATIBILITY-MATRIX.md but not covered by this plan. Folded into Epic 3 as sub-deliverable.

---

## Epic Map

| # | Epic | Year | Complexity | OpenClaw Dependency | Key Blocker |
|---|------|------|-----------|--------------------|----|
| 1 | Convergence Baseline Hardening | Y1 | S-M | None | — |
| 2 | Webhook Ingress Cutover | Y1 | M | Webhook plugin | API availability |
| 3 | TaskFlow Adoption | Y1 | L | TaskFlow | API availability |
| 4 | /tasks Unified Visibility | Y1 | M | None | — |
| 5 | `openclaw infer` Adapter | Y2 | L | `openclaw infer` | API existence unknown |
| 6 | Inference Governance | Y2 | M | Same as Epic 5 | Blocked by Epic 5 |
| 7 | Memory Boundary Enforcement | Y2 | M | None | Agent roster |
| 8 | Controlled Dreaming | Y2 | L | Optional | Agent roster |
| 9 | memory-wiki Deployment | Y3 | M | memory-wiki | API availability |
| 10 | Wiki-Powered Retrieval | Y3 | M | Same as Epic 9 | Blocked by Epic 9 |
| 11 | Browser Profiles & Sandbox | Y3 | L | Browser plugin | Windows sandboxing |
| 12 | Legacy Deletion & Cutover | Y3 | M | All prior epics | — |

---

## Year 1: OpenClaw as Real Control Plane

### Epic 1 — Convergence Baseline Hardening

**Goal:** Fix remaining correctness gaps. Make the convergence branch trustworthy before adopting more platform features.

**Files:**
- `packages/jarvis-dashboard/src/api/session-chat-adapter.ts` — circuit breaker for legacy fallback
- `packages/jarvis-telegram/src/session-adapter.ts` — error recovery on gateway drop
- `packages/jarvis-shared/src/webhook-normalizer.ts` — HMAC edge case tests
- `packages/jarvis-browser/src/openclaw-bridge.ts` — low-level ops via OpenClaw bridge (Exit 4)
- `packages/jarvis-runtime/src/convergence-checks.ts` — new checks
- `tests/convergence-final.test.ts` — behavioral assertions for all 5 exits
- `.github/workflows/ci.yml` — add `npm run check:convergence`
- `docs/ADR-MEMORY-TAXONOMY.md` — advance from Proposed to Decided

**Steps:**
1. Add circuit breaker to `SessionChatAdapter`: 3 failures in 60s = skip gateway probing for 5 minutes. Log structured warning with error reason.
2. Fix `TelegramSessionAdapter.send()` to retry once on gateway drop, then fall back to relay queue (currently throws).
3. Add webhook HMAC edge case tests: empty body, truncated signature, missing `sha256=` prefix, non-hex characters, buffer vs string raw body.
4. Extend `OpenClawBrowserBridge` to route `browser.click`, `.type`, `.evaluate`, `.wait_for` via `invokeGatewayMethod()`. If gateway doesn't support these yet, add a convergence check tracking the gap.
5. Expand `convergence-final.test.ts` with behavioral assertions (not just file deletion checks).
6. Add `npm run check:convergence` to CI workflow.
7. Advance ADR-MEMORY-TAXONOMY.md to "Decided" status.
8. Sub-deliverable: credential encryption design (address the Gate C gap).

**Acceptance:**
- Session-backed `/api/godmode` falls back correctly when gateway is unavailable (circuit breaker prevents per-request probe timeout).
- Telegram session mode recovers from gateway drops without crashing.
- Webhook HMAC verification passes all edge cases.
- `convergence-final.test.ts` has at least one behavioral assertion per exit condition.
- `npm run check:convergence` runs in CI on every merge.
- ADR-MEMORY-TAXONOMY.md status is "Decided."

**Rollback:** No breaking changes. Circuit breaker can be disabled. Legacy env vars continue to work.

---

### Epic 2 — Webhook Ingress Cutover to OpenClaw

**Goal:** Move external automation ingress from the dashboard into OpenClaw webhooks. Achieve Exit 2 "Pass."

**Files:**
- `packages/jarvis-dashboard/src/api/webhooks-v2.ts` — deprecate (320+ lines)
- `packages/jarvis-dashboard/src/api/server.ts` — remove webhook mounts (lines 114-115)
- `packages/jarvis-shared/src/webhook-normalizer.ts` — no change (reused by OpenClaw plugin)
- `packages/jarvis-runtime/src/convergence-checks.ts` — webhook source check

**Design:** The webhook normalizer (`normalizeGithubWebhook()`, `normalizeGenericWebhook()`, `normalizeCustomWebhook()`) is already transport-agnostic. It takes raw payloads, returns `NormalizedWebhookEvent`, and `webhookEventToCommand()` converts to Jarvis commands. The domain logic is done; this epic is wiring.

**Steps:**
1. Configure OpenClaw Webhook plugin routes for 3 families: GitHub, generic (requires `agent_id`), per-agent custom.
2. Each route calls the same normalizer functions from `@jarvis/shared`.
3. Validate raw body access in OpenClaw's context for HMAC verification.
4. Add `JARVIS_WEBHOOK_LEGACY=true` env var for 1-quarter transition period.
5. Provide 301 redirect at old URLs for external callers.
6. Add convergence check warning when legacy routes are mounted.

**OpenClaw dependency:** Webhook ingress plugin API. **No fallback** — if unavailable, keep dashboard routes with deprecation warnings.

**HMAC concern:** `verifyWebhookSignature()` requires the original raw bytes. The Express `verify` callback captures them in `req.rawBody` (server.ts:75-82). The OpenClaw webhook plugin must provide equivalent raw body access, or HMAC verification breaks.

**Acceptance:**
- All new webhook integrations use OpenClaw webhook routes.
- Dashboard webhook routes either removed or behind `JARVIS_WEBHOOK_LEGACY=true`.
- At least 3 real ingress routes create commands through OpenClaw.
- Exit 2 shows "Pass" in `convergence-final.test.ts`.

**Rollback:** Re-add mount lines in server.ts. Set `JARVIS_WEBHOOK_LEGACY=true`.

---

### Epic 3 — TaskFlow Adoption for Durable Multi-Step Work

**Goal:** Make TaskFlow the standard orchestration layer for workflows that survive gateway restarts.

**Files:**
- `packages/jarvis-runtime/src/schedule-trigger.ts` — new `TaskFlowTriggerSource`
- `packages/jarvis-runtime/src/daemon.ts` — event-reactive mode (schedule polling, lines 200-270)
- `packages/jarvis-runtime/src/job-graph.ts` — TaskFlow checkpointing integration
- `packages/jarvis-runtime/src/orchestration-types.ts` — `SubGoal` + TaskFlow step IDs
- `packages/jarvis-scheduler/` — schedule CRUD adapted for TaskFlow

**Current seam:** `ScheduleTriggerSource` interface (schedule-trigger.ts:34-46):
```typescript
interface ScheduleTriggerSource {
  readonly kind: "db" | "external";
  getDueSchedules(now: Date): DueSchedule[];
  markFired(scheduleId: string, now: Date): void;
}
```
`ExternalTriggerSource` (line 101) returns empty/no-op. New `TaskFlowTriggerSource` registers schedules as TaskFlow workflows and responds to callbacks.

**Steps:**
1. Verify TaskFlow API capability (DAG support? checkpoint/resume? cancel semantics?).
2. Create `TaskFlowTriggerSource` with `kind: "taskflow"`.
3. Add `JARVIS_SCHEDULE_SOURCE=taskflow` alongside `db` and `external` (daemon.ts:207).
4. Map `JobGraph` sub-goals to TaskFlow steps. If TaskFlow supports DAGs, delegate dependency resolution. If not, serialize.
5. Add durable correlation: `taskflow_run_id` <-> Jarvis `run_id` in runtime.db.
6. First 6 candidate workflows: lead intake, proposal generation, contract triage, regulatory digest, delivery-readiness report, health escalation.
7. Sub-deliverable: wire `before_reply` and `after_tool_call` hooks (from dropped old Epic 8).

**OpenClaw dependency:** TaskFlow API. **Primary blocker.** Fallback: `JARVIS_SCHEDULE_SOURCE=db` remains default.

**Acceptance:**
- At least 6 named workflows run as TaskFlows end-to-end.
- Each flow has stable flow ID, owner session, current state, terminal outcome.
- Flows survive gateway restart without state loss.
- No new multi-step automation implemented as dashboard-only orchestration.

**Rollback:** Switch to `JARVIS_SCHEDULE_SOURCE=db`. Schedule definitions stay in runtime.db.

---

### Epic 4 — /tasks and Unified Operator Work Visibility

**Goal:** Expose active work through a unified task API. Operators see the same reality from chat and dashboard.

**Files:**
- New: `packages/jarvis-dashboard/src/api/tasks.ts` — unified task router
- `packages/jarvis-dashboard/src/api/server.ts` — mount at `/api/tasks`
- `packages/jarvis-runtime/src/run-store.ts` — active/recent run queries
- `packages/jarvis-jobs/` — in-flight job queries

**New type:**
```typescript
type UnifiedTask = {
  task_id: string;
  agent_id: string;
  source: "schedule" | "webhook" | "command" | "operator";
  status: "queued" | "planning" | "executing" | "awaiting_approval" | "completed" | "failed";
  started_at: string;
  updated_at: string;
  jobs_total: number;
  jobs_completed: number;
  pending_approvals: number;
  flow_id?: string;
  provenance?: { channel: string; trigger_type: string };
};
```

**Steps:**
1. Create router: `GET /api/tasks` (aggregated list), `GET /api/tasks/:id` (detail with job graph, approvals, artifacts).
2. Add filtering: `?status=`, `?agent_id=`, `?since=`.
3. Map OpenClaw `/tasks` surface to same `UnifiedTask` shape (optional).
4. Wire Telegram adapter with `/tasks` command.
5. Add SSE for real-time dashboard updates.

**OpenClaw dependency:** None for Jarvis API. Optional `/tasks` integration for chat.

**Acceptance:**
- Operators see running, blocked, failed, completed work from `/api/tasks`.
- Task IDs in chat match IDs in dashboard.
- Inspect and cancel at least 3 flow types from the task surface.

**Rollback:** Remove route mount. Additive change.

---

## Year 2: OpenClaw as Canonical Execution Substrate

### Epic 5 — Canonical `openclaw infer` Adapter

**Goal:** Create a headless inference surface for stateless provider-backed work.

**Files:**
- `packages/jarvis-inference/src/router.ts` — add `"openclaw"` to `ModelInfo.runtime`
- `packages/jarvis-inference/src/task-profile.ts` — add `allow_openclaw?: boolean` to `TaskConstraints`
- `packages/jarvis-shared/src/gateway.ts` — add `invokeInference()` gateway method
- New: `packages/jarvis-inference/src/openclaw-adapter.ts`
- `packages/jarvis-runtime/src/daemon.ts` — model discovery (lines 272-283)

**Critical question:** Does `openclaw infer` proxy to local runtimes (Ollama/LM Studio) or add cloud models? Current `SelectionPolicy` has 8 local-only policies in task-profile.ts:53-60. If cloud models are added, the policy type needs extension.

**Steps:**
1. Clarify `openclaw infer` capabilities.
2. Create `openclaw-adapter.ts`: `complete()`, `listModels()`, `embed()`.
3. Extend `ModelInfo.runtime` to include `"openclaw"`.
4. Extend `selectByProfile()` to consider OpenClaw models when `allow_openclaw: true`.
5. Add `InferenceRoutingDecision` logging (observability).
6. First targets: web search/fetch, embeddings, transcription, summarization.

**Fallback:** If `openclaw infer` is unavailable, implement the adapter interface against Ollama/LM Studio directly. The abstraction layer is valuable regardless.

**OpenClaw dependency:** `openclaw infer` API. **Not in compatibility matrix** — high-risk.

**Acceptance:**
- At least 5 existing bespoke provider-backed paths migrated behind the adapter.
- Every infer call returns normalized JSON with provider/model metadata.
- Provider/model policies configurable without downstream code changes.

**Rollback:** `allow_openclaw` defaults to `false`.

---

### Epic 6 — Inference Migration and Cost/Reliability Governance

**Goal:** Migrate workloads to infer adapter, govern centrally.

**Blocked by:** Epic 5.

**New type:**
```typescript
type InferenceGovernancePolicy = {
  max_daily_cost_usd?: number;
  max_request_latency_ms?: number;
  min_local_percentage?: number;
  fallback_policy: "reject" | "queue" | "degrade";
  cost_per_token_override?: Record<string, number>;
};
```

**Steps:**
1. Implement governance policy engine in new `packages/jarvis-inference/src/governance.ts`.
2. Cost tracker in runtime.db.
3. Prometheus metrics: `jarvis_inference_cost_usd_total`, `jarvis_inference_local_percentage`.
4. Migrate per-agent via `TaskProfile.constraints.allow_openclaw`.
5. Design rule: stateless + provider-backed -> infer adapter; domain-stateful + approval-sensitive -> Jarvis worker.

**Acceptance:**
- At least 50% of stateless workload volume runs through infer adapter.
- All infer-backed jobs emit provider/model/cost metrics.
- Fallback works across at least 2 providers.
- High-cost inference paths are approval-gated.

---

### Epic 7 — Memory Taxonomy and Authoritative Storage Boundaries

**Goal:** Implement runtime enforcement of the memory taxonomy (ADR advanced to "Decided" in Epic 1).

**Files:**
- `packages/jarvis-agent-framework/src/memory.ts` — category boundaries
- `packages/jarvis-agent-framework/src/knowledge.ts` — collection ownership
- New: `packages/jarvis-agent-framework/src/memory-boundary.ts` — runtime checker
- `tests/architecture-boundary.test.ts` — memory boundary tests

**The taxonomy** (from ADR-MEMORY-TAXONOMY.md):

| Category | Owner | Store |
|---|---|---|
| Conversation context | OpenClaw | Session state |
| Run state | Jarvis | runtime.db |
| Domain facts | Jarvis | crm.db, knowledge.db |
| Operational knowledge | Jarvis | knowledge.db |
| Audit trail | Jarvis | runtime.db audit_log |
| Operator preferences | OpenClaw | Session / memory-wiki |

**Steps:**
1. Create `MemoryBoundaryChecker`: `validate(category, target_store) -> { valid, violation? }`.
2. Instrument stores with boundary checks.
3. Start in "warn" mode. Switch to "enforce" after 1 quarter clean.
4. Architecture boundary tests for cross-boundary writes.
5. `jarvis doctor` memory boundary health check.

**Acceptance:**
- 100% of immutable compliance records in authoritative Jarvis stores only.
- No OpenClaw memory/wiki write path can become source of truth for compliance artifacts.
- Boundary checker operational in warn mode.

---

### Epic 8 — Controlled Dreaming Rollout

**Goal:** Pilot background knowledge consolidation for 2-3 agents.

**Prerequisite:** At least 3 agents must be runtime-registered and producing memory/knowledge writes.

**Files:**
- New: `packages/jarvis-runtime/src/dreaming.ts` — orchestrator
- `packages/jarvis-agent-framework/src/lesson-capture.ts` — trigger
- `packages/jarvis-agent-framework/src/knowledge.ts` — synthesis target
- `packages/jarvis-observability/src/metrics.ts` — dreaming metrics

**Three consolidation modes:**
1. Lesson consolidation — merge similar lessons, deduplicate, rank by frequency
2. Entity deduplication — merge duplicates in entity graph
3. Cross-reference — link documents to related entities and runs

**Steps:**
1. Design dreaming loop: query recent lessons, entity graph, knowledge docs. Score by recall frequency.
2. `dreaming.ts` orchestrator as low-priority daemon task during off-hours.
3. Pilot: proposal-engine, regulatory-watch, knowledge-curator.
4. Approval gates for outputs that modify knowledge store.
5. Weekly review cadence for DREAMS.md.
6. Metrics: runs, synthesis count, promotions, false promotions.

**OpenClaw dependency:** Dreaming API optional. If unavailable, implement Jarvis-native.

**Acceptance:**
- Dreaming enabled only for named pilot agents, not globally.
- Every promoted memory item traceable to repeated recall evidence.
- 0% of dreaming-promoted items treated as compliance evidence.
- Weekly human review for at least 1 month.

---

## Year 3: Product-Grade Knowledge-and-Operations System

### Epic 9 — memory-wiki Deployment and Bridge Configuration

**Goal:** Deploy memory-wiki as compiled knowledge vault alongside active memory.

**Files:**
- `packages/jarvis-shared/src/gateway.ts` — `wiki.*` gateway methods
- New: `packages/jarvis-agent-framework/src/wiki-bridge.ts`
- `packages/jarvis-agent-framework/src/knowledge.ts` — wiki sync

**Key interface:**
```typescript
interface WikiBridge {
  publish(doc: KnowledgeDocument): Promise<string>;
  query(query: string): Promise<WikiSearchResult[]>;
  sync(since: string): Promise<SyncResult>;
  status(): Promise<WikiHealthStatus>;
}
```

**Sync rules:**
- **Sync to wiki:** lessons, playbooks, case-studies, regulatory, garden
- **Do NOT sync:** contracts, ISO 26262 evidence, ASPICE evidence, signed records
- **Link only:** wiki pages reference compliance artifacts by ID, never duplicate

**Initial page groups:** company positioning, delivery playbooks, relationship intelligence, regulatory landscape.

**OpenClaw dependency:** memory-wiki API. **Blocker.**

---

### Epic 10 — Wiki-Powered Retrieval for Operators and Agents

**Goal:** Make wiki the preferred source for curated synthesized knowledge.

**Blocked by:** Epic 9.

**Steps:**
1. Add `WikiRetrievalSource` to `HybridRetriever` (hybrid-retriever.ts). Wiki becomes fifth signal alongside dense, sparse, RRF, and cross-encoder.
2. Configurable retrieval weighting (default 60/40 local/wiki).
3. Add `wiki_search` to session tools in `session-chat-adapter.ts`.
4. Freshness/contradiction dashboard views.
5. Retrieval policy: wiki for durable synthesis; knowledge.db for domain facts; never wiki for compliance evidence.

---

### Epic 11 — Managed Browser Profiles and Sandbox Hardening

**Goal:** Managed-profile browser execution and sandbox enforcement.

**Note:** Exit 4 closure (low-level ops in OpenClaw bridge) should be addressed in Epic 1. This epic focuses on profiles and sandboxing.

**Browser capability matrix:**

| Job Type | OpenClaw Bridge | Legacy Puppeteer |
|---|---|---|
| browser.navigate | Yes | Yes |
| browser.extract | Yes | Yes |
| browser.capture | Yes | Yes |
| browser.download | Yes | Yes |
| browser.run_task | Yes | Yes |
| browser.click | TBD (Epic 1) | Yes |
| browser.type | TBD (Epic 1) | Yes |
| browser.evaluate | TBD (Epic 1) | Yes |
| browser.wait_for | TBD (Epic 1) | Yes |

**Platform concern:** Windows 11 (no seccomp/AppArmor). Consider Windows Sandbox or Hyper-V isolation.

**OpenClaw dependency:** Browser plugin/managed profiles API.

---

### Epic 12 — Legacy Deletion, Release Gates, and Final Cutover

**Goal:** Delete deprecated code. Smaller codebase than program start.

**Deletion list:**

| File | What It Is |
|------|-----------|
| `packages/jarvis-dashboard/src/api/godmode.ts` | Legacy LLM loop |
| `packages/jarvis-dashboard/src/api/chat.ts` | Legacy direct chat |
| `packages/jarvis-telegram/src/chat-handler.ts` | Legacy chat handler |
| `packages/jarvis-telegram/src/bot.ts` | Legacy Telegram bot |
| `packages/jarvis-telegram/src/relay.ts` | Legacy relay |
| `packages/jarvis-browser-worker/src/chrome-adapter.ts` | Legacy browser adapter |
| `LegacyPuppeteerBridge` in openclaw-bridge.ts | Legacy browser bridge |
| `/api/godmode/legacy` mount | Legacy route |
| `/api/webhooks` mounts | Legacy webhook routes |
| `JARVIS_TELEGRAM_MODE` env var | Legacy mode selector |
| `JARVIS_BROWSER_MODE` env var | Legacy mode selector |

**Preconditions** (from RELEASE-GATE-CONVERGENCE.md):
1. All 4 primary paths converged
2. Session mode running >= 1 full schedule cycle
3. No operator reports missing functionality
4. No production deployments using legacy env vars
5. All deprecated files marked `@deprecated`
6. `jarvis doctor` convergence checks pass
7. `npm run check:convergence` exits 0
8. All external callers migrated
9. Browser tasks produce equivalent artifacts through OpenClaw bridge

**Success metric:** Active codebase contains fewer lines of platform-duplicate code than Y1 baseline.

---

## Cross-Cutting Concerns

### Observability Metrics

Add to `packages/jarvis-observability/src/metrics.ts`:

```
jarvis_webhook_ingress_total { source: "dashboard" | "openclaw" }
jarvis_inference_runtime_total { runtime: "ollama" | "lmstudio" | "openclaw" }
jarvis_session_mode_total { mode: "session" | "legacy" }
jarvis_browser_bridge_total { bridge: "openclaw" | "legacy" }
jarvis_taskflow_runs_total { trigger: "daemon_poll" | "taskflow" }
jarvis_memory_boundary_violations_total { category, target_store }
```

### CI/CD Additions

| Epic | CI Change |
|------|-----------|
| 1 | Add `npm run check:convergence` to CI |
| 2 | Add OpenClaw webhook plugin test |
| 3 | Add TaskFlow integration test |
| 7 | Add memory boundary architecture tests |
| 12 | Tighten convergence tests — reject any "Partial" status |

### Relationship to CONVERGENCE-ROADMAP.md

| Old Epic | New Epic | Action |
|----------|----------|--------|
| 1-2 (Architecture + Runtime) | Completed | Archive |
| 3 (Channel Ownership) | Epic 1 | Supersede |
| 4 (Webhook Ingress) | Epic 2 | Supersede |
| 5 (Operator Chat) | Completed | Archive |
| 6 (Browser Ownership) | Epic 1 + 11 | Supersede |
| 7 (Automation & TaskFlow) | Epic 3 | Supersede |
| 8 (Hook Consolidation) | Epic 3 sub-deliverable | Folded in |
| 9 (Session Memory) | Epic 7 | Supersede |
| 10 (Security Gap Closure) | Epic 1 sub-deliverable | Folded in |
| 11 (Packaging & Release) | Epic 12 | Supersede |
| 12 (Dead Code Removal) | Epic 12 | Supersede |

### Program-Level Gates

1. No new public automation ingress may bypass OpenClaw webhooks.
2. No new multi-step background workflow may bypass TaskFlow without an explicit exception.
3. No new provider-backed stateless feature may bypass the infer adapter.
4. No new synthesized durable knowledge feature may bypass the memory taxonomy.
5. No compatibility path may remain without an owner, observability, and retirement date.
6. Compliance-grade evidence remains authoritative only in Jarvis runtime/CRM/knowledge DBs.

### Delivery Gates

| Milestone | Criteria |
|-----------|---------|
| End of Y1 | All new external automation OpenClaw-webhook capable; >= 1 production flow TaskFlow-managed; `/tasks` shows real work |
| End of Y2 | infer is standard headless path for >= 50% stateless workloads; dreaming live for controlled agent set with weekly review |
| End of Y3 | Wiki-backed knowledge in routine use; most multi-step work flow-native; legacy ingress/wrappers exceptional not normal |

### Program Dashboard Metrics

Track: webhook adoption, TaskFlow adoption, /tasks visibility coverage, infer adoption, managed-browser adoption, dreaming review rate, wiki retrieval adoption, legacy-path traffic, compliance-record boundary violations (must remain zero).
