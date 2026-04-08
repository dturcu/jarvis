# Release Gate: Platform/Kernel Convergence

Objective pass criteria for the OpenClaw substrate convergence program defined in ADR-PLATFORM-KERNEL-BOUNDARY.md.
This gate must pass before legacy code paths can be deleted (Epic 12).

## 5 Global Exit Conditions

These are the "definition of done" from `CONVERGENCE-ROADMAP.md`.
Each condition eliminates a category of platform duplication between Jarvis and OpenClaw.

### Exit 1 -- Zero Primary-Path Direct Telegram Transport

**Status**: Pass

Jarvis no longer calls `api.telegram.org` on any primary path.
Telegram routing flows through the OpenClaw session adapter (`JARVIS_TELEGRAM_MODE=session`, the default).
The legacy `bot.ts` / `relay.ts` / `chat-handler.ts` files remain for fallback but are marked `@deprecated`.

**Verification**: `tests/convergence-final.test.ts` scans all source for `api.telegram.org` outside deprecated files.

### Exit 2 -- Zero Primary-Path Dashboard-Owned Webhook Ingress

**Status**: Pass

The original `webhooks.ts` (v1) is deleted. Webhook ingress uses `webhooks-v2.ts` which normalizes events through the shared normalizer and injectable `onEvent` callback, avoiding direct writes to runtime state.

**Verification**: `tests/convergence-final.test.ts` confirms `webhooks.ts` does not exist.

### Exit 3 -- Zero Primary-Path Direct Dashboard-to-Model Orchestration

**Status**: Pass

The primary `/api/godmode` route is the session-backed adapter (`session-chat-adapter.ts`).
The legacy LM Studio loop is mounted at `/api/godmode/legacy` and marked `@deprecated`.
No primary path calls `localhost:1234/v1/chat/completions` outside `jarvis-inference`.

**Verification**: `tests/convergence-final.test.ts` scans for direct LM Studio URLs outside deprecated/inference files.

### Exit 4 -- Zero Primary-Path Direct Browser Runtime Ownership

**Status**: Pass

Browser automation defaults to the OpenClaw bridge (`JARVIS_BROWSER_MODE=openclaw`).
The legacy `chrome-adapter.ts` with direct `puppeteer.connect/launch` is deprecated.
The browser worker dispatch routes high-level types through the bridge and only falls back to the adapter for low-level operations.

**Verification**: `tests/convergence-final.test.ts` scans for direct `puppeteer.connect/launch` outside deprecated files.

### Exit 5 -- Zero Undocumented Boundary Exceptions

**Status**: Pass

Key convergence documents exist:
- `ADR-PLATFORM-KERNEL-BOUNDARY.md`
- `ADR-MEMORY-TAXONOMY.md`
- `CONVERGENCE-ROADMAP.md`
- `AUTOMATION-CLASSIFICATION.md`
- `OPENCLAW-COMPATIBILITY-MATRIX.md`

ADR documents all boundaries. Legacy exclusions in tests are tightened to specific deprecated files.

**Verification**: `tests/convergence-final.test.ts` checks that all required documents exist.

## Status Summary

| # | Condition | Status |
|---|---|---|
| 1 | Zero primary-path direct Telegram transport from Jarvis | **Pass** |
| 2 | Zero primary-path dashboard-owned webhook ingress writing directly to runtime state | **Pass** |
| 3 | Zero primary-path direct dashboard-to-model orchestration outside approved boundary | **Pass** |
| 4 | Zero primary-path direct browser runtime ownership for managed workflows | **Pass** |
| 5 | Zero undocumented boundary exceptions between OpenClaw and Jarvis | **Pass** |

## What Must Be True Before Legacy Deletion

The deprecated files (`godmode.ts`, `chat.ts`, `bot.ts`, `relay.ts`, `chat-handler.ts`, `chrome-adapter.ts`) can be deleted when all of the following hold:

1. **All four primary paths converged** -- Exits 1-4 show "Pass" (currently met).
2. **Session mode has been running in production** for at least one full schedule cycle (all agents fire and complete via session delivery).
3. **No operator reports** of missing functionality compared to legacy mode.
4. **No production deployment relies on legacy env vars** -- No operator sets `JARVIS_TELEGRAM_MODE=legacy` or `JARVIS_BROWSER_MODE=legacy` in their production config.
5. **Deprecated files are marked** -- Every file in the deprecated set has a `@deprecated` JSDoc tag (verified by `convergence-final.test.ts`).
6. **Doctor convergence checks pass** -- `jarvis doctor` reports no convergence warnings.
7. **Full convergence test suite passes** -- `npm run check:convergence` exits 0.
8. **All external callers** (if any) have migrated from `/api/godmode/legacy` to `/api/godmode`.
9. **Browser tasks** produce equivalent artifacts through the OpenClaw bridge.

## Operator Verification Checklist

Run these commands to verify the convergence program is working:

```bash
# 1. Run the full convergence test suite
#    (architecture + hooks + credential audit + wiring + final + smoke)
npm run check:convergence

# 2. Run the doctor and inspect convergence checks
npx tsx packages/jarvis-runtime/src/doctor.ts

# 3. Verify no legacy env vars are set in your environment
echo "JARVIS_TELEGRAM_MODE=$JARVIS_TELEGRAM_MODE"
echo "JARVIS_BROWSER_MODE=$JARVIS_BROWSER_MODE"
echo "JARVIS_SCHEDULE_SOURCE=$JARVIS_SCHEDULE_SOURCE"
# Expected: all empty (defaults to converged paths) or explicitly set to converged values

# 4. Verify deprecated files exist and are marked
grep -l "@deprecated" \
  packages/jarvis-dashboard/src/api/godmode.ts \
  packages/jarvis-dashboard/src/api/chat.ts \
  packages/jarvis-telegram/src/chat-handler.ts
# Expected: all three files listed

# 5. Verify primary routes are session-backed
grep "createSessionChatRoute" packages/jarvis-dashboard/src/api/server.ts
# Expected: /api/godmode mounts the session route

# 6. Verify defaults
grep "JARVIS_TELEGRAM_MODE" packages/jarvis-telegram/src/index.ts
# Should show: 'session' as default
grep "JARVIS_BROWSER_MODE" packages/jarvis-browser/src/openclaw-bridge.ts
# Should show: 'openclaw' as default

# 7. Run the full build + test pipeline
npm run check
```

If all seven steps pass, the convergence program is operational and legacy deletion can proceed.

## Remaining Non-Convergence Work

These items are outside the convergence scope but were identified during the program:

- **Encrypted credentials** (KNOWN-TRUST-GAPS.md) -- plaintext config.json
- **Worker sandbox isolation** -- cooperative, not OS-level
- **TLS on local APIs** -- plaintext HTTP on localhost
- **Database integrity verification** -- no runtime tamper detection
