# Jarvis Plugin API v1

## Overview

Jarvis Plugin API v1 defines the stable contract between OpenClaw-native Jarvis plugins and external workers. OpenClaw remains the chat OS, session authority, routing shell, approval surface, and Telegram integration point. Jarvis plugins orchestrate work through high-level tools and deterministic commands. External workers execute heavy workloads and return results through the jobs callback contract.

This version freezes:

- The public plugin surface for `@jarvis/core`, `@jarvis/jobs`, `@jarvis/dispatch`, `@jarvis/office`, and `@jarvis/device`
- The worker job families for office, device, browser, python, and search or scrape workloads
- Shared wire types for jobs, artifacts, approvals, and tool responses
- The state machines, callback semantics, and path rules needed for local Windows plus WSL deployments

Contract version: `jarvis.v1`

Versioning rule:

- Additive fields are allowed inside v1 when they are optional and backward compatible.
- Any breaking change to field meaning, required fields, enum values, job types, tool names, or command names requires v2.

## Architectural Boundaries

OpenClaw is the source of truth for:

- Sessions and session keys
- Channel connections and routing
- Telegram delivery and reply threading
- Native browser, web search, web fetch, exec, and session primitives
- Approval pauses enforced through native hook registration

Jarvis responsibilities:

- `@jarvis/core`: policies, approvals, manifests, capability routing, model selection, sub-agent policy
- `@jarvis/jobs`: queue submission, polling, retries, artifact registration, callback ingestion
- `@jarvis/dispatch`: cross-session delivery, follow-up messaging, broadcasts, worker-agent handoff
- `@jarvis/office`: deterministic Office job compilation and worker brokering
- `@jarvis/device`: local device observation and control through a separate desktop host worker

Hard boundary rules:

- Only OpenClaw talks to Telegram.
- `@jarvis/dispatch` uses `sessions_send` and `sessions_spawn`; it does not open a second bot path.
- `@jarvis/office` never edits Office files in-process; it emits deterministic job specs and submits them to `@jarvis/jobs`.
- `@jarvis/device` never runs host automation in the Gateway process; it brokers through a separate desktop host worker.
- Browser, python, office, device, and scrape or search workers are separate processes or containers.
- Approval is required for external dispatch, unrestricted python execution, privileged browser actions, and any destructive file edit path introduced later.

## Shared Wire Types

Machine-readable definitions live in [common.schema.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/common.schema.json), [job-envelope.schema.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/job-envelope.schema.json), [job-result.schema.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/job-result.schema.json), [worker-callback.schema.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/worker-callback.schema.json), and [tool-response.schema.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/tool-response.schema.json).

Shared types:

- `ContractVersion`: constant string `jarvis.v1`
- `SessionRef`: canonical opaque OpenClaw `session_key`
- `RequestedBy`: source channel and sender metadata for the request originator
- `ApprovalRef`: approval request identifier and state
- `ArtifactRef`: artifact handle used as worker input
- `ArtifactRecord`: materialized or registered artifact metadata returned by Jarvis
- `JobEnvelope`: canonical submission payload sent to a worker broker
- `JobResult`: canonical terminal or intermediate result payload
- `JobError`: deterministic error object with stable `code`
- `RetryPolicy`: retry behavior set by Jarvis or jobs broker
- `ToolResponse`: standard response wrapper returned by Jarvis plugin tools

Top-level response fields are standardized across tools and callbacks:

- `contract_version`
- `status`
- `summary`
- `job_id`
- `approval_id`
- `artifacts`
- `structured_output`
- `error`
- `logs`
- `metrics`

Artifact rules:

- `artifact_id` is always required.
- `path` is first-class for materialized artifacts.
- When `path` is present, `path_context` and `path_style` are required.
- `path_context` identifies where the path is valid, such as `windows-host`, `wsl-ubuntu`, or `linux-container`.
- `path_style` identifies path syntax, such as `windows` or `posix`.
- Workers may receive both artifact IDs and local path hints, but the registry identity is stable across rematerialization.

## State Machines

Job state machine:

`queued -> running -> awaiting_approval -> completed | failed | cancelled`

Approval state machine:

