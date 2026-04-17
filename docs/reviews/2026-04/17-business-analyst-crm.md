# Business Analyst — CRM + Proposals — Red-team review

Scope: `packages/jarvis-crm-worker/src/{types,store,execute}.ts`, `packages/jarvis-crm-plugin/src/index.ts`, `packages/jarvis-runtime/src/migrations/crm_0001_core.ts`, `knowledge_0001_core.ts`, `packages/jarvis-agents/src/definitions/{proposal-engine,staffing-monitor}.ts`, `packages/jarvis-dashboard/src/ui/pages/{CrmPipeline,CrmAnalytics,EntityGraph,Portal}.tsx`, `packages/jarvis-dashboard/src/api/portal.ts`.

## Top findings

1. **[Critical] No deal/opportunity entity — the "pipeline stage" lives on the contact row.**
   - Evidence: `crm_0001_core.ts` lines 11–24 put `stage` on `contacts`; `CrmStore.moveStage()` mutates the contact (`store.ts:99-121`). There is no `deals`/`opportunities` table, no company table, no `account_id`.
   - Impact: A single account with two concurrent RFQs (common in automotive: one BSW engagement, one ISO 26262 audit) collapses into one stage. If one deal is `won` and one is `lost`, the contact can only hold one value. Win-rate, cycle-time, and weighted-pipeline math are structurally wrong. Champions at won accounts also appear as "lost contacts" when a different deal loses.
   - Fix: Introduce `companies`, `deals(id, company_id, stage, value_eur, owner, close_date, weighted_value)`, move `stage_history` to deal-scoped, keep contacts per-person with `primary_company_id` and `role_at_company`.

2. **[Critical] No proposal workflow state machine — "proposals" are just `note_type='proposal'`.**
   - Evidence: `CrmAddNoteInput.note_type` enum (`types.ts:99`) is the only mention of proposal state; no table for proposals/quotes/SOWs. The proposal-engine prompt defines `proposal_document`, `invoice_structure`, and `risk_summary` as artifacts (`proposal-engine.ts:26-30`) but none persist to CRM beyond a free-text note.
   - Impact: You cannot answer "which proposals are out, with whom, at what price, sent when, awaiting response for how long?" without scraping DOCX files. Follow-ups are invisible. `invoice_structure` is generated and lost.
   - Fix: Add `proposals(id, deal_id, version, status: draft|sent|negotiating|accepted|rejected|withdrawn, value_eur, currency, phase1_amount, phase2_amount, sent_at, expires_at, doc_path)` and a `proposal_line_items` table.

3. **[Critical] No invoice lifecycle — `invoice-generator` is archived in legacy.**
   - Evidence: `packages/jarvis-agents/src/legacy/definitions/invoice-generator.ts` exists (archived); proposal-engine prompt mentions "generate milestone-based invoicing structure" (`proposal-engine.ts:16`) but no active agent, no `invoices` table, no draft/sent/paid/overdue lifecycle, no accounting integration.
   - Impact: Revenue leakage — a milestone can be delivered and never billed. DSO (days-sales-outstanding) cannot be reported. VAT compliance is unauditable. For an EU consulting firm this is a direct legal/tax risk.
   - Fix: Restore `invoice-generator` as first-class agent; create `invoices(id, proposal_id, milestone_id, status, amount_eur, vat_rate, issued_at, due_at, paid_at, external_ref)` with approval gate on issue.

4. **[High] No decision-maker / champion / blocker role on contacts.**
   - Evidence: `ContactRecord` (`types.ts:26-40`) has a free-text `role` and `tags`. No `is_decision_maker`, `is_economic_buyer`, `is_champion`, `is_blocker`, `is_gatekeeper`, or `influence_score`.
   - Impact: Proposal-engine cannot personalize strategy, staffing-monitor cannot forecast political risk, self-reflection cannot learn "we lose when we only have a champion but no economic buyer" — the MEDDIC/Challenger-style insights that differentiate senior B2B consulting are impossible.
   - Fix: Add `contact_roles(contact_id, deal_id, role)` where role ∈ {champion, economic_buyer, user, technical_buyer, gatekeeper, blocker}.

5. **[High] Missing discovery/PoC/MSA-signed stages for safety-consulting reality.**
   - Evidence: `PipelineStage` (`types.ts:1-10`) has no `discovery`, `poc_pilot`, `msa_pending`, or `on_hold_regulatory`. Automotive safety engagements routinely spend 4–12 weeks on MSA/DIA negotiation after verbal-win and before first PO.
   - Impact: A deal "won" at handshake but stuck in MSA legal for 6 weeks either falsely inflates `won` or clogs `negotiation`, destroying cycle-time metrics. The proposal-engine's mandatory "Phase 1 Diagnostic" (`proposal-engine.ts:19`) has no corresponding stage.
   - Fix: Expand enum to add `discovery`, `pilot`, `msa_pending`; move `parked` to a status flag orthogonal to stage.

