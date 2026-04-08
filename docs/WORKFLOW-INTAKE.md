# Workflow Intake Forms

Canonical intake forms for the five core Jarvis agent workflows.
Fill out the relevant form before invoking the agent to ensure all required context is provided.

---

## 1. RFQ / Proposal Intake (proposal-engine)

| Field | Required | Description |
|---|---|---|
| Client name | Yes | Full legal entity name |
| Company | Yes | Parent company if different from client |
| Contact email | Yes | Primary point of contact |
| RFQ/SOW document path | Yes | Local file path or URL to the RFQ/SOW document |
| Service areas | Yes | Check all that apply: ISO 26262, ASPICE, AUTOSAR, Cybersecurity (ISO 21434) |
| ASIL level | If known | A, B, C, or D |
| Deadline | Yes | Proposal submission deadline (YYYY-MM-DD) |
| Budget range | If known | Estimated budget or rate expectations |
| Competition known | No | Other vendors known to be bidding |
| Prior relationship | No | Any previous TIC engagement with this client |
| Special requirements | No | Tool mandates, language, on-site needs, security clearance |

**Minimum viable intake:** Client name, document path, service areas, deadline.

---

## 2. Contract Review Intake (contract-reviewer)

| Field | Required | Description |
|---|---|---|
| Document type | Yes | NDA, MSA, SOW amendment, subcontract, framework agreement |
| Document path | Yes | Local file path to the contract document (PDF or DOCX) |
| Counterparty name | Yes | Legal entity name of the other party |
| Jurisdiction | If known | Governing law stated or expected |
| Key concerns | No | Specific clauses to scrutinize: IP, non-compete, liability, payment terms, indemnity |
| Urgency level | Yes | Standard (5 business days), Urgent (48h), Critical (same day) |
| Related contracts | No | Paths to existing MSA or prior agreements with the same counterparty |
| Internal notes | No | Context from Daniel or project lead about negotiation posture |

**Minimum viable intake:** Document type, document path, counterparty name, urgency level.

---

## 3. Evidence Audit Intake (evidence-auditor)

| Field | Required | Description |
|---|---|---|
| Project name | Yes | Internal project identifier |
| ASIL level | Yes | A, B, C, or D |
| Evidence directory path | Yes | Root directory containing work products |
| Target standard | Yes | ISO 26262 (specify Part: 3, 4, 6, 8) or ASPICE (specify SWE processes) |
| Scope | Yes | Full audit, delta from last audit, specific phase only |
| Last audit date | If delta | Date of previous audit for delta comparison |
| Deliverable format | No | Gap matrix only, full report, or gate-readiness summary |
| Deadline | Yes | When the audit results are needed (YYYY-MM-DD) |
| Stakeholders | No | Who receives the audit output (names or roles) |

**Minimum viable intake:** Project name, ASIL level, evidence directory path, target standard, scope.

---

## 4. BD Pipeline Intake (bd-pipeline)

| Field | Required | Description |
|---|---|---|
| Signal source | Yes | LinkedIn, referral, RFQ portal, conference, inbound email, job board |
| Company name | Yes | Target company |
| Industry segment | No | Powertrain, ADAS, chassis, body electronics, EV, general automotive |
| Company size | No | Approximate headcount or tier classification (OEM, Tier-1, Tier-2) |
| Contact name | If known | Name of the person to reach |
| Contact role | If known | Job title |
| Contact email | If known | Email address |
| Opportunity description | Yes | What triggered this lead and what TIC could offer |
| Estimated value range | No | Expected engagement size (EUR) |
| Urgency | No | Time-sensitive signal (active RFQ, hiring freeze ending, etc.) |
| CRM status | No | New lead, or existing contact with known stage |

**Minimum viable intake:** Signal source, company name, opportunity description.

---

## 5. Staffing Review Intake (staffing-monitor)

| Field | Required | Description |
|---|---|---|
| Review period | Yes | Current month, next quarter, or custom date range |
| Active projects to include | No | List specific project names, or "all" (default) |
| Pipeline items to factor in | No | BD pipeline leads likely to convert within the review period |
| Specific skill gaps to investigate | No | AUTOSAR, ISO 26262, cybersecurity, timing, ASPICE |
| Hiring constraints | No | Budget limits, geographic restrictions, clearance requirements |
| Bench tolerance | No | Acceptable bench percentage before escalation (default: 15%) |
| Output format | No | Executive summary only, full breakdown, or comparison to prior period |

**Minimum viable intake:** Review period.

---

## Usage

Invoke the corresponding agent with the intake fields as context:

```
/proposal-engine
Client: Bertrandt AG
Document: ~/Documents/RFQs/bertrandt-asild-bsw-2026.pdf
Service areas: AUTOSAR, ISO 26262
ASIL: D
Deadline: 2026-04-25
```

Agents will prompt for any missing required fields before proceeding.
