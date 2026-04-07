# Y1-Q2 Execution Hardening — Release Notes

**Version:** TBD
**Date:** TBD

## Summary

Execution boundaries are now real: worker crashes cannot kill the daemon, all workers have hard timeouts, the files bridge enforces filesystem policies, and irreversible actions are guarded at the worker level. Auth posture distinguishes dev from production mode. Worker health is tracked and reported.

## What Changed

### Error Boundaries

- Every worker execution is wrapped in try/catch. In-process worker crashes (thrown exceptions, rejected promises) now return a failed `JobResult` instead of killing the daemon process.
- Hard timeout via `Promise.race` enforced on all workers using per-prefix execution policies.
- Worker health monitor tracks execution outcomes, failure rates, and timeouts.

### Filesystem Policy

- Files bridge validates all paths against a configurable filesystem policy before any fs operation.
- Default policy allows `~/.jarvis/` and temp directory; denies `.env`, `credentials`, `.pem`, `.key`, and other secret files.
- Operators can customize allowed roots and denied patterns in config.

### Approval Guard

- Defense-in-depth: the worker registry now rejects jobs that require approval but haven't been approved, catching edge cases where the orchestrator might be bypassed.

### Auth Mode

- New `JARVIS_MODE` environment variable: `dev` (default) or `production`.
- Production mode with no API tokens configured returns 503 instead of silently granting admin access.
- Health endpoint now includes `mode` and `workers` fields.

### PR #60 Review Fixes

- `createCommand()` is now idempotent (duplicate webhook triggers return existing command instead of 500).
- Fixed notification status constraint violation (`'sent'` instead of `'delivered'`).
- Fixed corrupted lineage from using `notification_id` as `run_id`.
- Fixed duplicate inbound messages in Telegram bot.
- Added UNIQUE constraint on `channel_threads(channel, external_id)`.
- Fixed hard-coded "telegram" channel in orchestrator delivery recording.

## Migration

See `docs/quarters/y1-q2/migration-plan.md`.

- Migration `0004_channel_fixes` upgrades the channel threads index to UNIQUE.
- Auto-applied on daemon startup.

## Rollback

See `docs/quarters/y1-q2/rollback-note.md`.

- Revert code, downgrade UNIQUE index to non-unique, remove `JARVIS_MODE` env var.

## Configuration

New optional config fields:

```json
{
  "filesystem_policy": {
    "additional_roots": ["/path/to/project"],
    "additional_denied_patterns": ["secret"],
    "max_file_size_bytes": 52428800
  }
}
```

New environment variable: `JARVIS_MODE=dev|production`
