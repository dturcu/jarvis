# Jarvis Single-User Alpha — Operating Guide

## Daily workflow

1. Open the dashboard (http://localhost:4242)
2. Check the **home screen** for needs-attention items
3. Review and resolve **pending approvals**
4. Start workflows as needed from the **workflow launcher**
5. Review **run results** and retry failures if safe

## Failure taxonomy

When Jarvis disappoints, classify the failure:

| Category | Meaning | Example |
|----------|---------|---------|
| lied | System showed incorrect state | Run shows "completed" but output is missing |
| unsafe | Action taken without proper approval | Email sent without approval gate |
| unclear | Could not understand what happened | Run failed with no explanation |
| annoying | Friction without value | Required unnecessary clicks or steps |
| unreliable | Inconsistent behavior | Same input produces different results |
| weak output | Output quality below useful threshold | Proposal too generic to send |
| weak recovery | Failure recovery required manual intervention | Had to inspect DB after crash |
| wrong shape | Workflow structure doesn't match real need | Form asks wrong questions |

## Weekly review template

Each week, answer:

1. What workflows did I actually use?
2. What failed? (classify each failure above)
3. Where did I need expert mode?
4. Where did I leave the product and use code/logs?
5. What felt slow or unclear?
6. What should change next week?

## Alpha metrics

Track weekly:

- Workflows started per week
- Failed runs per workflow
- Approval turnaround time (avg minutes)
- Times I needed to inspect internals
- Times Jarvis misled me
- Recovery time after failure (minutes)

## Safe mode

If Jarvis starts in safe mode:
1. Check `/api/safemode` for the reason
2. Use `/api/settings/repair` to diagnose
3. Fix the issue (usually config or missing DB)
4. Jarvis will auto-exit safe mode when conditions clear

## Backup and restore

- **Backup**: POST /api/backup (or `npm run backup`)
- **Restore**: Stop daemon first, then POST /api/restore
- Backups are in `~/.jarvis/backups/`

## Key endpoints

| Endpoint | Purpose |
|----------|---------|
| /api/attention | What needs attention now |
| /api/workflows | Available workflows |
| /api/approvals | Pending approvals |
| /api/runs/:id/explain | Why did this run happen |
| /api/safemode | System health check |
| /api/support/bundle | Export diagnostics for debugging |
| /api/service/status | Daemon health |
| /api/models/health | Model runtime status |
