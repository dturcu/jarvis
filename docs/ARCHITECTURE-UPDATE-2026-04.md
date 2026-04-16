# Architecture update — April 2026 (post 20-expert review)

## Executive summary

- **Approval pipeline is structurally unsafe.** Two independently-flagged critical defects (approval-gated submitJob never persists the envelope; `/edit` ignores `modified_input`) mean operators routinely believe they gated or modified high-stakes actions that never ran or ran un-modified. This is the single highest-priority cluster.
- **LLM surface is exploitable end-to-end.** SSRF via `web_fetch`, path traversal via llama.cpp load and `list_files`/`read_file`, indirect prompt injection via unsanitized tool results, and non-constant-time token compare form a coherent attack chain from a single adversarial email to arbitrary agent execution.
- **Observability, alerting, and HA are aspirational.** OpenTelemetry is imported but never initialized; `sendAlert` writes to a file nobody reads; backups never leave the host; scheduler is in-memory only; `/api/health` returns 200 with models fully down.
- **Agent framework runs without its own prompts.** Authored system prompts and durable memory are dead code — `planner.ts` is a stub, `runAgent` never composes system prompt + memory into a real model call, lesson capture only mirrors the decision log. The "durable memory" claim is currently fiction.
- **Docs, convergence status, and QA pyramid have drifted from reality.** README/CLAUDE.md disagree on agent count and quick-start; webhooks-v2 ships 400+ lines despite being declared "eliminated"; stress suite and E2E tests never gate CI; auth middleware is not exercised by any test.

## Critical bugs — fix this sprint

1. **Approval-gated `submitJob` drops the job on the floor.**
   - Evidence: `packages/jarvis-shared/src/state.ts:359-371` returns `awaiting_approval` + approval_id but never calls `writeJobRecord`; no reactor re-queues on approval.
   - Fix: persist envelope as `awaiting_approval`, promote to `queued` inside `resolveApproval('approved')` in the same transaction.
   - Traceability: [11]

2. **Approval `/edit` ignores `modified_input`.**
   - Evidence: `packages/jarvis-dashboard/src/api/approvals.ts:136-160` stringifies `modified_input` into `resolution_note` only; `approval-bridge.ts:92-96` updates status but never touches the payload. Confirmed by [20] (no test covers substitute-then-execute).
   - Fix: `modifyJobInput(jobId, input)` running `validateJobInput` in the same `BEGIN IMMEDIATE` tx as resolution, OR reject `/edit` with 501 until implemented.
   - Traceability: [10, 11, 20]

3. **Indirect prompt injection via unsanitized tool results.**
   - Evidence: `gmail-adapter.ts:129,142` returns raw email bodies; `chat.ts:232` and `godmode.ts:497-502` re-inject `[Tool Result for ${name}]:\n${result}` without calling `sanitizeForPrompt`.
   - Fix: Route every tool result through `sanitizeForPrompt` AND wrap in `<untrusted_content>` delimiters; strip `[TOOL:...]` sequences before echoing.
   - Traceability: [10]

4. **SSRF in `web_fetch` tool.**
   - Evidence: `packages/jarvis-dashboard/src/api/tool-infra.ts:238-252` calls `fetch(url)` with any user-supplied URL; no scheme/host denylist.
   - Fix: restrict to `http(s):`, block RFC1918/loopback/link-local after DNS resolution, enforce max response size + timeout.
   - Traceability: [13, 10]

5. **Path traversal + unchecked spawn in llama.cpp loader.**
   - Evidence: `packages/jarvis-dashboard/src/api/runtimes.ts:244-285` — `llamacppLoadModel` only checks `fs.existsSync` before `spawn(binary, ['-m', modelPath, …])`.
   - Fix: resolve `modelPath` via `realpathSync` and require prefix match against `getGgufDirs()`; reject symlinks; make `-ngl` configurable.
   - Traceability: [13, 6]

