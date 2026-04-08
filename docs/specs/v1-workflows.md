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

## 3. Orchestrated Workflows

**Agent:** orchestrator

**Trigger:**
- Manual: CLI invocation or dashboard
- Webhook: `issues` event (new lead or workflow trigger)

**Input:**
- High-level workflow request (BD outreach, content planning, etc.)
- Context documents or CRM data as needed

**Workflow steps:**
1. `inference.chat` -- decompose request into sub-tasks
2. Delegate sub-tasks to appropriate agents (proposal-engine, evidence-auditor, etc.)
3. `crm.list_pipeline` -- get current pipeline state if relevant
4. Coordinate cross-agent state and handoffs
5. Aggregate results into unified digest
6. `device.notify` -- push summary notification

**Approval gates:**
- Inherits approval gates from delegated sub-tasks
- `email.send` -- critical (never auto-send outreach)
- `crm.move_stage` -- warning (flag for review)

**Planner mode:** critic -- plan generated, then critic reviews for coordination quality before finalizing

**Output:**
- Unified workflow digest with results from all sub-tasks
- Delegated agent outputs (proposals, audits, reviews)
- Recommended next actions

**Retry:** Manual re-invocation via CLI or dashboard

**Failure handling:**
- Logged in `run_events`
- Telegram notification on failure
- Partial results preserved from completed sub-tasks

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
- evidence-auditor: `0 9 * * 1` (Monday 9 AM)
- staffing-monitor: `0 9 * * 1` (Monday 9 AM)
- regulatory-watch: `0 7 * * 1,4` (Mon/Thu 7 AM)
- knowledge-curator: `0 6 * * 1-5` (weekdays 6 AM)
- self-reflection: `0 6 * * 0` (Sunday 6 AM)

**Input:** Agent-defined (see individual agent definitions)

**Approval gates per agent:**
- orchestrator: `email.send` (critical), `crm.move_stage` (warning)
- evidence-auditor: `document.generate_report` (warning)
- staffing-monitor: `email.send` (critical)
- proposal-engine: `email.send` (critical), `document.generate_report` (warning)
- contract-reviewer: `document.generate_report` (warning)
- knowledge-curator: none (read-only)
- regulatory-watch, self-reflection: none (read-only)

**Output:** Each agent produces its own report format, delivered via configured `output_channels` (typically `telegram:daniel`)

**Monitoring:**
- All runs logged in `run_events` table with status, duration, and step count
- Failed runs trigger Telegram notification
- Experimental agents are clearly marked in dashboards and logs

**Note:** Only V1 production agents (evidence-auditor, staffing-monitor, regulatory-watch, knowledge-curator, self-reflection) run on schedule in production.
