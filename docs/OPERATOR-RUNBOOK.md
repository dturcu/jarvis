# Operator Runbook

Concise reference for day-to-day Jarvis operation. For architecture details see ARCHITECTURE.md.

## Secure Installation

1. **Run the setup wizard.** `npx tsx scripts/init-jarvis.ts` creates `~/.jarvis/`, initializes SQLite databases (runtime.db, crm.db, knowledge.db), and writes a starter `config.json`.

2. **Generate an API token.** Add `api_token` to `~/.jarvis/config.json` or set `JARVIS_API_TOKEN` env var. Without a token, dev mode grants read-only (viewer) access; production mode (`JARVIS_MODE=production`) refuses to start.

3. **Enable appliance mode.** Set `JARVIS_MODE=production` to enforce token requirement and tighten defaults. The dashboard binds to `127.0.0.1` by default; do not set `JARVIS_BIND_HOST=0.0.0.0` unless you have a firewall in front.

4. **Verify installation.** Run `jarvis doctor` to check Node.js version, database health, config validity, and migration state. Fix any `fail` results before starting the daemon.

## Daily Operation

### Checking Health

- **Health endpoint**: `GET /api/health` -- returns structured status for all databases, channels, and workers. Always public (no auth required).
- **Readiness endpoint**: `GET /api/ready` -- returns boolean `ready` plus individual checks (jarvis_dir, crm_db, knowledge_db, runtime_db, daemon_running, config_valid, channel_tables). Always public.
- **Dashboard**: The web UI shows agent run history, pending approvals, and worker status.

### Reviewing Approvals

- Pending approvals appear in the dashboard and Telegram channel.
- Resolve via dashboard (`POST /api/approvals/:id/approve` or `/reject`) or Telegram (`/approve <id>`, `/reject <id>`).
- 17 job types always require approval (email.send, publish_post, trade_execute, etc.). 33 are conditional. 93 never require approval.
- Stale approvals do not auto-approve. They remain pending until explicitly resolved or expired.

### Monitoring Agents

- `GET /api/runs` lists recent agent runs with status (queued, planning, executing, completed, failed, cancelled).
- Each run emits events to the `run_events` table for full audit trail.
- Scheduled agents run automatically via cron. Manual agents are triggered on demand.

## Common Failure Scenarios

### Daemon Crash

**Symptom**: `/api/ready` shows `daemon_running: false`. Dashboard shows stale data.

**Recovery**: Restart the daemon (`jarvis start`). The daemon writes heartbeats every 10 seconds; the readiness check considers a heartbeat stale after 30 seconds. All run state is durable in SQLite -- no in-memory state is lost on crash.

### Stale Approvals

**Symptom**: Agents stuck in `awaiting_approval` state with no one resolving.

**Recovery**: Review pending approvals in the dashboard or Telegram. Reject stale ones to unblock the pipeline. Consider delegating to another operator (`delegateApproval`).

### Database Corruption

**Symptom**: `jarvis doctor` reports `fail` for a database check. Queries return errors.

**Recovery**:
1. Stop the daemon.
2. Restore from backup: `npx tsx scripts/ops/restore-runtime.mjs <backup-path>`. The restore script validates checksums before applying.
3. Run `jarvis doctor` to verify the restored state.
4. Restart the daemon.

If no backup exists, re-initialize with `npx tsx scripts/init-jarvis.ts` (this resets state).

### Worker Failure

**Symptom**: A specific job type consistently fails. Dashboard shows worker errors.

**Recovery**: Worker crashes do not kill the daemon. Check logs for the failing worker. Child-process workers (browser, interpreter, files, device, voice, security, social) restart automatically. In-process workers require a daemon restart if they corrupt shared state.

## Key Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | Structured health status |
| `GET /api/ready` | none | Boolean readiness gate |
| `GET /api/support/bundle` | admin | Diagnostic bundle (logs, config, DB stats) |
| `GET /api/runs` | viewer | Recent agent runs |
| `GET /api/approvals` | operator | Pending/resolved approvals |
| `POST /api/backup` | admin | Trigger backup |
| `POST /api/auth/rotate` | admin | Rotate API token |
