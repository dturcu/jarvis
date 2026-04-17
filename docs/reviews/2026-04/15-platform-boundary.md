# Platform Boundary Reviewer -- Red-team review

Scope: ADR boundary, convergence defaults, architecture tests, contract layer, legacy endpoints, OpenClaw pinning.

## Top findings

1. **[High] CLAUDE.md "webhook ingress eliminated" contradicts shipping code.**
   - Evidence: `CLAUDE.md:63` and `docs/CONVERGENCE-ROADMAP.md:94` say webhooks are "eliminated" with "webhooks.ts deleted; v2 normalizer serves both paths." But `packages/jarvis-dashboard/src/api/webhooks-v2.ts` is 400+ lines of Express routes writing directly to `runtime.db` via `defaultOnEvent` (L74-80), still opens raw SQLite handles (L54-59), and `legacy-deletion-checklist.ts:105-108` lists `/api/webhooks-v2` as unremoved. `server.ts:147-150` comments it as "REMOVED" but the file and router factory are fully shipped and imported by the runtime.
   - Impact: Roadmap status is false; a new engineer reading the table will believe the duplication is gone and touch dashboard DB writes with impunity.
   - Fix: Either delete `webhooks-v2.ts` and `createWebhookRouter` (Epic 4 truly done) or change the Wave 8 status from "Eliminated" to "Router deleted, normalizer exported."

2. **[High] OpenClaw version drift: root pins `^2026.4.8`, every plugin pins `^2026.4.2`.**
   - Evidence: `package.json:47` is `"openclaw": "^2026.4.8"`; `packages/jarvis-{shared,core,browser,jobs,dispatch,device,files,interpreter,inference,email-plugin,agent-plugin,...}/package.json` all pin `^2026.4.2`. 20+ packages are on an older caret range than the monorepo root.
   - Impact: Workspace hoisting silently resolves one version -- but on a clean plugin-extraction install, plugins will pull a different OpenClaw than the runtime, so SDK types (`OpenClawConfig`, `callGatewayTool`) can diverge. This is exactly the plugin-compatibility gap Gate D calls out ("plugin manifest validation rejects incompatible plugins").
   - Fix: Add `scripts/check-openclaw-pin.mjs` to CI that asserts every workspace package declares the same caret as root, and bump all packages in lockstep.

3. **[High] Architecture-boundary test lets legacy files bypass every rule via wide exclusion.**
   - Evidence: `tests/architecture-boundary.test.ts:81-93` builds `ALL_LEGACY` as a regex union of 4 patterns and passes it as `exclude` to every scan. Any line added to `godmode.ts`, `chat.ts`, `bot.ts`, `relay.ts`, `chat-handler.ts`, `vision-handler.ts`, `webhooks-v2.ts`, or `chrome-adapter.ts` is invisible to the boundary test -- including brand-new forbidden patterns. `chat.ts:520` still carries `http://127.0.0.1:9222` CDP calls and gets no warning.
   - Impact: Legacy files become an un-policed bunker where new platform duplication can hide. A developer fixing a bug in `godmode.ts` can freely add a new `api.telegram.org` call.
   - Fix: Freeze legacy files by LOC (commit a line-count snapshot; fail CI on growth) so exclusions can't absorb new duplication.

4. **[High] No test shows the architecture-boundary test actually fails.**
   - Evidence: `tests/architecture-boundary.test.ts` has no negative/self-test case. A typo in the regex (e.g., missing `/g` flag, wrong file-type filter) would silently pass. `getSourceFiles()` uses `git ls-files` so newly-added files outside git show as zero.
   - Impact: The canary can be dead without anyone noticing. Regression protection is unverified.
   - Fix: Add a fixture file under `tests/fixtures/boundary-violations/` containing a deliberate `api.telegram.org` line, and a test that runs the scanner against it and expects exactly one violation.

5. **[Medium] jarvis.v1 contract has no v2 path, no backward-compat rules, no schema-change gate.**
   - Evidence: `packages/jarvis-shared/src/contracts.ts:1` defines `CONTRACT_VERSION = "jarvis.v1"` as a single const; 144 job types share one namespace. No `CONTRACT_VERSION_NEXT`, no `X-Jarvis-Contract-Version` negotiation, no `additionalProperties: false` policy in the top-level envelope. The word "v2" appears nowhere in contracts/.
   - Impact: First breaking schema change forces either a fleet-wide flag-day or undocumented additive-only convention. No test asserts "new fields are optional, removed fields are compatibility-shimmed." Workers and dashboard will ship at different tempos -- a worker reading a removed field will crash.
   - Fix: Add `docs/ADR-CONTRACT-VERSIONING.md` codifying additive-only rules for v1 + a vitest that diffs every schema against `main` and fails on field removal or required-flag additions.

