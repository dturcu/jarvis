# Accessibility Specialist — Red-team review

## Top findings

1. **[CRITICAL]** Icon-only buttons lack accessible labels
   - Evidence: Approvals.tsx:57–59 (Approve/Reject buttons), Models.tsx:202–206 (Load Model button), Godmode.tsx:76–83 (sidebar toggle)
   - WCAG 2.1.1 (Keyboard), 1.4.11 (Non-text contrast), 1.1.1 (Text alternatives)
   - Impact: Keyboard navigators cannot understand button purpose; screen reader users hear nothing. Approval actions become inaccessible to 15+ million users with vision impairments in the US alone.
   - Recommended fix: Add `aria-label` to all icon-only buttons and SVG icons marked `aria-hidden`.

2. **[HIGH]** Dialog / Modal lacks focus trap and keyboard escape handling
   - Evidence: Models.tsx:310–384 (ModelLoadModal), Settings.tsx:1041–1050 (ConfirmDialog)
   - WCAG 2.1.2 (Keyboard), 2.4.3 (Focus Order)
   - Impact: Tab key can escape modal; focus can move to hidden page elements. Keyboard-only users get lost in navigation; screen reader announces stale background content.
   - Recommended fix: Trap focus within modal. Listen for ESC key to close. Return focus to trigger button on close.

3. **[HIGH]** Form inputs missing associated labels
   - Evidence: Settings.tsx:107–122 (TextInput, SelectInput components), ChatPanel.tsx:142–150 (textarea)
   - WCAG 2.1.3 (Labels or Instructions), 3.3.2 (Labels or Instructions)
   - Impact: Screen reader users cannot identify form fields; error messages orphaned from inputs. Estimated 10–15% form completion failure for assistive tech users.
   - Recommended fix: Use `<label htmlFor={id}>` paired to every input. Pass generated IDs to inputs.

4. **[HIGH]** No live region for streaming chat messages
   - Evidence: ChatPanel.tsx:39–50, 105–137 (MessageBubble, main messages div)
   - WCAG 4.1.3 (Status Messages), 4.1.4 (Real-time Updates)
   - Impact: When assistant streams responses or tool outputs appear, screen reader users miss content updates entirely. Approval timeout countdowns not announced.
   - Recommended fix: Wrap message container in `<div role="region" aria-live="polite" aria-label="Chat messages">`. Announce approval timeout changes: `<div aria-live="assertive">Expires in 3 minutes</div>`.

5. **[HIGH]** Toggle switch lacks accessible semantics
   - Evidence: Settings.tsx:144–167 (Toggle component), Workflows.tsx:407–410 (Preview mode toggle)
   - WCAG 2.1.1 (Keyboard), 4.1.2 (Name, Role, Value)
   - Impact: Custom toggle appears as unlabeled button to screen readers. No `aria-checked` state announced. Keyboard users must use mouse-like clicks.
   - Recommended fix: Use native `<input type="checkbox">` with `<label>` wrapping, or add `role="switch" aria-checked={checked}` and keyboard support (`Space` to toggle).

6. **[HIGH]** Tables lack header associations
   - Evidence: Models.tsx:409–470 (ModelRegistryTable header/tbody), Models.tsx:491–521 (WorkflowMappingTable)
   - WCAG 1.3.1 (Info and Relationships)
   - Impact: Screen reader users cannot correlate data cells to column headers. Model IDs, runtimes, status columns announced without context.
   - Recommended fix: Add `<th scope="col">` to all table headers. Use `<td headers="col-id">` if needed, or ensure first column is always `<th scope="row">`.

7. **[MEDIUM]** Color contrast on dark backgrounds insufficient for AA
   - Evidence: Settings.tsx:99 (text-slate-400 on bg-slate-800/50), Approvals.tsx:26–33 (riskColors on slate-800/50)
   - WCAG 1.4.3 (Contrast Minimum: 4.5:1 for normal text)
   - Impact: Users with low vision, color blindness, or viewing in bright sunlight cannot distinguish text. Affects ~8% of males with color blindness.
   - Recommended fix: Raise text lightness. `text-slate-400` + `slate-800/50` ≈ 3.2:1; use `text-slate-200` (≈5.5:1). Verify all status badge colors (amber-400, red-400) meet 3:1 minimum on dark.

8. **[MEDIUM]** Approval card timeout not announced to screen readers
   - Evidence: Approvals.tsx:45–49 (hardcoded "Expires in X minutes" text only)
   - WCAG 4.1.3 (Status Messages), 2.2.1 (Timing Adjustable)
   - Impact: Screen reader users cannot hear approval timeout. Blind users will miss critical time-sensitive actions.
   - Recommended fix: Wrap expiry countdown in `<div role="status" aria-live="polite" aria-label="Approval timeout warning">` and update live every minute.

9. **[MEDIUM]** Custom select component lacks keyboard support
   - Evidence: Godmode.tsx:109–121 (model selector `<select>` ok), but Settings.tsx:133–141 (SelectInput no keyboard open/close)
   - WCAG 2.1.1 (Keyboard)
   - Impact: Keyboard-only users can navigate but not activate custom dropdowns. Reduced usability vs. native `<select>`.
   - Recommended fix: Ensure all custom selects implement arrow key navigation, Enter/Space to open, Escape to close.

10. **[LOW]** No skip link to main content
    - Evidence: index.html (no skip link), AppShell/TopBar/SideNav structure
    - WCAG 2.4.1 (Bypass Blocks)
    - Impact: Keyboard users must tab through 10+ nav items before reaching main content. Low impact if nav is short, but best practice for long navs.
    - Recommended fix: Add hidden skip link: `<a href="#main" className="sr-only focus:not-sr-only">Skip to content</a>`. Wrap page content in `<main id="main">`.

---

## Positive notes

- **Focus indicators present**: Global CSS `:focus-visible` rule (index.css:68–71) correctly applies outline to interactive elements. Ring patterns in Tailwind reinforce state.
- **Semantic HTML mostly correct**: Pages use `<button>`, `<input>`, `<textarea>`, `<select>`, `<label>` appropriately. Dialogs use native `<dialog>` element (ConfirmDialog.tsx:35).
- **Heading hierarchy respected**: Home.tsx, Workflows.tsx, Settings.tsx properly nest `<h1>`, `<h2>`, `<h3>` without skipping levels. Improves document outline.

