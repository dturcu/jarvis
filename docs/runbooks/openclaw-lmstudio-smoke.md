# OpenClaw + LM Studio Smoke Harness

This repo now has a dedicated Windows local-runtime lane:

```bash
npm run runtime:bootstrap
npm run smoke:runtime
```

`runtime:bootstrap` prepares the canonical profile, workspace roots, and config file. `smoke:runtime` performs the full live check.

Tool-path success is the hard gate.
Treat the direct conversational agent check as best-effort and advisory only.
Do not use `main` for this lane.
Use the lean conversational agent: `smoke`.
The default posture is effectively `JARVIS_SMOKE_AGENT_CHECK=0`.

## What the harness does

`scripts/smoke-openclaw-lmstudio.mjs`:

1. builds the workspace unless `JARVIS_SMOKE_SKIP_BUILD=1`
2. provisions a dedicated OpenClaw profile (`jarvis-smoke` by default)
3. writes a lean main workspace and a separate lean agent workspace under `.artifacts/runtime-smoke/`
4. starts LM Studio on `127.0.0.1:1234`
5. loads the pinned model source `qwen/qwen3.5-35b-a3b` as `jarvis-smoke-32k`
6. starts a dedicated Gateway on `127.0.0.1:18899`
7. waits on `GET /healthz` for loopback readiness
8. exercises live Jarvis tool calls and the jobs callback route
9. writes a machine-readable summary under `.artifacts/runtime-smoke/<timestamp>/summary.json`
10. copies the latest summary to `.artifacts/runtime-smoke/latest.json`

## Canonical identifiers

Keep these aligned across the smoke harness, LM Studio, and OpenClaw config:

- profile: `jarvis-smoke`
- Gateway port: `18899`
- LM Studio port: `1234`
- model source key: `qwen/qwen3.5-35b-a3b`
- model identifier: `jarvis-smoke-32k`
- model ref: `lmstudio/jarvis-smoke-32k`
- lean conversational agent: `smoke`

The harness also mirrors the Gateway auth token into `gateway.remote.token` so the local CLI and HTTP paths stay in sync.

## Report outputs

Each run writes:

- `.artifacts/runtime-smoke/<timestamp>/summary.json`
- `.artifacts/runtime-smoke/<timestamp>/summary.md`
- `.artifacts/runtime-smoke/latest.json`
- `.artifacts/runtime-smoke/latest.md`
- `.artifacts/runtime-smoke/<timestamp>/gateway.out.log`
- `.artifacts/runtime-smoke/<timestamp>/gateway.err.log`

Use `latest.json` and `latest.md` for the most recent run without hunting through timestamped folders.

## Success criteria

The smoke lane is green when all of the following pass:

- LM Studio starts and advertises `jarvis-smoke-32k`
- the Gateway comes up on loopback and responds on `/healthz`
- `office_merge_excel` queues successfully through `/tools/invoke`
- `job_status` and `job_artifacts` work for the queued job
- the `/jarvis/jobs/callback` route accepts the completed worker payload
- `device_list_windows` queues successfully

## Optional agent probe

The conversational check is explicitly best-effort and disabled by default.

Enable it with:

```bash
JARVIS_SMOKE_AGENT_CHECK=1 npm run smoke:runtime
```

When enabled, the harness uses the dedicated lean agent `smoke` instead of the main agent. That keeps the prompt smaller and avoids treating the optional probe as part of the canonical smoke signal.

If you want the smoke run to fail when the optional probe does not return `JARVIS_SMOKE_OK`, add:

```bash
JARVIS_SMOKE_REQUIRE_AGENT=1 JARVIS_SMOKE_AGENT_CHECK=1 npm run smoke:runtime
```

## Useful environment overrides

```bash
JARVIS_SMOKE_KEEP_RUNNING=1 npm run smoke:runtime
JARVIS_SMOKE_SKIP_BUILD=1 npm run smoke:runtime
JARVIS_SMOKE_MODEL_KEY=openai/gpt-oss-120b npm run smoke:runtime
JARVIS_SMOKE_LMS_CLI="C:\\Users\\you\\.lmstudio\\bin\\lms.exe" npm run smoke:runtime
```

## Notes

- The harness uses the local `node_modules/.bin/openclaw.cmd` binary instead of `npx` on Windows.
- The main lane should stay green even if the optional agent probe is skipped or fails.
- Treat `latest.md` as the quickest operator-facing summary after a run.
