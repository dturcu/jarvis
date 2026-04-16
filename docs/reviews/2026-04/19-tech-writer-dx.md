# Technical Writer / DX — Red-team review

## Top findings (9)

1. **[critical] CLAUDE.md and README.md disagree on agent count and quick-start — first-run will fail**
   - Evidence: `CLAUDE.md:3` says "8 production agents"; `README.md:5` says "14 domain agents" and lists 14 in three tiers. `CLAUDE.md:9-13` quick-start runs `npx tsx scripts/init-jarvis.ts && npm run check`; `README.md:9-20` quick-start runs `npm run jarvis setup && npm start`. `docs/USAGE.md:3` says 8. `docs/JARVIS.md:17` says 8.
   - Impact: A new operator following README.md sees `npm run jarvis setup` but `docs/USAGE.md` tells them `npx tsx scripts/init-jarvis.ts` — two different init paths with no cross-reference. The "14 vs 8 agents" discrepancy makes the system look abandoned mid-migration.
   - Recommended fix: Pick one canonical onboarding path, document "Core 8 + Extended 6 = 14" in a single agents table, and make CLAUDE.md a pointer to README.md for quick-start.

2. **[critical] `.env.example` is missing ~80% of the env vars the code actually reads**
   - Evidence: `.env.example` (61 lines) documents `PORT`, `LMS_URL`, `LMS_MODEL`, `LLAMACPP_URL`, `JARVIS_API_TOKEN`, `JARVIS_TELEGRAM_*`, `JARVIS_WEBHOOK_SECRET`, `JARVIS_CORS_ORIGIN`, `JARVIS_PROJECT_ROOT`. The code also reads (undocumented): `JARVIS_BIND_HOST`, `JARVIS_MODE`, `JARVIS_TELEGRAM_MODE`, `JARVIS_BROWSER_MODE`, `JARVIS_HTTP_ACCESS_LOG`, `NODE_ENV`, `appliance_mode` (config), plus runtime paths referenced in `scripts/runtime-detect.mjs`.
   - Impact: Operators cannot discover security-critical knobs (`JARVIS_BIND_HOST`, `JARVIS_MODE`) without grep. The `CLAUDE.md` "Wave 8 convergence" section references `JARVIS_TELEGRAM_MODE=legacy` that doesn't exist in `.env.example`.
   - Recommended fix: Add every env var the code reads to `.env.example` with `purpose | default | allowed values | when to change`; add a CI test that greps `process.env.JARVIS_*` and fails if any name is missing from `.env.example`.

3. **[high] No docs index, no "start here", no Diataxis split**
   - Evidence: `docs/` contains 30+ top-level .md files with no `INDEX.md` or `README.md` in that directory. ADRs, runbooks, roadmaps, glossary, specs, review reports, and tutorials are all siblings. `docs/JARVIS.md` is a 1,277-line monolith mixing reference, tutorial, and architectural narrative. Quarter folders (`docs/quarters/y1-q1..y3`) intermingle release notes, rollback notes, and migration plans without a top-level map.
   - Impact: A newcomer trying to "read the docs" has to guess. Search across 30 files is the only navigation — no category, no ordering, no discovery path. Tutorial-grade content (USAGE.md) and reference-grade content (JARVIS.md) are indistinguishable from ADRs.
   - Recommended fix: Create `docs/README.md` as a Diataxis-structured index (Tutorials → How-tos → Reference → Explanation) and move ADRs to `docs/adr/`, runbooks to `docs/runbooks/` (already done), specs to `docs/specs/` (already done). Link from README.md "Documentation" table.

4. **[high] API surface (contracts/jarvis/v1) has zero human-readable consumer docs**
   - Evidence: `contracts/jarvis/v1/` contains 25 JSON Schema files, a 144-entry `job-catalog.json`, 145 example files in `examples/`, and one README-less directory. `docs/specs/jarvis-plugin-api-v1.md` exists but is plugin-author-oriented, not consumer-oriented. No browsable HTML, no "how do I call job X" tutorial, no index that groups jobs by family with links to schema + example.
   - Impact: Anyone building a worker, integration, or client must read raw JSON Schema and job-catalog entries side-by-side. 144 job types is the platform's main API surface and it's effectively undocumented.
   - Recommended fix: Generate a static HTML site from the schemas (json-schema-static-docs or redocly) checked into `docs/api/` in CI, plus one `docs/api/README.md` grouping the 27 families with 1-line purpose + link.

5. **[high] Dashboard error messages are unsearchable and un-actionable**
   - Evidence: `packages/jarvis-dashboard/src/api/runs.ts:134` returns `{ error: 'Database error' }`; `runs.ts:251,292,311,348` all return bare `{ error: 'Failed to X' }`. `agents.ts:152` returns `'Failed to queue agent command'`. `conversations.ts` has 6 identical `'Failed to …'` strings. None include: error code, correlation ID, suggested next step, or link to a runbook.
   - Impact: When a user hits "Failed to build run timeline", they have zero way to self-serve — no error code to search, no doc to consult, no retry hint. Support burden falls entirely on the operator reading server logs.
   - Recommended fix: Adopt a `{ error: { code: "RUN_TIMELINE_FAIL", message, correlation_id, docs_url: "/docs/errors#RUN_TIMELINE_FAIL" } }` envelope, and ship `docs/ERRORS.md` with one entry per code including "likely cause" and "next step".

