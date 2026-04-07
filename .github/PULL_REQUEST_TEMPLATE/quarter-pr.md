## Problem Statement

<!-- Why does this quarter exist? What architectural split, gap, or risk does it address? -->

## Architectural Changes

<!-- What structural changes does this PR make? List affected planes, packages, schemas, and APIs. -->

## Migration and Rollback

### Migration Plan

<!-- List all schema changes, new tables, altered columns, data backfills. -->
<!-- Reference the migration scripts by path. -->

### Rollback Note

<!-- What happens if this quarter's changes need to be reverted? -->
<!-- Which migrations have down paths? Which are destructive? -->
<!-- What operator actions are required for rollback? -->

## Operator-Visible Changes

<!-- What does the operator see differently after this PR merges? -->
<!-- New dashboard pages, changed flows, new commands, removed features. -->

## Acceptance Evidence

<!-- Link to or paste evidence for each acceptance criterion. -->
<!-- Include: replay suite results, soak test logs, screenshot/recording, doctor output. -->

- [ ] Integration checklist complete (`docs/quarters/<quarter>/integration-checklist.md`)
- [ ] Replay suite passing (`tests/replay/<quarter>/`)
- [ ] Migration tested forward and back
- [ ] Rollback note reviewed
- [ ] Release note draft complete (`docs/quarters/<quarter>/release-notes.md`)
- [ ] Docs updated in this PR