6. **[Medium] Convergence metric exists but has no rollout-percentage gate.**
   - Evidence: `legacyPathTraffic` and `sessionModeTotal` Prometheus counters exist (`jarvis-observability/src/metrics.ts:161`; `session-chat-adapter.ts:525,532`). `docs/RELEASE-GATES.md` never references them. No test checks "legacy < 5% of operator chats before removal." `PRE_DELETION_CHECKS` in `legacy-deletion-checklist.ts:132-142` is a plain-English list, not an automated gate.
   - Impact: The release gates for deleting legacy endpoints (2026-07-01 target for godmode/chat, 2027-01-01 for chrome-adapter) rely on vibe, not data.
   - Fix: Add a `check:convergence-metrics` CI step reading local Prometheus and asserting `legacyPathTraffic / (legacyPathTraffic + sessionModeTotal{mode="session"}) < 0.05` before allowing deletion.

7. **[Medium] Duplicate runtime-detection logic straddles the boundary.**
   - Evidence: `scripts/runtime-detect.mjs` and `packages/jarvis-dashboard/src/api/runtimes.ts:48-85` (`findOllamaBinary`, `findLmStudioBinary`, `findLlamaCppBinary`) re-implement the same Windows/Unix path candidates, env-var lookups, and config fallbacks. Dashboard code does not import from `scripts/` so there is no single source of truth.
   - Impact: Behaviour drift on `OLLAMA_PATH` / `LMS_PATH` resolution between auto-boot and dashboard "Load model" button. Maintenance cost on every new runtime (llama.cpp was added in both places).
   - Fix: Move the binary detection + runtime config reading into `@jarvis/inference` or `@jarvis/system` and consume from both places.

8. **[Medium] No sunset headers on legacy endpoints; only `X-Jarvis-Deprecation` on webhooks.**
   - Evidence: `webhooks-v2.ts:37-38` emits `X-Jarvis-Deprecation: webhook-v1`. But `/api/godmode/legacy` (`godmode.ts:378`) and `/api/chat/telegram` emit only `console.warn`. No `Sunset:` header per RFC 8594, no `Deprecation:` header per RFC 9745, no machine-readable removal date though `legacy-deletion-checklist.ts:54` already knows `2026-07-01`.
   - Impact: External callers (CI, integrations) have no way to detect deprecation programmatically. Removal on 2026-07-01 will surprise at least one caller.
   - Fix: Add middleware that attaches `Deprecation: @2026-04-17` + `Sunset: Wed, 01 Jul 2026 00:00:00 GMT` to every mounted legacy router, sourced from `legacy-deletion-checklist.ts`.

9. **[Low] `plugin-surface.json` declares 19 plugins but is not consumed as a conformance test.**
   - Evidence: `contracts/jarvis/v1/plugin-surface.json` lists each plugin's `tools`/`commands`/`http_routes`. No test loads it and diffs against actual `definePluginEntry` registrations. A plugin could silently add a new tool or drop one.
   - Impact: The "stable plugin surface" promise in CLAUDE.md is docs-only; drift will appear at the next OpenClaw upgrade.
   - Fix: Add a vitest that imports each plugin, reads its registered `tools`/`commands`/`http_routes`, and deep-equals against plugin-surface.json.

## Positive notes

- **Strict boundary rules are real.** ADR-PLATFORM-KERNEL-BOUNDARY.md names the 4 forbidden patterns, the boundary test implements regex checks for each, and `convergence-final.test.ts:50-94` wires them to the 5 "definition of done" exit conditions -- that's more enforcement than most platform splits get.
- **Deprecation machinery is surprisingly complete.** `legacy-deletion-checklist.ts` enumerates files, routes, and env vars with owners and retirement dates; `convergence-checks.ts` warns `jarvis doctor` operators when legacy env vars are set; `@deprecated` JSDoc markers are present on every legacy file. The plumbing is there -- wiring sunset headers and a metrics gate would close the loop.
- **Session adapter demonstrates the target pattern cleanly.** `session-chat-adapter.ts` with circuit-breaker + explicit `legacyFallback` is a good reference implementation of "converge, don't cutover."