6. **[high] No "how to add a new agent" guide, no CONTRIBUTING.md**
   - Evidence: `Glob CONTRIBUTING*` returns only `node_modules/…` matches — there is no repo-level `CONTRIBUTING.md`. README.md lacks any "adding an agent / plugin / worker" section. `docs/AGENT-MIGRATION-MAP.md` documents the *legacy* migration but not the forward path. `.github/` contains only PR templates and workflows.
   - Impact: Collaborators (or future-you) must reverse-engineer conventions from existing agents. Cannot onboard a second developer without pairing. Extended-tier agents are listed in README but the roster is opaque to contributors.
   - Recommended fix: Add `CONTRIBUTING.md` with numbered recipes for "add an agent" / "add a plugin tool" / "add a worker" / "add a test", each pointing to concrete files to copy.

7. **[medium] Glossary is incomplete — "Wave 8", "TaskProfile", "SelectionPolicy", "godmode", "attention" undefined**
   - Evidence: `docs/GLOSSARY.md` defines Agent, Plugin, Worker, Tool, Job, Run, Command, Approval, Artifact, Channel, Thread, Envelope, Product Tier, Maturity, Appliance Mode — but not: `TaskProfile`, `SelectionPolicy`, `Wave 8 convergence`, `godmode` (used in `packages/jarvis-dashboard/src/api/godmode.ts` and README.md:102), `attention` (API route), `dispatch`, `dreaming` (`dreaming.ts`), `lesson capture`, `safemode`.
   - Impact: README.md and CLAUDE.md use `TaskProfile`/`SelectionPolicy` as if they are household words (`docs/ARCHITECTURE.md:74`). Reading "godmode" and "dreaming" in the code without a glossary entry makes them feel inside-jokey.
   - Recommended fix: Add one glossary entry per unexplained noun in code/docs; add a CI test that greps for top-level identifiers and fails for any not in `GLOSSARY.md`.

8. **[medium] Architecture diagrams exist but aren't versioned with code — no freshness signal**
   - Evidence: `docs/ARCHITECTURE-DIAGRAMS.md` (21KB) and `docs/JARVIS.md` (55KB, mermaid) are dated manually at the top ("Generated from source: 2026-04-10"). No CI check that counts plugins/agents/job-types and compares with the numbers in docs ("19 plugins", "144 job types", "27 families"). README.md says "19 plugins" but the architecture block lists 19 while `docs/JARVIS.md` lists the same — any drift will be silent.
   - Impact: As plugins are added/removed, diagrams and counts will go stale without anyone noticing. Platform-adoption roadmap already mentions "Wave 8 final cleanup" — doc drift during waves is the norm.
   - Recommended fix: Add `scripts/validate-docs-counts.mjs` to `npm run check` that parses `contracts/jarvis/v1/job-catalog.json`, counts plugins in `packages/`, and greps README.md/JARVIS.md/CLAUDE.md for the numbers — fail on mismatch.

9. **[medium] No CHANGELOG.md, package-level READMEs missing**
   - Evidence: `Glob packages/*/README.md` returns nothing — all 44 packages lack a README. `Glob CHANGELOG*` returns only node_modules matches. Release notes are scattered across `docs/quarters/y*-q*/release-notes.md` with no aggregation.
   - Impact: npm-centric tools (`npm view @jarvis/core`) show nothing; new plugins have no discoverability. Users cannot see "what changed between yesterday and today" without reading git log. SECURITY.md references "Latest on master" as the only supported version — no version discipline.
   - Recommended fix: Generate `packages/*/README.md` stubs from package.json descriptions + public exports (one-time script); add a root `CHANGELOG.md` (Keep-a-Changelog format) regenerated from quarter release notes on release.

## Positive notes (3)

- **SECURITY.md is honest and minimal** — explicit "no public issue" policy, disclosure email, SLA (48h ack / 7d fix), and a crisp security-architecture paragraph. Matches Stripe/Temporal baseline.
- **`scripts/start.mjs` pre-flight is a DX gem** — colorized problem/fix pairs (`preflight()` lines 38-82) with concrete one-liner remediation is the right error pattern; port-in-use and "already running" detection with heartbeat freshness is exactly what operators need. The rest of the codebase should copy this style.
- **Glossary exists at all, and WHAT-JARVIS-IS-NOT.md explicitly documents non-goals** — rare and valuable. THREAT-MODEL.md + KNOWN-TRUST-GAPS.md pair (honest "what's not yet enforced") is an unusually mature artifact for a single-operator system.
