# DevOps/SRE — Red-team review

## Top findings

1. **[CRITICAL] OpenTelemetry is exported but never initialized — no metrics, no traces in practice.**
   - Evidence: `packages/jarvis-observability/src/setup.ts:23` defines `initTelemetry()`; only callers in the whole repo are its own declarations (grep shows no production call-site in `daemon.ts` or `server.ts`). `/api/metrics` at `packages/jarvis-dashboard/src/api/server.ts:232` returns prom-client text but the OTel SDK + HTTP auto-instrumentation + Prometheus exporter on port 9464 never start.
   - Impact: no request traces, no HTTP latency histograms, no span-level debugging during incidents. The observability package is dead code at runtime.
   - Fix: call `initTelemetry()` from both `daemon.ts main()` and `server.ts` startup, and `shutdownTelemetry()` from the shutdown paths.

2. **[CRITICAL] No alerting channel — errors write to a file nobody reads.**
   - Evidence: `packages/jarvis-runtime/src/logger.ts:110-124` — `sendAlert()` only appends to `~/.jarvis/alerts.jsonl`. No consumer, no pager, no email, no Telegram push. The notifier (`daemon.ts:445`) is only used for notifications the agents explicitly send, not for daemon fatals/warnings.
   - Impact: a 3am daemon crash, stuck queue, disk-full condition, or model-runtime outage will sit silent until the operator happens to open the dashboard.
   - Fix: wire `sendAlert()` into the `createNotificationDispatcher` path so ERROR-level log lines page via Telegram/session, and add a minimum rate-limit.

3. **[HIGH] `/api/health` claims "healthy" while embedding, scheduler, or model runtime is fully down.**
   - Evidence: `packages/jarvis-runtime/src/health.ts:163-168` — overall status only flips to "unhealthy" if CRM/knowledge/runtime DBs fail to open. A dead LM Studio, zero registered models, stuck dead-letter queue, worker-health regressions, or failed embedding runtime all collapse to "degraded" at worst, and `/api/health` returns HTTP 200 `ok:true` for anything except "unhealthy" (`server.ts:215`).
   - Impact: external uptime probes (Docker HEALTHCHECK, any future load balancer) will report green on a non-functional system.
   - Fix: return 503 for "degraded" when models_available=false, daemon stale, or disk <2GB; split liveness (`/api/ready`) from deep health more strictly.

4. **[HIGH] Backups never verify and never leave the machine.**
   - Evidence: `packages/jarvis-dashboard/src/api/backup.ts` and `scripts/ops/backup-runtime.mjs` write to `~/.jarvis/backups/` and `~/.openclaw-jarvis-backups/` — same disk, same host. No automated schedule (no cron/systemd timer), no retention pruning, no restore-test. Checksums are computed only in the `ops` script, not the dashboard backup path; the dashboard path skips WAL sidecars entirely.
   - Impact: disk-loss = total data loss. No confidence the restore flow actually works — only verified at restore-time.
   - Fix: add a scheduled nightly backup (systemd timer / Windows Task Scheduler), a `npm run ops:restore-test` that restores to a temp dir and runs integrity_check, retention (keep N), and optional rclone/S3 off-host target.

5. **[HIGH] First-run experience has silent failure modes and relies on an undocumented wizard.**
   - Evidence: `README.md:15` says `npm run jarvis setup`, but the engines field (`package.json:37`) is `>=22.5.0` while the project instructions and runtime target Node 24+. Setup runs `init-jarvis.ts` which will generate an API token only if none exists (`init-jarvis.ts:87-97`) — a re-run after partial failure can leave a mismatched token. `start.mjs` preflight (lines 38-82) checks file existence but not schema version, not migration drift, not disk free, not that any model runtime binary is present before spawning.
   - Impact: fresh clone users get a half-initialized `~/.jarvis/` and cryptic daemon errors; token mismatch locks them out of the dashboard they just started.
   - Fix: add `jarvis doctor` as a preflight (it exists in `packages/jarvis-runtime/src/doctor.ts` but is not run by `start.mjs`), fail fast on Node <22.5 with a clear message, and refuse to start if disk < 2GB.