6. **[High] No loss-reason capture — `reason` on `crm.move_stage` is ignored.**
   - Evidence: `moveStage()` accepts `_reason` with a leading underscore and never persists it (`store.ts:102`, note the discard). `stage_history` has a `note` column but the worker in-memory store drops it entirely.
   - Impact: Cannot analyze "why we lose ISO 26262 audits to Company X" or "losses by industry / sales-stage / quote-size." Self-reflection agent cannot produce actionable win/loss reviews.
   - Fix: Persist `reason` into `stage_history.note`, add enum `loss_reason ∈ {price, timing, scope, no_decision, competitor, regulatory}`, expose in analytics.

7. **[High] No multi-currency, no quote escalations, no day-rate table.**
   - Evidence: Proposal-engine prompt hard-codes "EUR 130-180/h" (`proposal-engine.ts:22`) as text; no `rate_cards` table, no `currency` column, no `annual_escalation_pct`. Dashboard `CrmAnalytics` has no value-weighted funnel — only contact counts.
   - Impact: USD-denominated German OEM suppliers and UK engagements (GBP post-Brexit) cannot be represented; FX gains/losses invisible; multi-year engagements missing contractual CPI/3% escalator clauses. Pipeline reporting is unit-less.
   - Fix: Introduce `rate_cards(currency, seniority, asil_level, rate)`, add `currency` + `value_*` columns on deals/proposals; dashboard should show weighted-value funnel, not contact counts.

8. **[Medium] Entity graph doesn't model job-changes, re-orgs, or mergers.**
   - Evidence: `entities` + `relations` (`knowledge_0001_core.ts:37-55`) are a single snapshot with no `valid_from/valid_to` or `supersedes_entity_id`. When a champion moves from Continental to Bosch, the old relation stays true-forever.
   - Impact: Historical context corrupts (old champion appears still at old company), merger activity (ZF-WABCO) produces duplicate companies with orphaned deals, "champion-followed" plays (track a contact to their new employer) are not supported — a missed revenue opportunity.
   - Fix: Add temporal columns to `relations`; add `merge_into_entity_id` with provenance; surface a "contact moved" event to CRM.

9. **[Medium] Sales-to-delivery handoff is undefined — `won` is a dead end.**
   - Evidence: No `engagements` table, no linkage from `contacts.stage='won'` to a delivery project. Staffing-monitor prompt (`staffing-monitor.ts:7`) says "Query CRM for active engagements (end dates, headcount)" but that data does not exist in the CRM schema. The portal surfaces "milestones" by keyword-scanning note text (`portal.ts:211-228`) — brittle.
   - Impact: Staffing-monitor cannot actually do its job; capacity forecasts are fiction. When a deal closes, nothing spins up the engagement — delivery learns via email.
   - Fix: Add `engagements(id, deal_id, start_date, end_date, assigned_engineers, status)` triggered by `stage → won`; rework portal milestones to read from `engagement_milestones`, not note substrings.

10. **[Medium] No bidirectional Gmail/calendar/Telegram sync — activity log is one-way agent writes.**
    - Evidence: `notes` table has no `source_message_id`, `thread_id`, or `external_ref`. Nothing prevents the same email from producing three notes if re-processed; nothing links a meeting in Google Calendar to a CRM contact.
    - Impact: Timeline duplication, missed touches (emails never auto-logged), "last contact" score drifts from reality. Staffing-monitor using "meeting density per engineer" as a load proxy (`staffing-monitor.ts:9`) is uncorrelated with the CRM.
    - Fix: Add `activities(id, contact_id, deal_id, channel, external_id UNIQUE, direction, occurred_at)` replacing the free `notes` model for communications.

## Positive notes

- Stage-history tracking is present in the schema (`stage_history` table) and surfaced in the detail panel, giving a usable timeline foundation to build real velocity analytics on top of.
- The dashboard already exposes a funnel, donut, heatmap, and velocity table (`CrmAnalytics.tsx`) — the visual scaffolding is strong; it just needs weighted-value + deal-level data behind it.
- Approval gating on `crm.move_stage` (per `CLAUDE.md`) is the right instinct for high-consequence stage changes and should extend naturally to proposal-send and invoice-issue events.