6. **`list_files` / `read_file` legacy chat tools have no project-root clamp.**
   - Evidence: `tool-infra.ts:300-317` (`list_files`) and `chat.ts:396-405` (`read_file`) take `params.path` straight to `fs.readdirSync` / `fs.readFileSync`. Siblings `file_read`/`file_list` enforce `PROJECT_ROOT`.
   - Fix: apply the same `realpathSync(PROJECT_ROOT).startsWith()` clamp; deprecate the duplicates.
   - Traceability: [13, 10]

7. **Non-constant-time token comparison.**
   - Evidence: `packages/jarvis-dashboard/src/api/middleware/auth.ts:319` — `tokens.find(t => t.token === providedToken)`.
   - Fix: `crypto.timingSafeEqual` on equal-length buffers, iterating all entries to avoid short-circuit; add the `supertest` coverage [20] calls out.
   - Traceability: [13, 20]

8. **Legacy `/api/chat/telegram` exposes `trigger_agent` with no approval gate.**
   - Evidence: `packages/jarvis-dashboard/src/api/chat.ts:346-352,406-426` inserts into `agent_commands` with `status='queued'` on operator-role auth alone.
   - Fix: `trigger_agent` must write to `approvals` with severity `critical` before queuing, OR remove the tool from chat surfaces.
   - Traceability: [10]

9. **Migration 0001 is not idempotent.**
   - Evidence: `0001_runtime_core.ts:15,33,50,…` uses bare `CREATE TABLE`. `crm_0001_core.ts` and `knowledge_0001_core.ts` already use `IF NOT EXISTS`.
   - Fix: add `IF NOT EXISTS` to every `CREATE TABLE/INDEX` in migration 0001, or add an `isApplied` predicate that checks for `approvals` table presence.
   - Traceability: [12]

10. **OpenTelemetry is never initialized.**
    - Evidence: `packages/jarvis-observability/src/setup.ts:23` defines `initTelemetry()`; no production call-site in `daemon.ts` or `server.ts`. `/api/metrics` returns only prom-client text; OTel SDK + Prometheus exporter on 9464 never start.
    - Fix: call `initTelemetry()` from `daemon.ts main()` and `server.ts` startup; `shutdownTelemetry()` in the shutdown paths.
    - Traceability: [14]

## High-priority features & gaps

1. **No DLQ, no attempt increment, no retry backoff.**
   - Evidence: `state.ts:572-587` (`requeueExpiredJobs` never bumps `envelope.attempt`); `state.ts:1185-1188` never reads `retry_policy.max_attempts`; `worker-registry.ts:525-536` treats `WORKER_CRASH`/`EXECUTION_TIMEOUT` as terminal; `queueDepth` metric declared but never `.set()`.
   - Fix: bump attempt on requeue, enforce `max_attempts`, transition to `dead_letter`, emit `queueDepth{status,priority}`; add lifecycle test [20] calls for.
   - Traceability: [11, 14, 20]

2. **System prompts, memory, and lessons never reach inference.**
   - Evidence: `packages/jarvis-agent-framework/src/planner.ts:24-32` returns `{ steps: [] }` unused; `runtime.ts` never reads `definition.system_prompt`; `memory.ts:79-84` `getContext()` has no consumer; `lesson-capture.ts:75-143` mirrors decision-log strings with `.includes("fail")` heuristic.
   - Fix: have `planner.execute()` compose system_prompt + lessons + memory + goal into a real inference call; gate lesson synthesis to failed/approved-mutating runs with LLM summarization.
   - Traceability: [7, 8, 9]

3. **RAG retrieval quality is broken at four specific joints.**
   - Sub-issues: (a) stale embeddings on `updateDocument` — `sqlite-knowledge.ts:108-131` never re-ingests; (b) RRF fusion keys on first-80-chars of text instead of shared `chunk_id` (`sparse-store.ts:131,143`); (c) FTS query joined with `OR` kills precision (`sparse-store.ts:55-59`); (d) fire-and-forget `.catch(() => {})` on auto-embed (`sqlite-knowledge.ts:99-103`).
   - Fix: re-ingest on update inside one tx, share a single `chunk_id` across dense/sparse stores, use implicit AND with OR fallback, track `doc_embed_status` with metric + startup re-queue.
   - Traceability: [9]