6. **[HIGH] Graceful shutdown can orphan child runtimes and miss drain on Windows.**
   - Evidence: `scripts/start.mjs:121-136` — on Windows `terminateChild` uses `taskkill /T /F`, which is a force-kill: no SIGTERM, no drain, so a running `ollama serve` or `llama-server` never flushes. On Unix it sends SIGTERM once and does not escalate. The parent `shutdown()` sets a 3s `setTimeout` (line 331) before `process.exit`, so if the daemon takes its full 30s drain (daemon.ts `agentQueue.drain(30_000)`), the parent exits early and leaves the daemon orphaned.
   - Impact: orphan LLM processes pinning GPU/RAM across restarts; in-flight agent runs marked failed even when the daemon was seconds from completion.
   - Fix: parent should `await` the children's exit (not `setTimeout`), and escalate SIGTERM → SIGKILL after a larger drain window aligned with daemon's 30s.

7. **[MEDIUM] No service-manager integration — docker-compose.yml is a stub.**
   - Evidence: `docker-compose.yml` is 18 lines; no systemd unit, no Windows Service wrapper, no NSSM recipe. Operators are expected to run `npm start` in a terminal — if the terminal closes, Jarvis dies. No restart-on-crash, no boot-on-reboot.
   - Impact: production deployments cannot survive host reboots or operator logout without manual intervention. The "24/7" claim is aspirational.
   - Fix: ship a `deploy/jarvis.service` systemd unit and a `deploy/jarvis-windows-service.md` (NSSM/sc.exe) recipe; reference them from README.

8. **[MEDIUM] Secrets sit in plaintext at `~/.jarvis/config.json` with no rotation story.**
   - Evidence: `init-jarvis.ts:90-92` writes the generated API token directly into `config.json`. `config.ts` loads Gmail/Telegram/Anthropic credentials from the same file. No chmod 600 enforcement, no env-file encryption, no rotation command, no audit entry when tokens change.
   - Impact: one misconfigured backup share or accidental `git add` leaks all tokens; rotating the dashboard token means hand-editing JSON and restarting.
   - Fix: `chmod 600` on write, add `npm run jarvis rotate-token`, prefer env vars in production, document OS keyring option.

9. **[MEDIUM] Monitoring blind spot: dead-letter queue and worker crash loops log but do not surface.**
   - Evidence: `daemon.ts:546-554` logs "Dead-letter: command … stuck" as a `warn` only; the dashboard Repair page shows stale_claims/orphan_runs counts but there is no alert threshold, no cumulative count over time, no metric counter. Worker crash loops are captured in `WorkerHealthMonitor` but not exported to Prometheus despite a `workerHealthRatio` metric being declared.
   - Impact: a stuck agent failing every 60s can churn for hours; the only signal is a line in `daemon.log` that nobody tails.
   - Fix: increment the existing `workerHealthRatio` / `queueDepth` metrics in the poll loop and the worker-health updater; add a Repair check for "N dead-letter commands in last hour".

10. **[LOW/MEDIUM] Support bundle is too thin to diagnose a real incident.**
    - Evidence: `packages/jarvis-dashboard/src/api/support.ts:31-78` returns last 20 runs, 50 failed events, 20 audit entries, pending approvals, heartbeat — no logs, no config summary, no model registry, no migration state, no worker-health detail, no OS info beyond node/platform/uptime.
    - Impact: the first question in every real incident ("what's in daemon.log around the failure? which migration is applied? what's the config?") cannot be answered from the bundle.
    - Fix: include last N KB of `daemon.log` (already redacted), redacted config summary, migration IDs, worker health table, disk free, and the last `/api/repair` report.

## Positive notes

- **Restart recovery is thoughtful**: `daemon.ts:393-433` recovers stale command claims and stuck runs on startup, transitions via RunStore (state-machine validated), and writes an audit entry — far better than the usual "everything stays in executing forever" failure mode.
- **Safe mode with auto-exit works**: `daemon.ts:667-700` skips autonomous polling when broken and re-checks every 60s so operator edits to config.json take effect without a restart — good operability primitive.
- **Backup/restore has a rollback snapshot and post-restore `PRAGMA integrity_check`** (`backup.ts:224-301`) — above-average for a v0.1 system, even if it never leaves the host.
