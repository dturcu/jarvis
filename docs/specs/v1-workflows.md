# Jarvis V1 Workflow Specifications

This document defines the five production workflows included in the Jarvis V1 release. Each spec covers the trigger, input, approval gates, output, and participating agents.

---

## 1. Document / RFQ Analysis

**Agents:** evidence-auditor, proposal-engine

**Purpose:** Ingest a document (RFQ, SOW, or project evidence set), analyze it against compliance checklists or proposal frameworks, and produce a structured output.

### Trigger
- **Manual** -- operator provides a document path or URL
- **Event** -- `email.received.rfq` webhook fires on incoming RFQ

### Input
- Document path (local filesystem) or URL
- Optional: ASIL level hint, target client name

### Steps
1. `document.ingest` -- parse the input document
2. `inference.chat` -- extract work packages, scope boundaries, assumptions, and risks
3. `inference.rag_query` -- search knowledge store for similar past engagements or ISO 26262 reference material
4. `inference.chat` -- produce the deliverable (gap matrix for evidence-auditor, quote structure for proposal-engine)
5. `document.generate_report` -- render output as structured report (DOCX)

### Approval Gates
| Action | Severity | Notes |
|---|---|---|
| `document.generate_report` | warning | Conditional -- required when generating formal deliverables |

### Output
- **evidence-auditor:** Gap matrix with gate-readiness score (RED/YELLOW/GREEN), missing work products, traceability gaps, recommended next 3 actions
- **proposal-engine:** Quote structure with phases, rates, staffing, exclusions, and cover email draft

### Error Handling
- If document parsing fails, report extraction error and abort
- If RAG returns no relevant matches, proceed with analysis but flag low confidence

---

## 2. Contract Review

**Agent:** contract-reviewer

**Purpose:** Analyze NDA/MSA/SOW documents against TIC's standard contract baseline and produce a sign/negotiate/escalate recommendation.

### Trigger
- **Manual** -- operator provides contract document
- **Event** -- `email.received.nda` webhook

### Input
- NDA, MSA, or SOW document (PDF or DOCX)

### Steps
1. `document.ingest` -- parse the contract document
2. `document.extract_clauses` -- extract clauses by category (jurisdiction, IP, liability, confidentiality, etc.)
3. `inference.chat` -- analyze each clause against TIC baseline; classify as OK / FLAG / RED FLAG
4. `inference.rag_query` -- compare against past contracts in knowledge store
5. `inference.chat` -- synthesize overall recommendation: SIGN / NEGOTIATE / ESCALATE
6. `device.notify` -- push summary with risk rating

### Approval Gates
| Action | Severity | Notes |
|---|---|---|
| `document.generate_report` | warning | Required when producing formal clause analysis report |

### Output
- Recommendation: SIGN / NEGOTIATE / ESCALATE
- Risk score: 0-100
- Clause-by-clause table: Category, Finding, Risk Level, Suggested Redline
- Top 3 negotiation priorities
- Estimated days to close if negotiation needed

### Error Handling
- If clause extraction produces fewer than 3 categories, flag as possible parsing failure
- Escalate to operator if risk score exceeds 80

---

## 3. BD Pipeline Intelligence

**Agent:** bd-pipeline

**Purpose:** Scan for business development signals, enrich leads, draft personalized outreach, and maintain the CRM pipeline.

### Trigger
- **Scheduled** -- weekday mornings at 08:00 (`0 8 * * 1-5`)
- **Manual** -- on-demand pipeline refresh

### Input
- Email inbox (scan for prospect replies)
- Web signals (job postings, press releases, LinkedIn activity)
- Current CRM pipeline state

### Steps
1. `web.search_news` -- scan target accounts for trigger events
2. `web.track_jobs` -- check hiring pages for safety/AUTOSAR/cyber roles
3. `email.search` -- scan inbox for replies or new prospect threads
4. `crm.list_pipeline` -- get current pipeline state
5. `inference.chat` -- analyze signals, score leads using trigger event rubric
6. `web.enrich_contact` -- enrich top new leads
7. `crm.add_contact` / `crm.update_contact` -- update CRM records
8. `email.draft` -- draft personalized outreach for top 3 scored leads
9. `crm.digest` -- generate daily pipeline summary
10. `device.notify` -- push summary notification

