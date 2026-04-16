# QA / Test Strategy — Red-team review

Scope: `vitest.config.ts`, `vitest.stress.config.ts`, `.github/workflows/ci.yml`, `tests/**` (125 files), `scripts/validate-contracts.mjs`. "Check" runtime is 15s because `stress/**` is excluded from default `vitest run` (`vitest.config.ts:60`) and `test:stress` is not wired into `npm run check` (`package.json:15`). The stress tier — the only place contention and reaper-style behavior is exercised — is not blocking CI.

## Top findings

1. **[high] The pyramid is inverted: stress suite is off-CI, "smoke" is fake-integration.**
   - Evidence: `package.json:13,15` — `test:stress` is a separate script and absent from `check`. `ci.yml:29` only runs `npm run check` + convergence subset. `tests/smoke/security-posture.test.ts:48-129` tests auth *by re-implementing the middleware decision inline* (`const hasAuth = authHeader !== undefined && ...`) rather than mounting `middleware/auth.ts`.
   - Impact: The tests most likely to catch real defects (cross-package integration, concurrency) never gate merges; the tests that appear to gate security invariants are tautologies that would pass if the production middleware were deleted.
   - Fix: Add `npm run test:stress` as a nightly CI job; rewrite `security-posture` to import and exercise `auth.ts` against a real Express app.

2. **[high] Auth test coverage doesn't exercise the real middleware — five specific bypasses are uncovered.**
   - Evidence: No test imports `packages/jarvis-dashboard/src/api/middleware/auth.ts`. Token compare at `auth.ts:319` uses `t.token === providedToken` (not `crypto.timingSafeEqual`); CORS at `server.ts:122-128` echoes `ALLOWED_ORIGIN` on every response without validating the request `Origin` header; no test for cookie-vs-Bearer precedence, role escalation via concurrent requests, or rate-limit bypass via `X-Forwarded-For` rotation.
   - Impact: Timing-oracle token leak, permissive CORS on any origin that guesses the configured value, and the Phase-0-flagged bypasses remain latent.
   - Fix: Add `tests/auth-middleware.test.ts` using `supertest` against a mounted router — assert `timingSafeEqual`, `Origin` rejection, IP-spoof resistance.

3. **[high] No E2E tests exist for the dashboard; `test:e2e` script does not exist.**
   - Evidence: No `playwright.config.*` anywhere (`Glob ** /playwright.config.*` empty); no `@playwright/test` / `cypress` in deps (`package.json:40-51`); no `packages/jarvis-dashboard/e2e/` directory.
   - Impact: 35 React pages + API routes ship with zero end-to-end coverage — the godmode chat, approvals UI, and model-runtime selector are validated only by type-checking and isolated unit tests.
   - Fix: Add minimal Playwright suite covering login → approvals list → approve flow, and run nightly.

4. **[high] Job-queue reaper, DLQ, and retry-idempotency are not tested.**
   - Evidence: `RunStore.requeueExpiredJobs` at `packages/jarvis-shared/src/state.ts:564` is production code; `Grep requeueExpiredJobs tests/**` returns zero hits. `jobs-claim-heartbeat.test.ts` mocks `requeueExpiredJobs: vi.fn()` (line 5) rather than exercising it. No test for "worker crashes mid-job → lease expires → reaper requeues → second worker claims" or for retry-idempotency when a worker's callback arrives *after* requeue.
   - Impact: Silent job loss or double-execution under worker crash — the core reliability claim of the queue is unasserted.
   - Fix: Add a lifecycle test using real SQLite: submit → claim → advance clock past lease → requeue → re-claim; assert single success.

5. **[med] Retrieval eval is gated at a trivially-passable threshold and hybrid fusion is mocked.**
   - Evidence: `tests/eval/retrieval/retrieval-benchmark.test.ts:101-117` — sparse domains gate on `hit_rate >= 0.15` (pass with random-ish retrieval). `tests/hybrid-retriever.test.ts:12-16` uses `mockEmbedFn = sin(i + text.length)` — dense similarity is derived from text *length*, so fusion is tested against a degenerate embedding. No assertion that hybrid beats sparse-only.
   - Impact: Knowledge-retrieval regressions (the value prop of the `knowledge-curator` agent) would not be caught; the only regulator/contract/proposal queries tested allow a 15% hit rate to pass.
   - Fix: Add a hybrid vs sparse-only *delta* test (hybrid MRR must exceed sparse by ≥X on the same corpus) and raise thresholds to the README's stated "hybrid target MRR ≥ 0.7" once real embeddings are wired.

6. **[med] Approval `modified_input` is written only as a stringified note — semantic substitution is not tested.**
   - Evidence: `packages/jarvis-dashboard/src/api/approvals.ts:146-147` stores `modified_input` solely inside the resolution note (truncated to 500 chars). No downstream consumer reads the modified payload back for execution; no test asserts that an operator-edited `email.send` payload substitutes into the job. `Grep modified_input tests/**` shows only `failure-injection.test.ts` and `smoke/integration.test.ts`, neither of which exercises the substitute-then-execute path.
   - Impact: Operators think they are editing the payload; they are annotating it. A critical governance contract silently no-ops.
   - Fix: Either remove the endpoint, or write a test that proves the modified payload reaches the worker.

7. **[med] Contract validation is structural only; no contract-vs-implementation conformance.**
   - Evidence: `scripts/validate-contracts.mjs:317-332` validates example JSON against schemas, and `assertDeepEqual` freezes the plugin-surface *text*. Nothing checks that the 17 plugin packages actually *export* the declared tool names or that a worker's runtime output conforms to the `job-result.schema.json`.
   - Impact: Drift between declared and implemented surface is invisible — a plugin could rename a tool and CI passes because the frozen list still matches itself.
   - Fix: Add a test that imports each plugin, reads `definePlugin({...tools})` output, and diffs against `plugin-surface.json`.

8. **[med] CI has no SAST, no CodeQL, no Dependabot, no mutation testing.**
   - Evidence: `.github/workflows/ci.yml` has `npm audit --audit-level=high` with `continue-on-error: true` (line 47-48). No `codeql-action`, no `dependabot.yml`, no `stryker` in `package.json`. Single runner (`windows-latest`), no Linux/macOS matrix despite cross-platform targets in code (`/etc` path-policy tests at `security-posture.test.ts:448`).
   - Impact: No defense-in-depth for supply chain, no signal on test effectiveness. Many tests assert `ok === true` where a logic-inversion would pass (e.g., `surface-readonly.test.ts`-style boolean-gate tests).
   - Fix: Add CodeQL + Dependabot; run one mutation-testing pass on `runtime/approvals.ts` and `jobs/claim.ts` to measure kill-rate; add a Linux job to the matrix.

## Positive notes

- **Architecture-boundary tests (`architecture-boundary.test.ts:97-225`) are exemplary**: lint-style source-grep assertions with a tracked legacy allowlist and a decreasing-target counter. This pattern should be reused for the contract-conformance gap in finding 7.
- **Approval stress coverage is genuinely deep** (`tests/stress/approval-exhaustive.test.ts` — severity × status matrix, 50-way concurrent request/resolve, audit-log invariants, BEGIN IMMEDIATE isolation). If this suite actually ran on PR CI it would be one of the strongest approval test-beds I've seen at this scale.
- **Zero `.skip` / `.only` / `.todo` in `tests/**`** — disciplined; no hidden disabled tests and no accidental focus.
