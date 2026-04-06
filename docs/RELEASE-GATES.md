# Release Gates

Each gate has objective pass criteria. A gate is either passed or not -- no partial credit.

## Gate A -- Control Plane Exists

**Release**: R1 (Runtime Control Plane Foundation)

**Pass criteria**:

- [ ] No `approvals.json` in runtime path. All approval state lives in `runtime.db`.
- [ ] No `trigger-*.json` files consumed. All triggers insert `agent_commands` rows.
- [ ] No `daemon-status.json` for runtime truth. Daemon heartbeat is DB-backed.
- [ ] No `telegram-queue.json`. Notification queue is DB-backed.
- [ ] In-memory `SchedulerStore` replaced with DB-backed store. Schedules survive restart.
- [ ] In-memory `AgentMemoryStore` long-term entries persist in DB. Survive restart.
- [ ] Run lifecycle is durable. Run state machine enforced. Every transition emits a `run_events` row.
- [ ] `godmode.ts` executes tools exactly once per request (no duplicate execution).
- [ ] No `haiku`/`sonnet`/`opus` references remain in source, contracts, or tests.
- [ ] All inference routing uses `TaskProfile` / `SelectionPolicy`.
- [ ] Config validation fails fast on invalid config. `validateConfig()` exists for `jarvis doctor`.
- [ ] Cron schedules fire in local time, not UTC.
- [ ] `npm run check` passes (contracts + tests + build).

## Gate B -- Runnable 9/10

**Release**: R2 (Appliance-Grade Runnable System)

**Pass criteria**:

- [ ] `jarvis init` works on a clean machine without manual DB prep.
- [ ] `jarvis doctor` reports pass/warn/fail checks and exits nonzero on critical failures.
- [ ] `jarvis start` and `jarvis stop` work correctly. Daemon drains gracefully on stop.
- [ ] Health endpoint (`/api/health`) returns structured status reflecting real state.
- [ ] Readiness endpoint (`/api/ready`) reflects daemon heartbeat, migration state, model runtime reachability.
- [ ] Smoke test suite passes: clean init, migration, daemon boot, health check, simple agent run, approval flow, restart recovery, backup/restore.
- [ ] Backup creates a restorable artifact including runtime.db, crm.db, knowledge.db, config, and plugin manifests.
- [ ] Restore validates integrity before applying and works end-to-end.
- [ ] At least one agent (garden-calendar) runs fully on the new durable control plane.
- [ ] Structured logging includes correlation IDs (run_id, agent_id, command_id).
- [ ] CI workflow runs install + typecheck + test + `npm run check` + smoke subset.

## Gate C -- Safe Local Production

**Release**: R3 (Safe Local Production)

**Pass criteria**:

- [ ] All `/api/*` routes require authentication (except `/api/health`).
- [ ] Role-based access control enforced: admin, operator, viewer.
- [ ] `Access-Control-Allow-Origin: *` is gone. CORS restricted to configured origins.
- [ ] All webhook/trigger routes require HMAC signature or authentication. No anonymous triggers in production.
- [ ] Audit log covers: approvals/rejections, manual starts/stops/retries, settings changes, plugin changes, auth events, webhook events.
- [ ] Secrets are redacted in logs. Missing required secrets block startup of relevant integrations.
- [ ] Risky workers (browser, interpreter, social, device, files) run as child processes with hard timeout, crash restart, and filesystem allowlist.
- [ ] Worker failure does not kill the daemon process.
- [ ] Rate limits on sensitive endpoints.
- [ ] Safe to leave running continuously on the machine.

## Gate D -- Production 9/10

**Releases**: R4 through R8

**Pass criteria**:

- [ ] Model discovery persists discovered models in `model_registry`.
- [ ] Benchmark cache persists results in `model_benchmarks`. No heavy benchmarking on every startup.
- [ ] Model routing is evidence-based: `selectByProfile()` consults registry + benchmarks.
- [ ] Model routing decisions are explainable in logs or dashboard.
- [ ] Multi-viewpoint planning exists for at least one high-value agent (planner/critic/verifier/arbiter).
- [ ] Severe planning disagreement blocks blind execution and requires human approval.
- [ ] Plugin manifest validation rejects invalid or incompatible plugins.
- [ ] Plugins declare required permissions and cannot access undeclared capabilities.
- [ ] Plugin install/uninstall is transactional: succeeds fully or rolls back.
- [ ] All agents migrated to durable control plane by risk order.
- [ ] Each agent has an explicit maturity level (experimental, operational, trusted_with_review, high_stakes_manual_gate).
- [ ] High-stakes agent outputs (ISO 26262, contracts) cannot bypass human review. Marked as draft until operator accepts.
- [ ] Entity graph and lesson capture updates are traceable to source runs.
- [ ] 24h soak test passes without state corruption.
- [ ] Failure injection suite: runtime recovers or fails safely for each injected failure (model unavailable, worker crash, browser hang, stale claim, malformed command, low disk, restore after live use).
- [ ] Release process exists: versioning, changelog, migration notes, backup-before-upgrade, rollback plan.
- [ ] Upgrade path from prior version is tested.
- [ ] Production docs sufficient for a fresh operator to install, run, back up, restore, and troubleshoot.
