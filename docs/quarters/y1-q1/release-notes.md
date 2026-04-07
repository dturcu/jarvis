# Y1-Q1 Kernel Unification — Release Notes

**Version:** TBD
**Date:** TBD

## Summary

All channel ingress (Telegram, email, dashboard, webhook) now routes through the durable runtime kernel. No execution surface bypasses the command -> run -> job flow.

## What Changed

### Channel Persistence

- New `channel_threads`, `channel_messages`, and `artifact_deliveries` tables track conversation context across all channels
- Every inbound message that triggers work creates a durable audit trail

### Telegram

- Telegram bot refactored from direct execution to ingress adapter
- All Telegram-initiated work now appears in run history with source attribution
- Message and thread IDs linked to runs for traceability

### Godmode / Dashboard

- Godmode refactored from direct execution to orchestration viewer
- Dashboard run creation uses the same unified path as all other channels

### Run Timeline

- New unified run timeline API shows execution lineage across channels
- Operator can trace from inbound message to artifact to approval decision

## Migration

See `docs/quarters/y1-q1/migration-plan.md` for full details.

- Three new tables added (no existing tables modified)
- Run `npx tsx scripts/setup-jarvis.ts` or the daemon auto-migrates on startup

## Rollback

See `docs/quarters/y1-q1/rollback-note.md`.

- Drop three new tables, revert code, restart daemon
- No existing data affected

## Known Limitations

- Webhook ingress adapter is minimal; full webhook configuration UI deferred to later quarter
- Channel message content is stored as preview only, not full content