`pending -> approved | rejected | expired | cancelled`

Callback rules:

- Worker callbacks are authenticated as plugin-origin traffic.
- Callback processing is idempotent by `job_id + attempt`.
- Workers may emit progress updates before terminal completion.
- Terminal completion must use one of `completed`, `failed`, or `cancelled`.

## Plugin Surface

The machine-readable plugin catalog lives in [plugin-surface.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/plugin-surface.json).

### `@jarvis/core`

Tools:

- `jarvis_plan`
- `jarvis_run_job`
- `jarvis_get_job`
- `jarvis_list_artifacts`
- `jarvis_request_approval`

Commands:

- `/approve`

Notes:

- Owns approval routing, model selection, policy evaluation, and high-level job planning.
- Registers hook-based approval pauses for sensitive downstream tool calls.

### `@jarvis/jobs`

Tools:

- `job_submit`
- `job_status`
- `job_cancel`
- `job_artifacts`
- `job_retry`

HTTP routes:

- `POST /jarvis/jobs/callback`

Notes:

- Owns queue submission, retries, callbacks, artifact registration, and broker state.

### `@jarvis/dispatch`

Tools:

- `dispatch_to_session`
- `dispatch_followup`
- `dispatch_broadcast`
- `dispatch_notify_completion`
- `dispatch_spawn_worker_agent`

Commands:

- `/dispatch`
- `/followup`
- `/broadcast`
- `/sendto`

Notes:

- Uses OpenClaw-native session tools only.
- Never sends channel traffic directly from a worker.

### `@jarvis/office`

Tools:

- `office_inspect`
- `office_transform`
- `office_merge_excel`
- `office_fill_docx`
- `office_build_pptx`
- `office_extract_tables`
- `office_preview`

Commands:

- `/excel`
- `/word`
- `/ppt`
- `/office-status`

Notes:

- Compiles deterministic Office job specs.
- Delegates execution to an adapter-backed external worker.
- Adapter remains swappable: `officecli | libreoffice | python-openxml`

### `@jarvis/device`

The device slice is a first-class plugin, not an extension block. It is the first step toward a general-purpose device agent that can observe and control the current machine while keeping the Gateway process out of direct OS automation.

Tools:

- `device_snapshot`
- `device_list_windows`
- `device_open_app`
- `device_focus_window`
- `device_screenshot`
- `device_click`
- `device_type`
- `device_hotkey`
- `device_clipboard_get`
- `device_clipboard_set`
- `device_notify`

Commands:

- `/device`
- `/windows`
- `/clipboard`
- `/notify`

Notes:

- Uses a dedicated desktop host worker for OS interaction.
- All actions are policy-gated, with the most dangerous paths reserved for approval-driven flows.
- The machine-readable device job family lives in [device-job-types.schema.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/device-job-types.schema.json).

## Worker Job Catalog

The machine-readable job catalog lives in [job-catalog.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/job-catalog.json). Exact input and output schemas live in the family-specific schema files, including [device-job-types.schema.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/device-job-types.schema.json). Each catalogued job type keeps a normative example in [contracts/jarvis/v1/examples](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/examples).

### Office jobs

| Job type | Default timeout | Approval | Output artifact behavior |
| --- | --- | --- | --- |
| `office.inspect` | 300s | not required | Optional JSON or preview artifact; structured document inspection always returned |
| `office.merge_excel` | 900s | not required | Produces one materialized `.xlsx` artifact with path metadata |
| `office.transform_excel` | 900s | not required | Produces one transformed workbook artifact with path metadata |
| `office.fill_docx` | 600s | not required | Produces one filled `.docx` artifact with path metadata |
| `office.build_pptx` | 900s | not required | Produces one `.pptx` artifact with path metadata |
| `office.extract_tables` | 600s | not required | Produces one export artifact when requested and structured table metadata |
| `office.preview` | 300s | not required | Produces one or more preview artifacts with path metadata |

### Device jobs

