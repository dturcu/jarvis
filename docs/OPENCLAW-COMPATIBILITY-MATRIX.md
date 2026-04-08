# OpenClaw Compatibility Matrix

Tracks which OpenClaw SDK features Jarvis uses, which it ignores, and which it needs for convergence.

Last updated: 2026-04-08
OpenClaw dependency: `^2026.4.8`

## SDK Features Used

| Feature | Used By | How |
|---|---|---|
| `definePluginEntry` | All 6 plugins | Standard plugin registration |
| `api.registerTool` | All plugins | Tool registration via factory |
| `api.registerCommand` | core, dispatch, office, device, files, browser | Slash command registration |
| `api.on("before_tool_call")` | `@jarvis/core` | Approval hook gating |
| `api.config` | dispatch, shared | Gateway URL/token resolution |
| `api.runtime.subagent.run` | dispatch | Worker-agent spawning |
| `callGatewayTool` (via browser-support) | shared/gateway.ts | Session messaging |
| `OpenClawPluginToolContext` | All plugins | Tool execution context |
| `PluginCommandContext` | All plugins | Command execution context |
| `AnyAgentTool` type | All plugins | Tool definition type |

## SDK Features NOT Yet Used (Needed for Convergence)

| Feature | Needed For | Epic |
|---|---|---|
| Native Telegram channel config | Replace jarvis-telegram | Epic 3 |
| Webhook ingress plugin | Replace dashboard webhooks | Epic 4 |
| Session streaming/SSE | Replace godmode LLM loop | Epic 5 |
| Session compaction/checkpoints | Operator session continuity | Epic 9 |
| Session branch/restore | Operator session management | Epic 9 |
| Browser plugin/managed profiles | Replace direct Puppeteer | Epic 6 |
| TaskFlow | Replace generic daemon automation | Epic 7 |
| Memory-wiki | Long-horizon operator memory | Epic 9 |
| Hook: `before_reply` | Reply-time guardrails/redaction | Epic 8 |
| Hook: `after_tool_call` | Provenance enrichment | Epic 8 |

## Plugin Entry Points

| Plugin ID | Package | Entry |
|---|---|---|
| `jarvis-core` | `@jarvis/core` | `packages/jarvis-core/src/index.ts` |
| `jarvis-jobs` | `@jarvis/jobs` | `packages/jarvis-jobs/src/index.ts` |
| `jarvis-dispatch` | `@jarvis/dispatch` | `packages/jarvis-dispatch/src/index.ts` |
| `jarvis-office` | `@jarvis/office` | `packages/jarvis-office/src/index.ts` |
| `jarvis-device` | `@jarvis/device` | `packages/jarvis-device/src/index.ts` |
| `jarvis-files` | `@jarvis/files` | `packages/jarvis-files/src/index.ts` |
| `jarvis-browser` | `@jarvis/browser` | `packages/jarvis-browser/src/index.ts` |

Additional plugins (email, calendar, crm, web, document, agent) register through the same pattern.

## Hook Usage Inventory

| Hook Point | Plugin | Purpose | Priority |
|---|---|---|---|
| `before_tool_call` | `@jarvis/core` | Approval gating for sensitive tools | 0 |

**Expansion targets (Epic 8):**
- `before_tool_call` — broader policy enforcement across more tool categories
- `before_reply` — response guardrails, PII redaction, compliance checks
- `after_tool_call` — provenance stamping, audit enrichment
- `on_error` — centralized error policy, retry decisions

## Gateway Communication

All gateway communication flows through `packages/jarvis-shared/src/gateway.ts`:

- `resolveGatewayCallOptions()` — resolves URL/token from config or env
- `invokeGatewayMethod()` — generic gateway RPC via `callGatewayTool`
- `sendSessionMessage()` — convenience wrapper for `sessions.send`

Default gateway: `ws://127.0.0.1:18789`
Configurable via: `JARVIS_GATEWAY_URL`, `JARVIS_GATEWAY_TOKEN`, or OpenClaw config

## Breaking Change Risks

| Area | Risk | Mitigation |
|---|---|---|
| Plugin SDK API changes | Method signatures could change | Pin `^2026.4.8`, test on upgrade |
| Hook event shape changes | `before_tool_call` event structure | TypeScript compilation catches type breaks |
| Session API changes | `sessions.send` parameter shape | Gateway abstraction in shared/gateway.ts |
| Browser plugin API | New for Jarvis, API may evolve | Abstract behind BrowserBridge interface (Epic 6) |
