# Y1-Q4 Appliance Reliability — Release Notes

**Version:** TBD
**Date:** TBD

## Summary

Year 1 closes with an appliance-grade diagnostic and readiness system. The doctor now verifies daemon health, migration status, and channel infrastructure. The readiness report validates config and channel table existence. A clean-machine smoke test suite ensures end-to-end install-to-run reliability.

## What Changed

### Doctor Enhancements

- **Daemon heartbeat check**: reports daemon running/stopped/never-run with PID and staleness
- **Migration status check**: verifies latest migration applied per database (runtime, CRM, knowledge)
- **Channel table check**: runtime DB check now includes all 17 tables (was 14)
- Check ordering: Node → directory → config → databases → migrations → WAL → daemon → models → chrome → dashboard → disk

### Readiness Report

- Added `config_valid` check: verifies `~/.jarvis/config.json` loads and has required fields
- Added `channel_tables` check: verifies Q1 channel persistence tables exist
- `ready` status now requires config and channel tables to be valid (was: only databases + daemon)

### Clean-Machine Smoke Tests

- New `tests/smoke/appliance-readiness.test.ts` with tests for:
  - Readiness report field completeness
  - Migration completeness (4 migrations, 17 tables)
  - UNIQUE constraint enforcement on channel threads
  - Health report sections (channels, workers)

## Year 1 Summary

| Quarter | PR | What it delivered |
|---------|-----|-------------------|
| Q1 | #60 | Channel persistence, unified command creation, run timeline API |
| Q2 | #61 | Error boundaries, hard timeouts, filesystem policy, auth mode, worker health |
| Q3 | #62 | Pack classification (core/experimental/personal), maturity enforcement |
| Q4 | This | Doctor enhancements, readiness hardening, clean-machine smoke tests |

## Rollback

See `docs/quarters/y1-q4/rollback-note.md`. Code-only revert, no data migration.