| Job type | Default timeout | Approval | Output artifact behavior |
| --- | --- | --- | --- |
| `device.snapshot` | 120s | not required | Produces a structured device snapshot and may emit a screenshot artifact |
| `device.list_windows` | 60s | not required | Returns structured metadata for windows visible on the current device |
| `device.open_app` | 180s | conditional | Launches a local application and returns process or initial window metadata |
| `device.focus_window` | 60s | conditional | Brings a matching window to the foreground and returns the focused window metadata |
| `device.screenshot` | 120s | conditional | Produces one screenshot artifact with path metadata and structured capture details |
| `device.click` | 60s | required | Injects a pointer click and returns the normalized action metadata |
| `device.type_text` | 60s | required | Injects text into the focused or targeted window and returns normalized typing metadata |
| `device.hotkey` | 60s | required | Sends a keyboard shortcut and returns normalized key metadata |
| `device.clipboard_get` | 60s | conditional | Reads the device clipboard and returns normalized clipboard content or a materialized artifact for binary data |
| `device.clipboard_set` | 60s | required | Writes text or file references to the device clipboard and returns normalized write metadata |
| `device.notify` | 30s | not required | Sends a local desktop notification and returns delivery metadata |

### Browser jobs

| Job type | Default timeout | Approval | Output artifact behavior |
| --- | --- | --- | --- |
| `browser.run_task` | 900s | conditional | Optional evidence artifacts such as screenshots, downloads, or traces |
| `browser.extract` | 600s | not required | Optional exported extraction artifact plus structured documents |
| `browser.capture` | 300s | not required | Produces one capture artifact |
| `browser.download` | 300s | not required | Produces one downloaded artifact |

### Python jobs

| Job type | Default timeout | Approval | Output artifact behavior |
| --- | --- | --- | --- |
| `python.run` | 900s | required | Optional produced artifacts; stdout and stderr returned in structured output |
| `python.transform` | 900s | required | Produces one or more transformed artifacts |
| `python.analyze` | 900s | not required | Optional report and chart artifacts plus findings |
| `python.report` | 600s | not required | Produces one report artifact |

### Search and scrape jobs

| Job type | Default timeout | Approval | Output artifact behavior |
| --- | --- | --- | --- |
| `search.query` | 120s | not required | Optional exported search result artifact plus ranked results |
| `search.fetch` | 300s | not required | Optional aggregate artifact plus fetched item metadata |
| `scrape.extract` | 900s | not required | Produces one extraction artifact with structured field output |
| `scrape.crawl` | 1800s | not required | Produces one crawl artifact plus crawl metrics |

## Deterministic Error Model

Common error codes may appear on any job:

- `INVALID_INPUT`
- `ARTIFACT_NOT_FOUND`
- `APPROVAL_REQUIRED`
- `APPROVAL_REJECTED`
- `WORKER_UNAVAILABLE`
- `TIMEOUT`
- `CANCELLED`
- `INTERNAL_ERROR`

Each job type also defines deterministic domain-specific error codes in [job-catalog.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/job-catalog.json). Those codes are part of the stable v1 contract and may be extended only additively.

## Path and Artifact Semantics for Windows plus WSL

The deployment target for v1 is a local Windows host with WSL workers, but the contract must remain valid if workers move off-host later.

Rules:

- The artifact registry identity is stable across environments.
- A Windows-materialized path uses `path_context: "windows-host"` and `path_style: "windows"`.
- A WSL-materialized path uses `path_context: "wsl-ubuntu"` and `path_style: "posix"`.
- Workers must not assume that a path from a different `path_context` is directly readable.
- If a worker rematerializes an artifact in its own environment, it returns the same `artifact_id` and the new local path metadata.

## Validation

The repository includes a local validation script:

```bash
npm run validate:contracts
```

The validator checks:

- Schema loading and reference resolution
- Example job envelopes against the canonical envelope schema
- Example job results against the canonical result schema
- Example worker callbacks against the callback schema
- Catalog coverage for all frozen plugin tools, commands, routes, and job types

## References

- [OpenClaw Plugins](https://docs.openclaw.ai/tools/plugin)
- [OpenClaw Session Tools](https://docs.openclaw.ai/concepts/session-tool)
- [OpenClaw Browser](https://docs.openclaw.ai/tools/browser)
- [OpenClaw Telegram](https://docs.openclaw.ai/channels/telegram)
