# Y1-Q1 Kernel Unification — Integration Checklist

## Channel Persistence

- [ ] `channel_threads` table created and migrated
- [ ] `channel_messages` table created and migrated
- [ ] `artifact_deliveries` table created and migrated
- [ ] Doctor checks validate new tables exist and have correct schema

## Telegram Refactor

- [ ] Telegram endpoint refactored to ingress adapter only
- [ ] No direct privileged execution remains in Telegram chat route
- [ ] Telegram actions create durable command/run trail
- [ ] Telegram message IDs linked to runs

## Godmode Refactor

- [ ] Godmode refactored to ingress/orchestration viewer only
- [ ] No direct privileged execution remains in Godmode route
- [ ] Godmode actions route through command -> run -> job flow

## Unified Run Creation

- [ ] Dashboard run creation uses unified path
- [ ] Telegram run creation uses unified path
- [ ] Email-triggered run creation uses unified path
- [ ] Webhook-triggered run creation uses unified path
- [ ] All run sources produce identical command/run records

## Run Timeline API

- [ ] Unified run timeline API implemented
- [ ] Timeline shows source channel
- [ ] Timeline shows linked thread/message IDs
- [ ] Operator can trace message -> artifact -> approval lineage

## Migration

- [ ] Forward migration script tested on clean DB
- [ ] Forward migration script tested on existing production DB
- [ ] Down migration path documented (or declared destructive)
- [ ] Doctor checks updated for new schema version

## Replay Suite

- [ ] Same request via dashboard produces correct run trail
- [ ] Same request via Telegram produces correct run trail
- [ ] Cross-channel lineage test passes
- [ ] All existing tests still pass

## Release Readiness

- [ ] Feature freeze observed (last 2-3 weeks)
- [ ] Replay/eval pass complete
- [ ] Migration notes written
- [ ] Rollback note written
- [ ] Docs updated
- [ ] Release note draft complete
