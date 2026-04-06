# Jarvis Device Agent v1

## Summary

Jarvis Device v1 is the first device-control slice in the Jarvis/OpenClaw stack. It adds a native `@jarvis/device` plugin that brokers deterministic desktop and device jobs through a separate host worker. It does not move OS automation into the Gateway process.

The goal of this slice is to give Jarvis a stable device-control boundary that can grow into broader desktop workflows later, while keeping OpenClaw as the shell, session authority, and approval gate.

## Contract Position

This document is the human-readable companion to the implemented device contract in:

- [plugin-surface.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/plugin-surface.json)
- [job-catalog.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/job-catalog.json)
- [device-job-types.schema.json](/Users/DanielV2/Documents/Playground/contracts/jarvis/v1/device-job-types.schema.json)

Jarvis Device v1 is additive to [Jarvis Plugin API v1](/Users/DanielV2/Documents/Playground/docs/specs/jarvis-plugin-api-v1.md). The canonical device surface is first-class in the plugin catalog, not a separate sidecar block.

Contract version: `jarvis.v1`

Versioning rule:

- Additive fields are allowed inside v1 when they are optional and backward compatible.
- Any breaking change to field meaning, required fields, enum values, job types, tool names, or command names requires v2.

## Architectural Boundaries

OpenClaw remains the source of truth for:

- sessions and session keys
- channel connections and routing
- Telegram delivery and reply threading
- native browser, web search, web fetch, exec, and session primitives
- approval pauses enforced through native hook registration

Jarvis Device is responsible for:

- deterministic device job compilation
- policy-aware submission to the jobs broker
- observing and controlling the local machine through a separate desktop host worker
- presenting a small, stable tool and command surface to the model

Hard boundary rules:

- Only OpenClaw talks to Telegram.
- `@jarvis/device` never performs OS automation in the Gateway process.
- Device actions are brokered through a separate worker or host process.
- Approval is required for high-risk device actions such as typing, clicking, clipboard writes, and other policy-sensitive control flows.

## Plugin Surface

The canonical device tools are:

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

The canonical device commands are:

- `/device`
- `/windows`
- `/clipboard`
- `/notify`

These names are intentionally high level. The model should plan in terms of observe, act, and verify rather than direct OS primitives.

Tool intent:

- `device_snapshot`: structured state inspection of the current machine
- `device_list_windows`: enumerate visible windows
- `device_open_app`: launch or open an application
- `device_focus_window`: bring a matching window to the foreground
- `device_screenshot`: capture the desktop, a window, a display, or a region
- `device_click`: inject a mouse click
- `device_type`: type text or paste-like content
- `device_hotkey`: send keyboard shortcuts
- `device_clipboard_get`: read clipboard content
- `device_clipboard_set`: write clipboard content
- `device_notify`: send a local desktop notification

## Job Family

The canonical v1 device job types are:

- `device.snapshot`
- `device.list_windows`
- `device.open_app`
- `device.focus_window`
- `device.screenshot`
- `device.click`
- `device.type_text`
- `device.hotkey`
- `device.clipboard_get`
- `device.clipboard_set`
- `device.notify`

The job catalog freezes the timeout, approval posture, artifact behavior, and deterministic error codes for each of these jobs. The job type schemas define the exact input and output payloads.

## Approval Posture

Device automation is powerful enough to change the state of the current machine, so the contract keeps the approval boundary explicit.

The intended posture is:

- `device.snapshot` and `device.list_windows` are observation-first and generally low risk.
- `device.notify` is low risk and local-only.
- `device.open_app`, `device.focus_window`, and `device.screenshot` are policy-sensitive and may require approval depending on context.
- `device.click`, `device.type_text`, `device.hotkey`, and `device.clipboard_set` are high-risk control actions and should be treated as approval-sensitive.
- `device.clipboard_get` is conditional because clipboard contents may contain sensitive data.

The approval decision is owned by the policy layer, but this spec treats the above posture as the canonical default.

## Operating Loop

The intended workflow is:

1. Observe the current device state.
2. Choose the smallest action that moves the task forward.
3. Verify the result with a snapshot, screenshot, or structured readback.
4. Escalate to approval when the next step crosses a policy boundary.

That loop is what turns Jarvis Device into a controlled operator instead of an uncontrolled UI macro system.

## Current Scope

This first device slice is intentionally small. It covers:

- device state inspection
- window discovery and focus
- app launch
- screenshots
- pointer and keyboard input
- clipboard access
- local notifications

It does not yet define the broader future layers such as durable desktop memory, app-aware adapters, file-root aware editing, browser publishing, or IDE integration. Those can be added later without changing the v1 contract names above.

## Expansion Path

The planned extension path is:

- add durable desktop state and session memory
- add file-root aware edit and patch helpers
- add browser and publish brokers on top of the device control plane
- add app-aware adapters for Office, mail, terminals, notes, and IDEs
- add verification hooks so every action can be replayed or audited

That path is what turns Jarvis from a chat assistant into a controlled operator on the current device.