4. **No alerting channel.**
   - Evidence: `packages/jarvis-runtime/src/logger.ts:110-124` — `sendAlert()` appends to `~/.jarvis/alerts.jsonl` with no consumer.
   - Fix: wire `sendAlert` into `createNotificationDispatcher` so ERROR-level events page via Telegram/session; minimum rate-limit.
   - Traceability: [14]

5. **Missing HARA/TARA/FMEA agent and no status-report agent.**
   - Evidence: `evidence-system.md` only audits; no agent performs or scaffolds HARA/FMEDA/FTA/DFA/TARA. No `engagement-status-reporter` in `definitions/`.
   - Fix: add `safety-analysis` (high_stakes_manual_gate) agent for HARA/TARA/FMEA scaffolding; add `engagement-status-reporter` that produces client-ready weekly updates behind approval.
   - Traceability: [16]

6. **CRM has no deal, no proposal state machine, no invoice lifecycle.**
   - Evidence: `crm_0001_core.ts:11-24` places `stage` on `contacts`; there is no `deals`, `companies`, `proposals`, or `invoices` table; `invoice-generator` archived in legacy; `proposal-engine.ts:16` emits "invoicing structure" that is never persisted.
   - Fix: add `companies`, `deals`, `proposals(status: draft|sent|negotiating|accepted|rejected|withdrawn)`, `proposal_line_items`, `invoices(status, vat_rate, issued_at, due_at, paid_at)`; restore `invoice-generator` as a first-class agent with approval on issue.
   - Traceability: [17, 16]

7. **Signing key defaults to dev string; no model/version in provenance.**
   - Evidence: `worker-registry.ts:92` — signing key falls back to `"jarvis-dev-signing-key-not-for-production"` outside production; `signing_key` accepted in HTTP body (`api/provenance.ts:57,63`); `ProvenanceRecord` has no `model_id`/`model_version`/`runtime_build`.
   - Fix: hard-fail startup outside production without a key; forbid `signing_key` in request body; add `signing_keys` registry table; add `model_id`, `model_version`, `prompt_version`, `runtime_build` to `provenance_traces` and `decisions`.
   - Traceability: [18]

8. **Tamper-evident audit log only in `provenance_traces`.**
   - Evidence: `0001_runtime_core.ts:99-108` (`audit_log`) and `knowledge_0001_core.ts:59-67` (`decisions`) have no `AFTER UPDATE/DELETE` triggers and no hash chain. Filesystem access to `~/.jarvis/runtime.db` allows silent mutation.
   - Fix: `INSTEAD OF UPDATE/DELETE RAISE(ABORT)` triggers; add `prev_hash`/`hash` columns; replay like provenance.
   - Traceability: [18]

9. **Settings.tsx monolith + no error boundaries in dashboard.**
   - Evidence: `src/ui/pages/Settings.tsx` is 1053 LOC across 9 tabs; zero `ErrorBoundary` components anywhere in `src/ui/`; one component error crashes the whole SPA.
   - Fix: split Settings into `src/ui/pages/settings/{General,Workflows,Agents,Safety,Models,Integrations,Backup,Repair,Advanced}.tsx` with shared state; add error boundaries at AppShell and per major route with logging to API.
   - Traceability: [4, 2]

10. **No E2E tests; auth middleware untested; stress suite off-CI.**
    - Evidence: no `playwright.config`, no `@playwright/test`; `tests/smoke/security-posture.test.ts:48-129` re-implements middleware decisions inline; `test:stress` missing from `npm run check`.
    - Fix: mount `auth.ts` under `supertest` with coverage of timing, CORS, cookie-vs-bearer, IP spoof; Playwright suite for login → approvals → approve; wire `test:stress` into nightly CI.
    - Traceability: [20]

## Medium-priority improvements

