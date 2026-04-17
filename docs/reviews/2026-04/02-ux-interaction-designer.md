# UX/Interaction Designer — Red-team review

## Top findings

1. **[critical] Approvals and Inbox conflate three unrelated item types; risk of approval bypass through confusion**
   - Evidence: Inbox.tsx (lines 18–62) unifies "approval", "failure", "alert" into one QueueItem type, auto-prioritized by risk level. No visual separation; user can scroll past a red-risk approval while handling a low-priority failure. Approvals.tsx (lines 71–122) is a separate, dormant page that mirrors the Inbox tab—duplicate surface.
   - Impact: Daniel approves Action A, assumes it was rejected, or approves while scrolling to investigate Failure B. Consequence: email sent, publish live, or destructive action executed when operator intended the opposite.
   - Recommended fix: Render pending approvals as a **pinned, fixed-header card** that requires explicit acknowledge-and-action. Retire the secondary Approvals page; consolidate to Inbox as approval-triage-first interface.

2. **[critical] No undo for approved actions; consequence silent if approval expires unread**
   - Evidence: ApprovalItem.tsx (lines 231–236): after approval POST, refetch and move on. No confirmation of what just executed. Line 295–303 shows `what_happens_if_nothing` only for pending approvals; once approved, text vanishes. Recovery.tsx offers only safe mode or backup restore—nuclear options.
   - Impact: Daniel approves, daemon executes outbound effect in 0.5s. If he approved the wrong item, only Recovery (daemon restart, backup restore) is available.
   - Recommended fix: After approval, show a **2–5s confirmation card** ("Email sent to sales@acme.com"). Add a `revoke_approval` API endpoint callable from History or run details.

3. **[high] "Inbox vs History vs Runs vs Decisions" — overlapping pages make it hard to answer "what did agents do overnight?"**
   - Evidence: Home.tsx links to /inbox for "pending approvals" and "failed runs"; History.tsx exists but role unclear; Runs.tsx (RunTimeline import); Decisions.tsx is a raw audit table (lines 28–221). No single source of truth. Workflows→Results also shows past runs.
   - Impact: Daniel logs in, sees "5 failed runs" badge, navigates to Inbox, but sees failures + alerts + approvals mixed. Wants to spot overnight patterns (agent loop, flaky step), but must jump between pages. Loses context between Runs → Decisions → Inbox.
   - Recommended fix: Consolidate into **unified Activity Timeline** (chronological, not priority-sorted) OR rename Inbox → "Decisions" (approvals + events audit log) and clarify what History/Runs do. Kill one.

4. **[high] Approval timeout consequence is not surfaced in pending list; auto-reject silently replaces approval**
   - Evidence: ApprovalItem.tsx (lines 308–310): TimeRemaining shows countdown. But line 296–303 hides `what_happens_if_nothing` in an expand-on-click section. If Daniel sees "1 minute left" but doesn't expand, he doesn't know what happens at zero.
   - Impact: Approval expires → auto-reject or silent fallback (business logic unclear from UI). Daniel thinks "I'll handle it later" but agent stalls, order unprocessed, or consequence silently occurs.
   - Recommended fix: **Inline "what happens if nothing" text** in the action row (not collapsed). Add prominent tooltip on timer icon. Make timeout consequence explicit in every approval request.

5. **[high] Preview mode toggle buried in workflow launch form; easy to launch live by accident**
   - Evidence: Workflows.tsx (lines 402–420): Preview checkbox is below all inputs, small toggle. Default is `previewMode = workflow.safety_rules.preview_recommended` (line 299)—may be false. Success message (lines 351–354) only shows "Preview mode" if true, so absence is silent.
   - Impact: Daniel launches "Send Email" workflow intending preview. Toggle is unchecked, he scrolls past. Emails sent to real recipients. Success message doesn't flag the live execution.
   - Recommended fix: Move preview toggle **above inputs**. Change default to always-safe (preview=true). Require explicit opt-in to "Live" with a **confirm modal**. Always badge success with mode status.

