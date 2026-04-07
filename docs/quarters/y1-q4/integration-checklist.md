# Y1-Q4 Appliance Reliability — Integration Checklist

## Doctor Enhancements

- [ ] Daemon heartbeat check added (running/not running/never run)
- [ ] Migration status check added (latest migration ID per DB)
- [ ] Channel tables included in Runtime DB table check (17 total)
- [ ] Doctor checks run in order: Node, dir, config, DBs, migrations, WAL, daemon, models, chrome, dashboard, disk

## Readiness Enhancements

- [ ] ReadinessReport includes `config_valid` check
- [ ] ReadinessReport includes `channel_tables` check
- [ ] `ready` computation includes config and channel table checks
- [ ] Config validation checks for `lmstudio_url` or `adapter_mode`

## Migration Completeness

- [ ] 4 runtime migrations apply cleanly (0001-0004)
- [ ] Migration 0004 UNIQUE constraint enforced
- [ ] All 17 runtime tables present after migration

## Tests

- [ ] Clean-machine smoke tests pass
- [ ] All existing tests pass (migration counts updated)
- [ ] Build compiles cleanly
- [ ] Contract validation passes