1. **Design-token fragmentation.** Consolidate `--color-j-*` as Tailwind theme entries, centralize status/outcome palettes in `ui/tokens/colors.ts`, remove hardcoded indigo/slate strings in `shared/`. Traceability: [5, 1, 4].
2. **Missing primitive components (Button, Input, Select, Modal).** Pages reimplement markup; Settings alone re-creates TextInput/SelectInput/Toggle. Build shared primitives with size/variant props; adopt Radix for menus/popovers/tooltips. Traceability: [5, 4].
3. **Accessibility debt.** Icon-only buttons lack `aria-label`; modals lack focus trap + ESC handling; tables lack `<th scope="col">`; toggles lack `role="switch"` + `aria-checked`; no live region for streaming chat. Traceability: [3].
4. **Polling hook is bypassed.** `Decisions.tsx:68-75` and 7 other pages reimplement `setInterval+useRef`; `usePolling` exists. Mandate the hook; audit unmount cleanup. Traceability: [4].
5. **SSE streaming lacks abort on unmount.** `godmode-store.ts:575-738` has no AbortController. Scope to store lifecycle. Traceability: [4, 6].
6. **Runtime preference has no health weighting.** `router.ts:73` always picks llama.cpp first; a dead server returns ECONNREFUSED without failover. Probe before return and fall through preference order; add circuit breaker + tiered timeouts; fix `runtime` label hardcoded to `"lmstudio"` at `worker-registry.ts:471`. Traceability: [6].
7. **Approval timeout maps to `"rejected"` silently.** `approval-bridge.ts:66-73` collapses `expired`/`cancelled`. Preserve `expired` end-to-end; version approval rules in a new `approval_rules` table. Traceability: [18, 2].
8. **Connection fan-out on dashboard handles.** 40+ `new DatabaseSync(...)` sites; most skip WAL/busy_timeout/FK pragmas. Centralize via `getRuntimeDb()/getCrmDb()/getKnowledgeDb()` helpers. Traceability: [12].
9. **Cross-DB backup is inconsistent.** `backup.ts:39-54` sequential `VACUUM INTO` can split a run from its decision. Either quiesce writes during snapshot or document as best-effort. Retention missing on `audit_log`, `decisions`, `notifications`, `embedding_chunks`. Traceability: [12].
10. **Windows/Linux first-run silent failures.** `start.mjs` preflight checks file existence but not schema, migration drift, Node version, model binaries. Force-kill on Windows orphans runtimes. Wire `jarvis doctor` into preflight; align shutdown escalation. Traceability: [14, 19].
11. **Convergence status is drifted and unmetriced.** `webhooks-v2.ts` ships 400+ lines but `CLAUDE.md:63` says "Eliminated"; `legacyPathTraffic` metric exists but no `<5%` release gate. Fix status copy, add `check:convergence-metrics` CI gate, emit RFC 8594/9745 `Sunset`/`Deprecation` headers on legacy routes. Traceability: [15].
12. **OpenClaw version pin drift.** Root pins `^2026.4.8`; 20+ packages pin `^2026.4.2`. Add `scripts/check-openclaw-pin.mjs`; bump in lockstep. Traceability: [15].
13. **Architecture-boundary test has no self-test and a wide legacy exclusion.** `tests/architecture-boundary.test.ts:81-93` lets any addition to legacy files escape scanning; no fixture asserts the scanner fails when given a violation. Freeze legacy by LOC; add a positive-failure fixture. Traceability: [15, 20].
14. **CORS validation + security headers.** `server.ts:48,124` echoes `JARVIS_CORS_ORIGIN` verbatim (accepts `*`); no `helmet`, no CSP, no `X-Frame-Options`. Validate origin allowlist, require HTTPS outside localhost, ship tight CSP. Traceability: [13].
15. **CSRF on mutating routes.** Cookie+Bearer accepted for any localhost origin; no CSRF token. Require double-submit token or refuse cookie auth for POST/PATCH/DELETE. Traceability: [10, 13].

## Strategic / long-horizon

