# Frontend Architect — Red-team review

## Top findings

1. **[critical]** Monolithic Settings page (1053 LOC) with no component decomposition
   - Evidence: `src/ui/pages/Settings.tsx:1053 lines` — 9 tabs with inline UI per tab, all in one component
   - Impact: Dev velocity (impossible to test in isolation), bundle size (Settings must load all validation + state), re-render storms across unrelated tab content
   - Recommended fix: Split into `src/ui/pages/settings/{General,Workflows,Agents,Safety,Models,Integrations,Backup,Repair,Advanced}.tsx` with shared state wrapper

2. **[critical]** No error boundaries — full-page crashes on runtime errors
   - Evidence: `src/ui/` contains zero ErrorBoundary implementations; one component error crashes entire app
   - Impact: Correctness (data loss on crash, no recovery UX), user experience
   - Recommended fix: Add React error boundary at AppShell and per major route; catch and log to API

3. **[high]** Raw polling with refs duplicates usePolling logic across pages; dangerous cleanup bugs
   - Evidence: `src/ui/pages/Decisions.tsx:68-75` uses manual `setInterval` + `useRef` pattern; 7 other pages replicate this; compare to `src/ui/hooks/usePolling.ts:14-46` which exists but underused
   - Impact: Re-render performance (stale refs, missed cleanup), correctness (memory leaks on unmount if ref not cleared), maintainability
   - Recommended fix: Mandate usePolling hook; audit History, Queue, Inbox, System pages for interval ref cleanup

4. **[high]** Godmode store is 786 LOC, leaks API implementation details (localStorage keys, conversation ID mapping) to views
   - Evidence: `src/ui/stores/godmode-store.ts:61-130` (persistence layer exposed); `src/ui/components/godmode/ChatPanel.tsx:66-90` knows about streaming state
   - Impact: Dev velocity (store changes require view updates), testability (can't swap persistence), tight coupling
   - Recommended fix: Extract Zustand store logic to `src/ui/api/godmode.ts`; store only holds `{ messages[], streaming, ...UI state }`; persistence handled via custom hook

5. **[high]** No typing for API responses — loose `unknown` records throughout
   - Evidence: `src/ui/types/index.ts:11-14` uses `Record<string, unknown>` for health/daemon data; `src/ui/pages/Settings.tsx:201` has untyped config state
   - Impact: Type safety (can't catch API contract breaks at compile time), correctness (missing fields silently become undefined)
   - Recommended fix: Generate types from OpenAPI/API schema or define strict interfaces for all API response shapes

6. **[high]** Re-render bloat on large lists — no virtualization, no memoization
   - Evidence: History (351 LOC), Queue (80+ LOC), Decisions (page-local list) all render full DOM for 50+ items; 22/58 files use useMemo/useCallback (38% memoization coverage)
   - Impact: Re-render performance (scroll janks on poll updates), battery/CPU
   - Recommended fix: Add `react-window` virtualization to History, Queue, Decisions; wrap ListItem in memo()

7. **[high]** Godmode SSE streaming lacks abort handling — orphaned fetch on unmount
   - Evidence: `src/ui/stores/godmode-store.ts:575-738` fetches `/api/godmode` as streaming; no AbortController or cleanup in store destruction
   - Impact: Correctness (memory leak if user leaves page mid-stream), dead code (background streaming continues)
   - Recommended fix: Use AbortController scoped to store lifecycle; abort in sendMessage cleanup or store destroy

8. **[medium]** Data fetching hook abstraction incomplete — useApi lacks retry, stale-while-revalidate, abort
   - Evidence: `src/ui/hooks/useApi.ts:13-40` provides single fetch on mount; no exponential backoff, no SWR pattern, no request cancellation; compare to 46 useEffect instances across pages
   - Impact: Dev velocity (each page reimplements retries), UX (no graceful degradation on network blip)
   - Recommended fix: Extend useApi with `{ retries?: number; swr?: boolean; dedupe?: boolean }` options; or adopt TanStack Query

9. **[medium]** Vite config has no route-based code splitting defined
   - Evidence: `src/ui/vite.config.ts:1-46` has no dynamic import strategy for pages; React Router is configured but build output likely concatenates all pages
   - Impact: Bundle size (24 pages loaded at once), slow initial load
   - Recommended fix: Add `dynamicImport: true` to rollup options; wrap page imports with `React.lazy()`

10. **[medium]** Mixed design tokens — Tailwind classes + inline colors + CSS vars (j-* prefix)
    - Evidence: `src/ui/pages/Prototype.tsx:83-91` hardcodes color strings (e.g. `'text-emerald-400 bg-emerald-500/8'`); `src/ui/shared/icons.tsx` and pages use `j-border`, `j-text-muted` CSS vars
    - Impact: Maintainability (where do colors live?), inconsistency (which token system is canonical?)
    - Recommended fix: Consolidate all colors to Tailwind theme or CSS var layer; remove ad-hoc hardcoded Tailwind strings

## Positive notes

- **Zustand store architecture is sound** — Multi-conversation support with localStorage cache + API sync is well-structured; optimistic local IDs with server remapping shows maturity
- **Hook separation is clean** — usePolling, useApi, and ModeContext provide good abstractions where used; reduces boilerplate
- **Prototype.tsx is self-contained** — 666 LOC mock-only page doesn't pollute production code; cleanly gated at /prototype route
