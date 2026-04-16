# Design System Engineer — Red-team review

## Top findings

### 1. [CRITICAL] Token layer fragmented across Tailwind + custom CSS vars
- Evidence: `index.css` defines `--color-j-*` (14 variables) but components mix them with hardcoded Tailwind colors (111 uses of `indigo-*`, 25 uses of `slate-*` in shared/)
- Impact: No single source of truth for colors. SectionCard uses `j-accent`, StatusPill uses `j-accent`, but TabBar hardcodes `indigo-500/indigo-600`. Changes to the accent color require searching 8+ files.
- Recommended fix: Extend `tailwind.config.js` to expose all `--color-j-*` variables as Tailwind theme tokens (e.g., `theme.colors.j`), then audit and replace all hardcoded color strings in shared components.

### 2. [HIGH] No variant/props API standardization — inconsistent naming across 12 components
- Evidence: StatusBadge has `size='sm'|'md'` + `variant='pill'|'dot'`. TabBar has `variant='pill'|'underline'`. SectionCard has `accent='default'|'warn'|'error'|'success'|'accent'`. ConfirmDialog has `variant='danger'|'warning'|'default'`. No naming pattern or validation.
- Impact: 600-word pages won't reuse smaller components if API is unpredictable; engineers end up copying markup. Settings.tsx (1053 lines) contains 4 custom form inputs instead of pulling from shared.
- Recommended fix: Create a `props.ts` with shared enums (`Size = 'xs'|'sm'|'md'|'lg'`; `Status = 'pending'|'success'|'error'|'warning'`); export as `const SIZES`, `const STATUSES`, validate in component prop types.

### 3. [HIGH] 72 hardcoded color combinations with no dedupe — classic badge/pill re-invention
- Evidence: Decisions.tsx defines `OUTCOME_COLORS` (5 hardcoded strings). StatusPill hardcodes `PILL_STYLES` (13 strings). StatusBadge hardcodes `STATUS_COLORS`. Grep shows 72 `bg-\w+-\d{3}/\d{1,2}\s+text-\w+-\d{3}` patterns across pages. No reuse.
- Impact: A designer changes accent from cyan to magenta; 4 files need edits. Icon colors, badge colors, border colors all scattered.
- Recommended fix: Centralize in `ui/tokens/colors.ts`: export `OUTCOME_STATES`, `STATUS_STATES`, `COMPONENT_STATES` as objects with `bg`, `text`, `border` keys; import into components.

### 4. [HIGH] No Button, Input, Select, Modal primitives — pages build inline form/button markup
- Evidence: FilterBar.tsx hardcodes `className="text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2..."` for input. Settings.tsx (1053 lines) reimplements TextInput, SelectInput, Toggle, FieldLabel instead of pulling from shared. No Button.tsx exists.
- Impact: Button styles vary (`.j-btn-primary` in CSS vs inline classNames in pages). Accessibility gaps (no focus states on custom inputs). Settings.tsx could be 400 lines with 3–5 reusable input/select/button components.
- Recommended fix: Create `Button.tsx`, `Input.tsx`, `Select.tsx` in shared with size/variant props tied to tokens. Export from `shared/index.ts` for tree-shakeability.

### 5. [HIGH] No headless UI / Radix UI — accessibility risk for menus, popovers, dialogs
- Evidence: ConfirmDialog uses `<dialog>` element (good); but no Dropdown, Menu, Popover, Tooltip components. Decisions.tsx has a dropdown (lines 97–100) with no accessible keyboard nav. FilterBar selects are vanilla HTML (no search, no grouping).
- Impact: Keyboard users can't navigate complex widgets. Screen readers miss ARIA roles. No way to build accessible searchable selects, command palettes, or nested menus.
- Recommended fix: Add Radix UI or Headless UI. Start with `@radix-ui/react-dropdown-menu` + Popover for agent filter in Decisions. Update package.json (no headless deps currently).

