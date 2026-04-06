# V1 Workflow Specifications

Operator-focused specs for the five production workflows in Jarvis V1.

---

## 1. Document / RFQ Analysis

**Agents:** evidence-auditor, proposal-engine

**Trigger:**
- Manual: dashboard button or CLI invocation
- Webhook: `push` event (new document uploaded)

**Input:** Document path, URL, or uploaded file (PDF, DOCX)

**Workflow steps:**
1. `document.ingest` -- parse the RFQ/SOW/safety document
2. `document.analyze_compliance` -- check against ISO 26262 Part 6 checklist (evidence-auditor)
3. `inference.rag_query` -- search past proposals for similar engagements (proposal-engine)
4. `inference.chat` -- cross-reference compliance gaps, extract work packages, build quote structure
5. `document.generate_report` -- produce gap matrix and/or proposal document

**Approval gates:**
- `document.generate_report` -- conditional (warning severity)
- `email.send` -- critical (always requires manual approval)

**Planner modes:**
- evidence-auditor: critic (plan + critic review + optional revision)
- proposal-engine: multi (N independent planners + evaluator picks best)

**Output:**
- Evidence gap matrix with gate-readiness rating (RED/YELLOW/GREEN)
- Quote structure with phases, rates, staffing, exclusions
- Compliance report with traceability gaps and recommended actions

**Retry:** Manual via dashboard retry button or CLI re-invocation

**Failure handling:**
- All errors logged in `run_events` table in runtime DB
- Telegram notification sent on failure
- Partial results preserved (gap matrix may complete even if proposal generation fails)

---

## 2. Contract Review

**Agent:** contract-reviewer

**Trigger:**
- Manual: CLI invocation or dashboard
- Webhook: `pull_request` event (contract document submitted for review)

**Input:** NDA, MSA, or SOW document (PDF or DOCX)

**Workflow steps:**
1. `document.ingest` -- parse the contract document
2. `document.extract_clauses` -- extract all clauses by category
3. `inference.chat` -- analyze each clause against TIC baseline; classify OK / FLAG / RED FLAG
4. `inference.rag_query` -- compare against past contracts database
5. `inference.chat` -- synthesize recommendation

**Approval gates:**
- `document.generate_report` -- warning severity

**Planner mode:** multi -- multiple independent viewpoints analyze the contract, evaluator synthesizes, with disagreement escalation when viewpoints conflict on clause risk levels

**Output:**
- Recommendation: SIGN / NEGOTIATE / ESCALATE
- Risk score: 0-100
- Clause-by-clause table: Category | Finding | Risk | Suggested Redline
- Top 3 negotiation priorities
- Estimated time to close if negotiations needed

**Retry:** Manual re-invocation with same or updated document

**Failure handling:**
- Logged in `run_events`
- Telegram notification on failure

---

## 3. BD Pipeline Intelligence

**Agent:** bd-pipeline

**Trigger:**
- Schedule: weekday 8:00 AM (`0 8 * * 1-5`)
- Webhook: `issues` event (new lead or CRM update)
- Manual: CLI invocation

**Input:**
- Email inbox scan (replies, new threads from prospects)
- Web signals (job postings, news, trigger events)
- CRM pipeline data (current contacts, stages, scores)

**Workflow steps:**
1. `web.search_news` -- scan target accounts for trigger events
2. `web.track_jobs` -- check hiring pages for safety/AUTOSAR/cyber roles
3. `email.search` -- scan inbox for replies or new threads
4. `crm.list_pipeline` -- get current pipeline state
5. `inference.chat` -- analyze signals, score leads, decide who to contact
6. `web.enrich_contact` -- enrich top new leads
7. `crm.add_contact` or `crm.update_contact` -- update CRM
8. `email.draft` -- draft personalized outreach for top 3 scored leads
9. `crm.digest` -- generate daily pipeline summary
10. `device.notify` -- push summary notification

**Approval gates:**
- `email.send` -- critical (never auto-send outreach)
- `crm.move_stage` -- warning (flag for review)

