---
title: "Jarvis Station Recovery"
summary: "Back up, restore, and restart the local Jarvis + OpenClaw station after reboot or drift."
---

# Jarvis Station Recovery

This runbook is for the machine itself: if the local station reboots, loses profile state, or drifts away from the expected LM Studio / OpenClaw pairing, use the ops scripts first.

## Canonical lane

The canonical repeatable lane is the smoke profile:

- profile: `jarvis-smoke`
- Gateway port: `18899`
- LM Studio port: `1234`
- model identifier: `jarvis-smoke-32k`

The heavier `jarvis-rt` profile can still be used manually, but the smoke lane is the one that should stay boring and recoverable.

## Commands

```bash
npm run ops:health
npm run ops:backup
npm run ops:recover
```

## What each command is for

`npm run ops:health`

- checks the profile config on disk
- checks Gateway health on loopback
- checks LM Studio's `/v1/models`
- confirms the pinned model identifier is present
- writes a report under `.artifacts/ops/`

`npm run ops:backup`

- copies the active OpenClaw profile directory to `~/.openclaw-jarvis-backups/<profile>/<timestamp>/profile`
- copies the configured workspace if one exists
- writes a manifest so the bundle can be restored later

`npm run ops:recover`

- restores the most recent backup bundle for the profile
- copies the profile directory back into place
- restores the workspace if it was backed up
- runs the health check again and writes a recovery report

## Reboot recovery sequence

If the machine just rebooted:

1. Start LM Studio.
2. Start or verify the local LM Studio server on `127.0.0.1:1234`.
3. Load the pinned local model identifier.
4. Run `npm run ops:health`.
5. If the profile config or workspace looks wrong, run `npm run ops:recover`.
6. After recovery is green, run `npm run smoke:runtime` for the full live Gateway/Jarvis smoke check.

## What to look for

Healthy output should show:

- profile config exists
- Gateway health is OK
- LM Studio is reachable
- the pinned model identifier is present
- backup bundles exist and can be restored

If only the Gateway is down but LM Studio is healthy, the issue is usually service startup or a stale process binding the port. If LM Studio is down, recover the model first and only then retry the Gateway.

## Backup location

The backup helper stores bundles outside the repo under:

- `~/.openclaw-jarvis-backups/<profile>/...`

That keeps recovery state local to the machine without mixing it into the workspace repo.