### 6. [MEDIUM] No dark/light theme extensibility — hardcoded dark mode with no toggle capability
- Evidence: `index.css` hardcodes all colors to dark palette. `prefers-color-scheme` appears 0 times. No `dark:` Tailwind utilities. Pages define no theme toggle. All `.j-*` variables are dark-only.
- Impact: If product expands to support light mode or a user-configurable accent, every color in the system breaks. Vendor lock-in to dark UI.
- Recommended fix: Define a `theme: { extend: { colors: { light: { ... }, dark: { ... } } } }` in tailwind.config.js. Add a ThemeContext in `ui/context/ThemeContext.tsx` (similar to ModeContext). Update shared components to respect `dark:` class prefix.

### 7. [MEDIUM] No component documentation or Storybook — impossible to audit design consistency
- Evidence: No README.md in shared/. No .stories.tsx files. No MDX docs. No visual guide for 12 components, 4 button styles, 30+ color combinations. New engineer must read TypeScript to understand variants.
- Impact: Inconsistency ships. Component upgrades break pages. Design changes don't propagate. Onboarding slow.
- Recommended fix: Add Storybook. Start with 5 high-impact components (Button, StatusBadge, DataCard, Input, Modal). Use Storybook Docs for prop tables and color swatches.

### 8. [MEDIUM] LoadingSpinner and timeline dots hardcode `indigo-500` instead of using `j-accent`
- Evidence: LoadingSpinner.tsx line 9: `border-indigo-500/30 border-t-indigo-500`. TimelineItem.tsx line 19: `'bg-indigo-500'` as fallback. Should use `j-accent`.
- Impact: LoadingSpinner doesn't respect the accent token. If you change `--color-j-accent`, spinners stay cyan.
- Recommended fix: Replace with `text-j-accent` / `border-j-accent` in both files (2 changes).

### 9. [MEDIUM] No icon size/color prop API — 46 inline SVG icon exports with hardcoded `strokeWidth`
- Evidence: icons.tsx exports 23 icon functions with fixed `width="20" height="20" strokeWidth="1.5"`. Utility icons (IconWarning, IconCheck) have optional `size` param, but nav icons don't. No way to request 16px or 24px variant.
- Impact: Pages that need small inline icons (e.g., badge icons, button icons) can't reuse. Leads to duplication of icon assets.
- Recommended fix: Add `size?: number` param to all nav icons. Create `IconWrapper({ icon: Component; size: number; color?: string })` to centralize rendering. Document default as 20px.

### 10. [LOW] TabBar active state hardcodes `indigo-600` and `indigo-400` instead of using tokens
- Evidence: TabBar.tsx lines 21, 45: `text-indigo-400`, `bg-indigo-600`. These should derive from a tab/active token or the accent color family.
- Impact: If accent changes, tabs don't follow. Minor but inconsistent with SectionCard/StatusPill pattern.
- Recommended fix: Create a `TAB_COLORS = { active: 'bg-j-accent-dim text-white', inactive: 'bg-j-surface text-j-text-secondary' }` export in `tokens/colors.ts`.

---

## Positive notes

- **CSS variables strategy is sound**: `--color-j-*` in `:root` theme is the right call. Just needs to be complete (extend to spacing, shadows, radii, typography scales).
- **DataCard and PageHeader are lean and composable**: Both avoid one-off styling. No class noise. Good use of `className` prop for flex in parent layouts.
- **Icons are consolidated**: All SVG icons in one file, shared across nav and pages. `stroke="currentColor"` pattern means they inherit text color. Good foundation for scaling.
- **ConfirmDialog uses native `<dialog>`**: Respects browser modality, avoids custom overlay logic. Good ARIA precedent.

---

**Total: 10 findings (7 high/critical + 3 medium). Estimated effort to resolve: 3–4 weeks for a full token/component refactor; urgent: fix items 1–4 before adding new pages.**