### Approval Gates
| Action | Severity | Notes |
|---|---|---|
| `email.send` | critical | All outbound emails require manual approval -- never auto-send |
| `crm.move_stage` | warning | Stage transitions flagged for review |

### Output
- Daily summary: top 3 leads to contact (with score + outreach wedge), pipeline delta, stale contacts, recommended next action per lead
- Draft emails in outbox (awaiting approval)
- CRM updates applied

### Error Handling
- If web scraping fails for a target account, skip and note in summary
- If CRM is unreachable, queue updates and retry on next run

---

## 4. Staffing & Utilization

**Agent:** staffing-monitor

**Purpose:** Track team allocation across active engagements, calculate utilization, forecast staffing gaps, and match available engineers to pipeline needs.

### Trigger
- **Scheduled** -- weekly on Monday at 09:00 (`0 9 * * 1`)

### Input
- Team staffing data (current assignments, hours, skill profiles)
- Calendar meeting density (proxy for engagement load)
- BD pipeline forecast (upcoming engagements needing staff in 4-6 weeks)

### Steps
1. `files.read` -- load current staffing spreadsheet
2. Calendar check -- review meeting density per engineer
3. `crm.list_pipeline` -- check BD pipeline for upcoming staffing needs
4. `inference.chat` -- calculate utilization percentages, identify gaps and overload
5. `inference.chat` -- match BD pipeline skill requirements to available engineers
6. `inference.chat` -- generate weekly digest
7. `device.notify` -- push utilization report

### Approval Gates
| Action | Severity | Notes |
|---|---|---|
| `email.send` | critical | Only for internal distribution; external email is prohibited for this workflow |

### Output
- Weekly utilization report with overall health score (GREEN/YELLOW/RED)
- Per-engineer table: name, current engagement, utilization %, end date, alerts
- BD pipeline staffing gaps (next 6 weeks)
- Recommended actions (1-3 specific items)

### Error Handling
- If staffing data is stale (>7 days old), flag in report header
- If utilization calculation produces impossible values (>100% or <0%), report data quality issue

---

## 5. Scheduled Monitoring & Reporting

**Agents:** All agents with scheduled triggers

**Purpose:** Orchestrate cron-driven agent runs, enforce approval gates, and deliver reports via notification channels.

### Trigger
- **Cron** -- each agent's schedule as defined in its trigger configuration

### Input
- Agent definition (including system prompt, capabilities, approval gates)
- Previous run context (short-term memory cleared, long-term memory persisted)

### Steps
1. Cron scheduler fires agent run
2. Agent runtime loads definition and creates run context
3. Agent executes its workflow steps (per agent-specific spec above)
4. At each approval gate, execution pauses until approval is granted or denied
5. On completion, results are dispatched to configured output channels
6. Run status and artifacts are persisted to runtime database

### Approval Gates
Per-agent approval configuration:

| Agent | Action | Severity |
|---|---|---|
| bd-pipeline | `email.send` | critical |
| bd-pipeline | `crm.move_stage` | warning |
| proposal-engine | `email.send` | critical |
| proposal-engine | `document.generate_report` | warning |
| evidence-auditor | `document.generate_report` | warning |
| contract-reviewer | `document.generate_report` | warning |
| staffing-monitor | `email.send` | critical |

### Output
- Agent-specific report delivered to Telegram and/or email
- Run records persisted in runtime database
- Artifacts (generated documents, reports) stored and linked to run

### Error Handling
- If an agent run exceeds `max_steps_per_run`, abort and report partial results
- If a critical approval times out, cancel the pending action and notify operator
- Failed runs are logged with error details; retry policy is manual (max 3 attempts)

---

## V1 Production Agents Summary

| Agent | Experimental | Schedule | Planner Mode | Maturity |
|---|---|---|---|---|
| bd-pipeline | No | Weekdays 08:00 | critic | trusted_with_review |
| proposal-engine | No | Manual / event | multi | high_stakes_manual_gate |
| evidence-auditor | No | Monday 09:00 / manual | critic | trusted_with_review |
| contract-reviewer | No | Manual / event | multi | high_stakes_manual_gate |
| staffing-monitor | No | Monday 09:00 | single | operational |