6. **[high] Recovery page has five destructive actions without clear sequencing; high-risk modals not scannable for urgency**
   - Evidence: Recovery.tsx (lines 270–297): Three confirm dialogs (restart daemon, backup, restore) with generic styling. Restart (line 273) doesn't explain recovery time. Restore (lines 289–297) shows "destructive operation" but no rollback option or date preview.
   - Impact: Daniel is woken at 2am. Sees "Restart Daemon" and "Restore Backup," panics, clicks confirm without reading. Daemon restarts mid-critical run. Later, another operator uses "Restore" without checking the date—20-hour rollback happens.
   - Recommended fix: Replace generic modals with a **staged wizard**: "1. Diagnose (run repair checks) → 2. Preview (show backup date, impact) → 3. Confirm." Add a timeline of recent restarts/backups to inform urgency.

7. **[medium] Home page shows "Active Work" and "Recent Completions" in same viewport; easy to confuse in-progress with finished**
   - Evidence: Home.tsx (lines 150–159, 191–223): ActiveWorkRow (pulsing amber dot + progress bar %) vs RecentCompletions (static dot). Both use StatusBadge. Visual hierarchy is ambiguous.
   - Impact: Daniel glances while context-switching, sees "evidence-auditor 85%" and "evidence-auditor completed 2m ago" in same view. Misreads state; assumes in-progress is done, doesn't wait for approval.
   - Recommended fix: **Separate visually**—move "Active Work" to sticky header or dedicated above-the-fold card. Label sections clearly: "In Progress" vs "Just Finished." Use distinct icons (hourglass vs checkmark).

8. **[medium] Models page mapping is read-only; operators can't route workflows to inference tier without API call**
   - Evidence: Models.tsx (lines 474–523): WorkflowMappingTable is read-only. ModelRegistryTable can toggle model enabled/disabled, but mapping is static. No "Edit Mapping" UI.
   - Impact: Daniel hears "Opus is down, route to Sonnet." Logs in, sees mapping grayed out. No UI button; must SSH or call engineer. CRM workflow stalls.
   - Recommended fix: Add **"Edit Mapping" buttons** or drag-and-drop in mapping table. Inline confirmation + rollback link. Log changes in Decisions audit.

9. **[medium] Decisions log is append-only table; no filtering by outcome or run, hard to debug agent interactions**
   - Evidence: Decisions.tsx (lines 41–86): Filters by agent_id only. No run_id grouping, no outcome filter (approved/rejected/pending), no "show decisions in this run" link from FailureItem.
   - Impact: Daniel sees "failed run XYZ by agent A, step 5." Wants to see what agent B decided before A failed. Must manually scroll Decisions table for matching timestamps.
   - Recommended fix: Add **run_id filter** on Decisions. Link from FailureItem → "View decisions in run XYZ." Add outcome filter pills.

10. **[medium] Settings is a 1053-LOC monolith; potential for unguarded system-wide toggles**
    - Evidence: Settings.tsx (1053 LOC, 9 tabs). Contains Gmail/Telegram credentials, integrations config, safety rules, model assignments. Not read line-by-line, but scale alone indicates unguarded breadth.
    - Impact: Settings might have unprotected toggles ("disable all approvals," "disable outbound actions") affecting 8 agents globally. A misclick while browsing can silently alter system-wide behavior.
    - Recommended fix: Audit Settings for destructive toggles. Require re-authentication or confirm-with-consequences modal for any system-wide setting. Decompose into sub-pages.

## Positive notes

- **Timeout countdown timer (TimeRemaining) is clear and escalates color to red <60s.** Helps operator prioritize.
- **Safe Mode recommended banner on Home page is effective.** Pulsing red dot + "Open Recovery" link is scannable and action-oriented.
- **Workflow safety briefing (preview mode + outbound default) is well-structured.** Clear text, icons, and consequence badges make behavior explicit *before* launch.
