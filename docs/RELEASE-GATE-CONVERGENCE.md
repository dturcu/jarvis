# Release Gate: Platform/Kernel Convergence

Objective pass criteria for the OpenClaw substrate convergence program defined in ADR-PLATFORM-KERNEL-BOUNDARY.md.

## Global Exit Conditions

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | Zero primary-path direct Telegram transport from Jarvis | **Pass** | Session mode is default. Legacy `bot.ts` deprecated, available via `JARVIS_TELEGRAM_MODE=legacy`. Architecture boundary tests enforce. |
| 2 | Zero primary-path dashboard-owned webhook ingress writing directly to runtime state | **Pass** | `webhooks.ts` deleted (Wave 3). `webhooks-v2.ts` uses injectable `onEvent` callback via `createWebhookRouter()`. |
| 3 | Zero primary-path direct dashboard-to-model orchestration outside approved boundary | **Pass** | Session-backed adapter is primary at `/api/godmode`. Legacy at `/api/godmode/legacy` (deprecated). `chat.ts` deprecated. |
| 4 | Zero primary-path direct browser runtime ownership for managed workflows | **Pass** | `BrowserBridge` factory defaults to OpenClaw. Legacy `chrome-adapter.ts` deprecated, available via `JARVIS_BROWSER_MODE=legacy`. |
| 5 | Zero undocumented boundary exceptions between OpenClaw and Jarvis | **Pass** | ADR documents all boundaries. Legacy exclusions in tests are tightened to specific deprecated files. |

## Convergence Verification Checklist

Run these commands to verify convergence is operational:

```bash
# 1. Architecture boundary tests (forbidden pattern enforcement)
npm run check:convergence

# 2. Full test suite
npm test

# 3. TypeScript build
npm run build

# 4. Contract validation
npm run validate:contracts

# 5. Verify defaults
grep "JARVIS_TELEGRAM_MODE" packages/jarvis-telegram/src/index.ts
# Should show: 'session' as default

grep "JARVIS_BROWSER_MODE" packages/jarvis-browser/src/openclaw-bridge.ts
# Should show: 'openclaw' as default

grep "createSessionChatRoute" packages/jarvis-dashboard/src/api/server.ts
# Should show: mounted at /api/godmode
```

## What Must Be True Before Legacy Deletion

The deprecated files (`godmode.ts`, `chat.ts`, `bot.ts`, `relay.ts`, `chat-handler.ts`, `chrome-adapter.ts`) can be deleted when:

1. **Session mode has been running in production** for at least one full schedule cycle (all agents fire and complete via session delivery)
2. **No operator reports** of missing functionality compared to legacy mode
3. **Gateway availability** is sufficient — fallback to legacy path fires less than 5% of requests
4. **All external callers** (if any) have migrated from `/api/godmode/legacy` to `/api/godmode`
5. **Browser tasks** produce equivalent artifacts through the OpenClaw bridge

## Remaining Non-Convergence Work

These items are outside the convergence scope but were identified during the program:

- **Encrypted credentials** (KNOWN-TRUST-GAPS.md) — plaintext config.json
- **Worker sandbox isolation** — cooperative, not OS-level
- **TLS on local APIs** — plaintext HTTP on localhost
- **Database integrity verification** — no runtime tamper detection