**1. Agent framework rebuild around a real planner (L).** The framework owns the most important promise in the product — that agents use their prompts, their memory, and their lessons. Today `planner.ts` is a stub, `runAgent` is a 750-LOC monolith with no lifecycle hooks, and concurrent runs share one synchronous SQLite handle. This blocks trustworthy orchestrator behavior, tool-call normalization across Ollama/LM Studio/llama.cpp, and the retrieval-quality work. A rewrite scoped around `LifecycleStage` hooks, a pluggable `RetryPolicy`, and a real `planner.execute(system_prompt, memory_ctx, lessons, goal)` call will pay dividends across agent-framework, prompt, RAG, and inference reviews simultaneously. [7, 8, 6]

**2. ISO 26262 / AI Act readiness posture (M-L).** The compliance reviewer identifies three gaps that together block external audit: approver identity cannot be traced to a person, provenance does not capture model/version/prompt, and `audit_log`/`decisions` are mutable. Layer onto that the PM reviewer's observation that the roster lacks HARA/TARA/FMEA support, and the product cannot currently be claimed as AI Act Annex-III eligible or ISO 26262 clause-11 qualifiable. The strategic sequence is: identity + hash-chain on audit + model-version in provenance (this quarter), then `docs/AI-ACT-POSTURE.md` with per-agent `risk_class` tagging (next quarter), then a `GET /api/audit/export` signed-tarball endpoint an assessor can verify offline. [18, 16]

**3. CRM to a real sales-and-delivery graph (L).** The BA review makes clear the current schema cannot answer first-order questions about pipeline value or margin because "deal", "company", "proposal", "invoice", and "engagement" are not modeled. Automotive safety consulting routinely runs concurrent engagements per account, spends 4-12 weeks in MSA after verbal win, and depends on MEDDIC-style role mapping. The target is a `companies → deals → proposals → engagements → invoices` graph with rate cards, currency, and loss-reason enums. Downstream payoff: staffing-monitor gains real data, self-reflection can run win/loss reviews, Portal can read from `engagement_milestones` instead of regex-scanning notes. [17, 16]

**4. Convergence Wave 9: retire dormant duplication with gates (M).** Wave 8 claimed completion prematurely. The path forward: delete `webhooks-v2.ts` and the `/api/webhooks` auth bypass (closes a dormant open ingress and matches the Roadmap claim); add a `legacyPathTraffic / totalTraffic < 0.05` release gate enforced in CI before removing `/api/godmode/legacy` and `/api/chat/telegram` on the 2026-07-01 date already declared in `legacy-deletion-checklist.ts`. Couple with `Sunset`/`Deprecation` headers on every remaining legacy router. [15, 10, 13]

**5. QA pyramid inversion and supply-chain hardening (M).** Today the stress suite and E2E layer are decorative — they do not gate merges. Combined with `security-posture.test.ts` re-implementing the middleware inline, the reliability/security claims of the queue, auth, and approval surfaces are tested by tautologies. A credible fix is: nightly `test:stress` gate, Playwright login → approvals → approve E2E, CodeQL + Dependabot + Linux-matrix runner, one mutation-testing pass on `runtime/approvals.ts` + `jobs/claim.ts` to establish a kill-rate baseline. This is not cosmetic — every other hardening item lands on an un-asserted floor without it. [20, 15, 13]

## Out of scope / explicitly rejected

