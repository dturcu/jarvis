# Y1-Q2 Execution Hardening — Integration Checklist

## PR #60 Review Fixes

- [ ] `createCommand()` is idempotent (INSERT OR IGNORE + lookup on dedup)
- [ ] `createCommand()` accepts `externalMessageId` for channel correlation
- [ ] Safe-mode threshold changed from `< 4` to `< 7`
- [ ] Notification status uses `'sent'` not `'delivered'` (matches schema CHECK)
- [ ] Relay does not create delivery records with `notification_id` as `run_id`
- [ ] Telegram bot does not record duplicate inbound messages for trigger commands
- [ ] Telegram bot enables `PRAGMA foreign_keys = ON`
- [ ] Orchestrator uses originating thread's channel, not hard-coded `"telegram"`
- [ ] Migration 0004 adds UNIQUE constraint on `channel_threads(channel, external_id)`
- [ ] Migration-plan.md DDL matches actual 0003 migration

## Error Boundaries

- [ ] Worker crash (thrown exception) returns failed `JobResult` without killing daemon
- [ ] Worker rejection (rejected promise) returns failed `JobResult` without killing daemon
- [ ] Subsequent job executes successfully after prior worker crash
- [ ] Error boundary wraps ALL workers (in-process and child-process)

## Hard Timeout

- [ ] All worker executions have a hard timeout via `Promise.race`
- [ ] Timeout uses execution policy timeout (per-prefix)
- [ ] Timed-out worker returns `WORKER_TIMEOUT` error code
- [ ] Health monitor records timeout events

## Approval Guard

- [ ] Jobs requiring approval with wrong `approval_state` are rejected at worker level
- [ ] Guard only fires for prefixes with `requires_approval_guard: true`
- [ ] Guard is defense-in-depth (orchestrator is primary enforcer)

## Filesystem Policy

- [ ] Files bridge validates all paths before fs operations
- [ ] Paths outside allowed roots are rejected with `FILESYSTEM_POLICY_VIOLATION`
- [ ] Denied patterns block `.env`, `credentials`, `.pem`, `.key`, `id_rsa` paths
- [ ] Policy is loaded from config with operator overrides
- [ ] Default policy allows `~/.jarvis/` and temp directory

## Auth Mode

- [ ] Production mode with no tokens returns 503
- [ ] Dev mode with no tokens grants synthetic admin
- [ ] Health endpoint includes `mode` field
- [ ] `JARVIS_MODE` env var controls mode

## Worker Health

- [ ] `WorkerHealthMonitor` tracks per-worker execution outcomes
- [ ] Health classification: healthy (<10% failure), degraded (10-50%), unhealthy (>50%)
- [ ] Ring buffer limits to last 50 outcomes per worker
- [ ] Health report includes worker entries
- [ ] Health report includes `auth_mode`

## Migration

- [ ] Migration 0004 (channel_fixes) applies cleanly on existing DB
- [ ] Migration 0004 applies cleanly on fresh DB
- [ ] UNIQUE index prevents duplicate channel threads

## Tests

- [ ] All existing tests pass with updated migration counts
- [ ] New tests: execution-policy, filesystem-policy, worker-health, failure-injection
- [ ] Build compiles cleanly
- [ ] Contract validation passes