**Planner mode:** critic -- plan generated, then critic reviews for signal quality and outreach tone before finalizing

**Output:**
- Daily summary: top 3 leads to contact (with score + wedge)
- Pipeline delta (new leads, stage changes, stale contacts)
- Recommended next action per lead
- CRM updates applied
- Outreach drafts awaiting approval

**Retry:** Next scheduled run picks up where previous left off; manual retry via CLI

**Failure handling:**
- Logged in `run_events`
- Telegram notification on failure
- Partial CRM updates preserved (enrichment data saved even if outreach drafting fails)

---

## 4. Staffing & Utilization

**Agent:** staffing-monitor

**Trigger:**
- Schedule: Monday 9:00 AM (`0 9 * * 1`)
- Manual: CLI invocation

**Input:**
- Team staffing data (files)
- BD pipeline forecast (CRM)
- Calendar data (meeting density as engagement load proxy)

**Workflow steps:**
1. `files.read` -- load current staffing spreadsheet
2. Check calendar for meeting density per engineer
3. `crm.list_pipeline` -- get BD pipeline for upcoming staffing needs (4-6 weeks out)
4. `inference.chat` -- calculate utilization % per engineer
5. Identify free, overloaded, and ending-soon engineers
6. Match BD pipeline skill requirements to available engineers
7. Flag anyone below 60% or above 95%
8. Generate weekly digest

**Approval gates:**
- `email.send` -- critical (internal digest only, never external)

**Planner mode:** single

**Output:**
- Weekly utilization report with overall health (GREEN/YELLOW/RED)
- Per-engineer table: Name | Current % | Engagement | Ends | Alert
- BD pipeline staffing gaps (upcoming engagements needing staff in next 6 weeks)
- 1-3 recommended actions

**Retry:** Manual re-invocation; next Monday run supersedes previous

**Failure handling:**
- Logged in `run_events`
- Telegram notification on failure

---

## 5. Scheduled Monitoring

**Agents:** All agents with schedule triggers

**Trigger:** Cron expressions defined in each agent's `triggers` array:
- bd-pipeline: `0 8 * * 1-5` (weekday 8 AM)
- evidence-auditor: `0 9 * * 1` (Monday 9 AM)
- staffing-monitor: `0 9 * * 1` (Monday 9 AM)
- content-engine: `0 7 * * 1,3,4` (Mon/Wed/Thu 7 AM) -- experimental
- portfolio-monitor: `0 8 * * *` + `0 20 * * *` (8 AM + 8 PM daily) -- experimental
- garden-calendar: `0 7 * * 1` (Monday 7 AM) -- experimental
- social-engagement: `30 8 * * 1-5` + `0 18 * * 1-5` (weekday 8:30 AM + 6 PM) -- experimental
- security-monitor: `0 3 * * *` (daily 3 AM) -- experimental
- drive-watcher: `*/5 * * * *` (every 5 minutes) -- experimental

**Input:** Agent-defined (see individual agent definitions)

**Approval gates per agent:**
- bd-pipeline: `email.send` (critical), `crm.move_stage` (warning)
- evidence-auditor: `document.generate_report` (warning)
- staffing-monitor: `email.send` (critical)
- content-engine: `publish_post` (critical)
- portfolio-monitor: `trade_execute` (critical), `email.send` (critical)
- social-engagement: `post_comment` (critical)
- security-monitor: `security.lockdown` (critical), `security.firewall_rule` (critical)
- garden-calendar, meeting-transcriber, drive-watcher: none (read-only)

**Output:** Each agent produces its own report format, delivered via configured `output_channels` (typically `telegram:daniel`)

**Monitoring:**
- All runs logged in `run_events` table with status, duration, and step count
- Failed runs trigger Telegram notification
- Experimental agents are clearly marked in dashboards and logs

**Note:** Only V1 production agents (bd-pipeline, evidence-auditor, staffing-monitor) run on schedule in production. Experimental agents with schedules are disabled until promoted to production status.