1. **Light-mode theme toggle ([5]).** Single reviewer, medium severity, no user pull; defer until a user asks.
2. **Storybook for design system ([5]).** Valuable DX artifact but cost > benefit given the 2-contributor context and the higher-priority token consolidation that needs to land first.
3. **Brute-force cosine scan replacement with sqlite-vss ([9] #1).** Corpus is currently well below the 50k-chunk ceiling called out in the file's own comment; switching vector engines is a distraction from the four fusion/staleness bugs that matter now. Revisit when the corpus crosses 25k chunks.
4. **"Always light-mode toggle" / "decompose Settings into full wizard" ([2] #10).** Audit for destructive toggles is in-scope; full wizard redesign is not — one reviewer, low evidence.
5. **Dark-mode contrast raise for every `text-slate-400` instance ([3] #7).** Legitimate but low-impact given single-operator usage pattern; bundle with the token-consolidation epic rather than treating as a standalone sprint.
6. **Route-based code splitting with `React.lazy()` ([4] #9).** Bundle size is not a user complaint today; desktop-first single-operator tool. Revisit only if a second user profile (mobile ops on the go) emerges.

## Proposed execution order

### Epic A — Approval correctness + LLM surface hardening (M, 2 weeks)

Scope: critical bugs 1-8 above. `submitJob` persistence for approval-gated envelopes, real `modifyJobInput` under `BEGIN IMMEDIATE`, `sanitizeForPrompt` everywhere tool results land, `web_fetch` SSRF guard, `realpathSync` containment on llama.cpp loader and legacy `list_files`/`read_file`, constant-time token compare, remove or gate `trigger_agent` on chat surfaces.

Why this order: every item is a production-safety blocker with cross-review corroboration (security + safety + distsys). None of them require architectural change, they can all land in one sprint, and each subsequent epic depends on these being fixed so the system can be exercised safely.

### Epic B — Observability, retries, and backup durability (M, 2 weeks)

Scope: initialize OpenTelemetry, wire `sendAlert` to notification dispatcher, add DLQ + attempt-increment + backoff to the reaper, migration 0001 idempotency + auto_vacuum pragma, `/api/health` returns 503 when models down or disk <2GB, off-host backup schedule + restore-test, Windows/Linux shutdown + preflight fixes.

Why this order: without these, we cannot safely diagnose production incidents introduced by Epic A's changes. Distsys finding 4 (retry/DLQ) and SRE finding 1 (OTel) both gate all downstream work — you cannot tune reliability without measurements.

### Epic C — Agent framework, prompts, and retrieval fidelity (L, 3-4 weeks)

Scope: `planner.execute()` composing system_prompt + memory + lessons into a real model call; lifecycle hooks + pluggable `RetryPolicy` on `runAgent`; depth/budget guards on orchestrator-to-orchestrator dispatch; RAG fixes — re-embed on update, shared `chunk_id` for RRF, FTS AND fusion, `doc_embed_status` tracking; chunk provenance (page_no, char_start/end, source_uri) for citations; dedup lesson capture.

Why this order: this is architectural-debt that blocks everything product. Prompts, memory, lessons, and retrieval all co-evolve; splitting them re-introduces the divergence the framework review calls out. Once landed, every agent gets proportionally better without per-agent work.

### Epic D — CRM, provenance, and compliance posture (L, 3-4 weeks)

Scope: `companies`, `deals`, `proposals`, `proposal_line_items`, `invoices`, `engagements` tables with migration + worker updates; restore `invoice-generator` agent with approval gating; hash-chain + tamper-evidence triggers on `audit_log` and `decisions`; `model_id`/`model_version`/`prompt_version` in provenance; signing-key hard-fail outside production; `docs/AI-ACT-POSTURE.md` with per-agent `risk_class` tagging.

Why this order: this is the product-fit work. Epic C fixes the engine; Epic D makes the product sellable to the automotive client persona the PM review describes. Compliance changes must follow the CRM model changes so provenance can reference the right entity IDs.

### Epic E — QA pyramid, convergence Wave 9, and design-system consolidation (M, 2 weeks)

Scope: Playwright E2E for login + approvals; supertest coverage of `auth.ts` middleware; wire `test:stress` into nightly CI; CodeQL + Dependabot + Linux matrix; mutation-testing baseline; delete `webhooks-v2.ts` and the `/api/webhooks` auth bypass; `Sunset`/`Deprecation` headers; `check:convergence-metrics` gate; token consolidation; shared Button/Input/Select/Modal primitives; error boundaries; Settings decomposition.

Why this order: polish plus the final convergence cleanup. This epic can land in parallel with Epic D by a different contributor because its surface barely overlaps with CRM/provenance code paths.

## Traceability appendix

| Roadmap item | Source reviews | Severity (max) |
|---|---|---|
| Critical 1 — `submitJob` drops approval-gated envelope | 11 | critical |
| Critical 2 — `/edit` ignores `modified_input` | 10, 11, 20 | critical |
| Critical 3 — Indirect prompt injection via tool results | 10 | critical |
| Critical 4 — SSRF in `web_fetch` | 13, 10 | high |
| Critical 5 — Path traversal in llama.cpp loader | 13, 6 | high |
| Critical 6 — Legacy `list_files`/`read_file` no clamp | 13, 10 | high |
| Critical 7 — Non-constant-time token compare | 13, 20 | high |
| Critical 8 — `trigger_agent` without approval on legacy chat | 10 | high |
| Critical 9 — Migration 0001 not idempotent | 12 | high |
| Critical 10 — OpenTelemetry never initialized | 14 | critical |
| High 1 — No DLQ, no retry backoff, no attempt increment | 11, 14, 20 | high |
| High 2 — Prompts/memory/lessons never reach inference | 7, 8, 9 | high |
| High 3 — RAG stale embeds, RRF fusion key, FTS OR, silent auto-embed fail | 9 | high |
| High 4 — No alerting channel | 14 | critical |
| High 5 — Missing HARA/TARA/FMEA + status-report agents | 16 | critical |
| High 6 — No deal / proposal / invoice entities | 17, 16 | critical |
| High 7 — Dev signing key + model/version absent from provenance | 18 | high |
| High 8 — Mutable audit_log + decisions | 18 | high |
| High 9 — Settings monolith + no error boundaries | 4, 2 | critical |
| High 10 — No E2E, untested auth middleware, stress off-CI | 20 | high |
| Medium 1 — Design token fragmentation | 5, 1, 4 | critical |
| Medium 2 — Missing Button/Input/Select/Modal primitives + Radix | 5, 4 | high |
| Medium 3 — Accessibility debt (labels, focus trap, live regions) | 3 | critical |
| Medium 4 — `usePolling` bypassed across 7 pages | 4 | high |
| Medium 5 — SSE streaming lacks abort | 4, 6 | high |
| Medium 6 — Runtime preference + circuit breaker + runtime label | 6 | critical |
| Medium 7 — Approval timeout `"expired"` collapsed to `"rejected"` | 18, 2 | high |
| Medium 8 — DB connection fan-out, missing WAL/busy_timeout | 12 | high |
| Medium 9 — Cross-DB inconsistent backup + retention gaps | 12 | high |
| Medium 10 — First-run preflight + Windows shutdown orphans | 14, 19 | high |
| Medium 11 — Convergence status drift, missing sunset headers + gate | 15 | high |
| Medium 12 — OpenClaw version pin drift | 15 | high |
| Medium 13 — Architecture-boundary test has wide exclusion + no self-test | 15, 20 | high |
| Medium 14 — CORS validation + security headers + helmet/CSP | 13 | medium |
| Medium 15 — CSRF on mutating routes | 10, 13 | medium |
| Strategic 1 — Agent framework rebuild around real planner | 7, 8, 6 | high |
| Strategic 2 — ISO 26262 / AI Act readiness posture | 18, 16 | critical |
| Strategic 3 — CRM as sales-and-delivery graph | 17, 16 | critical |
| Strategic 4 — Convergence Wave 9: retire dormant duplication with gates | 15, 10, 13 | high |
| Strategic 5 — QA pyramid inversion + supply-chain hardening | 20, 15, 13 | high |
| Epic A — Approval correctness + LLM surface hardening | 10, 11, 13, 6, 20 | critical |
| Epic B — Observability, retries, backup durability | 11, 12, 14, 19 | critical |
| Epic C — Agent framework, prompts, retrieval fidelity | 6, 7, 8, 9 | high |
| Epic D — CRM, provenance, compliance posture | 16, 17, 18 | critical |
| Epic E — QA pyramid, convergence Wave 9, design-system consolidation | 1, 2, 3, 4, 5, 15, 20 | critical |
