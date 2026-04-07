# Year 3 — Platform Maturity Release Notes

## Summary

Year 3 hardens Jarvis into a category-defining appliance across four quarters: plugin platform enforcement, formal artifact lifecycle, upgrade/observability infrastructure, and final polish including all Y2 review fixes.

## Q9: Plugin Platform
- Manifest checksum (`checksum_sha256`) for integrity verification
- Version compatibility gating (`min_jarvis_version`, `max_jarvis_version`) with semver comparison
- `JARVIS_PLATFORM_VERSION` constant for runtime version identity
- Plugins targeting incompatible versions are rejected at validation time

## Q10: Artifact Engine
- Formal artifact lifecycle: draft → review → approved → delivered → superseded
- State machine with enforced valid transitions
- `requiresApproval()`, `canDeliver()`, `isTerminal()` guards
- `getAllowedTransitions()` for UI state rendering

## Q11: Upgrade and Observability
- `ReleaseInfo` type with version, migrations, changelog, rollback safety
- `CURRENT_RELEASE` constant tracking all applied migrations
- `checkUpgrade()` validates migration gaps, warns on large upgrade jumps
- `getPlatformVersion()` for runtime version queries

## Q12: Appliance Polish + Y2 Review Fixes
- Doctor shows platform version, checks migration 0006
- **PR #64 fix**: Step artifacts with provenance now persisted in run_events
- **PR #67 fix**: `delegateApproval()` wrapped in transaction (atomic with audit)
- **PR #67 fix**: `startRun()` owner parameter stored in INSERT (not dropped)
- **PR #67 fix**: `getRunsByUser()` returns typed result (not Record<string, unknown>)

## Migration
No new database migration in Y3. All schema changes were completed in Y1-Y2 (migrations 0001-0006).

## Rollback
Revert code. No schema migration to revert.
