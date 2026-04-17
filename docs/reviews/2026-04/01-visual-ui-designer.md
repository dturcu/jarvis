# Visual/UI Designer — Red-team review

## Top findings

1. **[critical]** Mixed design token system breaks visual consistency across surfaces
   - Evidence: Inbox.tsx:83–84 uses `text-j-accent bg-j-accent-glow border-j-accent/20` (custom CSS vars not defined in index.css), while StatusBadge.tsx and Models.tsx use Tailwind directly (e.g., `text-emerald-400` / `bg-emerald-500/10`). StatusPill.tsx:7 references `text-j-accent` but Home.tsx:166 uses `text-indigo-400`. 
   - Impact: Components rendering on same screen (Home + Inbox) have undefined custom properties causing fallback rendering; operators see visual gaps in status colors (accent state sometimes breaks).
   - Recommended fix: Migrate all j-* vars to Tailwind classes or declare all missing CSS vars (j-accent-glow, j-accent-dim mapping) in index.css theme block.

2. **[high]** Inconsistent inline RGB toggle state in Models.tsx breaks dark-theme depth model
   - Evidence: Models.tsx:454 uses `style={{ backgroundColor: model.enabled ? 'rgb(16 185 129 / 0.6)' : 'rgb(51 65 85 / 0.6)' }}` (raw RGB) instead of Tailwind classes. This value (rgb 16 185 129) does not match emerald-500 (16 185 129 is emerald, but at 60% alpha). Button has no visual elevation/border contrast; appears flat.
   - Impact: Toggle switches lack the surface hierarchy (raised vs. recessed) present in other interactive elements; disrupts operator trust in interactive feedback.
   - Recommended fix: Use Tailwind state classes `${model.enabled ? 'bg-emerald-600' : 'bg-slate-700'} border border-white/10` with shadow for depth.

3. **[high]** Typography scale fragmentation causes inconsistent visual hierarchy on data-dense pages
   - Evidence: Decisions.tsx table headers use `text-xs font-semibold` (line 139), but Inbox.tsx approval cards use `text-[13px] font-semibold` (line 259), and Models.tsx uses `text-sm` (line 174). Same semantic role (card titles), three different sizes across the app. Additionally, Home.tsx h1 is `text-3xl`, but Approvals.tsx h1 is `text-2xl` (line 102).
   - Impact: Operators lose visual scanning rhythm when moving between pages; section hierarchy feels ad-hoc on dense tables (Decisions, Models) where readability is critical.
   - Recommended fix: Define canonical type scale (heading: text-2xl, section: text-lg, card-title: text-sm, table-header: text-xs) and apply consistently via shared PageHeader + DataCard components.

4. **[high]** Empty state and loading state visuals lack consistent depth + spacing
   - Evidence: EmptyState.tsx uses `py-16 text-slate-600` for icons with no background surface. LoadingSpinner shows spinner alone with no containing card. Decisions.tsx empty state (line 124–132) renders as centered text, but Models.tsx (line 181) wraps EmptyState in DataCard. Inconsistent 16px vs. implicit padding.
   - Impact: Empty states feel disjointed across pages; operators miss context for why a list is empty (no visual grouping or action affordance).
   - Recommended fix: Wrap all empty states in DataCard variant, use consistent `py-12` spacing, add subtle icon background (text-slate-700/20) to increase visual weight.

5. **[medium]** Color palette overloaded with unmapped semantic states in approval/decision outcomes
   - Evidence: Decisions.tsx:20–26 maps outcomes to OUTCOME_COLORS (emerald/red/amber/blue/slate) but uses hardcoded opacity values (`bg-emerald-500/10`) not referenced in index.css theme. StatusBadge.tsx:31 falls back to `bg-slate-500/10 text-slate-400 border-slate-500/20` for unknown statuses. Inbox.tsx:255 mixes amber-400 (medium risk) and red-400 (high) without defined palette entry.
   - Impact: New outcome states added by engineers require guessing color codes; no single source of truth for "what shade is medium risk?"
   - Recommended fix: Extend index.css `@theme` block with outcome palette: `--outcome-high: 239 68 68`, `--outcome-medium: 251 146 60`, reference via Tailwind e.g. `bg-red-600`.

6. **[medium]** Icon system inconsistent sizing and weight across use cases
   - Evidence: icons.tsx:8 defines default SVG as 20x20 with strokeWidth 1.5. But IconWarning (line 95) accepts size param and uses 18 viewBox; IconError/Check use 20. In Home.tsx:9, icons are used at implicit 20px, but CrmAnalytics renders at variable sizes via STAGE_COLORS inline. Models.tsx:131 uses size=18 for warning icon but adjacent buttons use default sizing.
   - Impact: Icon grid appears inconsistent at 16px/18px/20px; users see misaligned icon rows in dense tables (Models runtime health, Decisions agent column).
   - Recommended fix: Standardize to 16px (small), 20px (default), 24px (large) sizes with consistent strokeWidth 1.5. Document in icons.tsx component.

7. **[medium]** Data table row density varies wildly — no rhythm for scannability
   - Evidence: Decisions.tsx table uses `py-3.5` per cell (line 158), Models.tsx uses `py-2.5` (line 425), Inbox approval cards use implicit spacing from padding (line 259–280). Decisions table adds zebra striping (line 155: `idx % 2 === 1`), Models does not. No consistent grid baseline for line-height.
   - Impact: Operators scanning multiple pages experience cognitive load switching density expectations; hard to track rows in dense tables (Decisions with 50 items per page).
   - Recommended fix: Define table density token (py-3 for headers, py-2.5 for body rows), apply zebra striping consistently via shared table component or DataCard variant.

8. **[medium]** Border and elevation hierarchy unclear on nested cards
   - Evidence: Home.tsx uses `border-white/5` on cards (line 204), Inbox.tsx uses `border-j-border` (undefined), Models.tsx uses `border-white/5` (line 135) but DataCard uses `border rounded-xl` with VARIANTS switching border color per state. No visual distinction between surface-level vs. nested cards (approval card inside Inbox container).
   - Impact: Deep nesting (Inbox > approval-card > run-details) lacks clear depth cueing; operators cannot quickly distinguish card hierarchy.
   - Recommended fix: Introduce elevation scale: `surface-1` (border-white/5), `surface-2` (border-white/10 + subtle shadow), `surface-nested` (no border, bg inset). Apply via DataCard hover + variant props.

9. **[low]** Badge color contrast in notifications may fail on compact renders
   - Evidence: Home.tsx:115 and 129 use notification badges with `text-black` on `bg-amber-500/90` and `text-white` on `bg-red-500/90`. Amber/red at /90 opacity may not meet WCAG AA on slate-800 background. Badge size min-w-[20px] is compact; small text + high opacity can blur.
   - Impact: Accessibility concern; operators with color blindness may misread priority counts.
   - Recommended fix: Swap to `text-white bg-amber-600` (solid) and `text-white bg-red-600` (solid) for contrast; test against background.

## Positive notes

- **Icon system architecture is sound**: SVG wrapper pattern (`I` component) ensures consistent rendering and makes bulk updates easy. Lucide-style stroke-based design scales well.
- **Spacing utilities well-applied at macro level**: Section margins (mb-6, mb-8), card padding (p-5, p-6) create predictable rhythm. Gap utilities (gap-2, gap-3, gap-5) show discipline.
- **Status color semantic mapping is thorough**: STATUS_COLORS in types/index.ts and color mappings in StatusBadge/StatusPill show deliberate intent to consolidate state representation, even if implementation is fragmented.

