---
title: "Jarvis Local Model Runtime Strategy v1"
summary: "Canonical OpenClaw + LM Studio strategy for a lean local-model lane."
read_when:
  - You are stabilizing Jarvis on a local LM Studio runtime.
  - You need the canonical profile, lean agent, and fallback order.
status: active
---

# Jarvis Local Model Runtime Strategy v1

This document is the target contract for local-model resilience on this station.
It intentionally separates the **hard gate** from the **secondary conversational
probe**:

- The hard gate is the OpenClaw tool path.
- The conversational agent check is best-effort only.
- If the tool path is green, the station is still considered healthy even when
  the direct agent probe is noisy.

## Canonical runtime

- Canonical profile: `jarvis-smoke`
- Canonical lean agent: `smoke`
- Canonical LM Studio identifier: `jarvis-smoke-32k`
- Canonical LM Studio model key: `qwen/qwen3.5-35b-a3b`
- Canonical context window: `32768`
- Canonical tool posture: minimal

## Canonical config shape

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.openclaw/workspace-jarvis-smoke",
      "skipBootstrap": true,
      "bootstrapMaxChars": 1200,
      "bootstrapTotalMaxChars": 4000,
      "contextTokens": 32768,
      "maxConcurrent": 1,
      "compaction": { "mode": "safeguard" },
      "heartbeat": { "every": "0m" },
      "model": {
        "primary": "lmstudio/jarvis-smoke-32k"
      },
      "models": {
        "lmstudio/jarvis-smoke-32k": {
          "alias": "Jarvis Smoke Local"
        }
      }
    },
    "list": [
      {
        "id": "smoke",
        "default": true,
        "workspace": "~/.openclaw/workspace-jarvis-smoke",
        "model": "lmstudio/jarvis-smoke-32k",
        "tools": {
          "profile": "minimal"
        }
      }
    ]
  },
  "skills": {
    "allowBundled": []
  }
}
```

## Gate order

1. Confirm the canonical profile resolves as `jarvis-smoke`.
2. Confirm LM Studio is reachable and the pinned identifier loads as
   `jarvis-smoke-32k`.
3. Confirm the Gateway loads the Jarvis plugins and returns healthy responses
   through `/tools/invoke`.
4. Confirm a job can complete through `/jarvis/jobs/callback`.
5. Confirm artifacts round-trip through `job_artifacts`.
6. Only then run the conversational probe on the lean `smoke` agent.

## Fallback order

1. Retry the same canonical profile and same pinned identifier once.
2. If the pinned identifier still fails, keep the profile fixed and try the next
   local LM Studio model key that is already installed on the machine.
3. If the agent probe is noisy but the tool path is green, keep the run marked
   as a tool-pass and treat the conversational result as advisory.
4. If the tool path fails, stop and repair the runtime before changing the
   profile or widening the tool surface.

## Operator rules

- Use `smoke`, not `main`, for local-model sanity checks.
- Keep the tool surface minimal until the station is stable.
- Do not broaden the model lane to compensate for a noisy conversational probe.
- Treat tool-path success as the hard gate and direct-agent output as secondary.
- When comparing runs, prefer the machine summary from the smoke harness over a
  manual chat transcript.
