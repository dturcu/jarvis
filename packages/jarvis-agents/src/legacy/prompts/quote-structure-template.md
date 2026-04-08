# Proposal Quote Structure Template

Use this template when generating a proposal for a new engagement. Fill each section based on RFQ/SOW analysis and RAG results.

---

## 1. Engagement Overview

| Field | Value |
|-------|-------|
| Client | [Company name] |
| Contact | [Primary contact name and title] |
| Program | [Vehicle program or project name] |
| RFQ Reference | [Document reference or date] |
| TIC Proposal Date | [Date] |
| Prepared By | Daniel Turcu, Thinking in Code |

---

## 2. Scope Summary

### In Scope

List discrete work packages extracted from the RFQ/SOW. Each item should map to a concrete deliverable:

- WP1: [Deliverable name] — [brief description]
- WP2: [Deliverable name] — [brief description]
- WP3: [Deliverable name] — [brief description]

### Out of Scope

Explicitly state exclusions to prevent scope creep:

- [Item not covered]
- [Item not covered]

### Hidden Assumptions / Risks Flagged

List any assumptions identified during analysis that could create delivery risk:

- [Assumption or risk] — [Recommended mitigation]
- [Assumption or risk] — [Recommended mitigation]

---

## 3. ASIL and Compliance Assessment

| Requirement | Assessment |
|-------------|------------|
| Target ASIL level | [ASIL-A / B / C / D] |
| ISO 26262 applicability | [Yes / No / Partial] |
| ISO 21434 (Cybersecurity) | [Yes / No / Partial] |
| ASPICE target level | [L1 / L2 / L3] |
| Existing process baseline | [Present / Absent / Partial] |
| DIA (Development Interface Agreement) | [In place / Missing / TBD] |

---

## 4. Delivery Approach

TIC operates on **workstream ownership**, not staff augmentation. We take responsibility for the deliverable, not the headcount.

### Phase 1: Diagnostic

- **Duration**: 2-4 weeks
- **Price**: Fixed €[5,000 - 15,000] (based on scope complexity)
- **Deliverables**:
  - Work package decomposition and traceability map
  - ASIL/ASPICE gap analysis
  - Risk register with mitigations
  - Phase 2 scope and price recommendation
- **Rationale**: Required for all new clients. Eliminates scope risk before committing to Phase 2.

### Phase 2: Delivery

- **Duration**: [N weeks / months], milestone-based
- **Price**: Fixed price €[X] total, billed at milestones:
  - Milestone 1: [Deliverable] — €[amount] — [target date]
  - Milestone 2: [Deliverable] — €[amount] — [target date]
  - Milestone 3: [Deliverable] — €[amount] — [target date]
- **Team**: [N engineers] across [disciplines]

---

## 5. Rate Card (T&M Reference Only)

T&M rates are provided for reference and change requests only. Base delivery is fixed price.

| Profile | Rate |
|---------|------|
| ASIL-D Senior Engineer | €130-180/h |
| Standard Safety Engineer | €85-120/h |
| ASPICE Process Lead | €100-140/h |
| AUTOSAR BSW Specialist | €110-150/h |

---

## 6. Staffing Plan

| Role | Name / TBD | Allocation | Phase |
|------|------------|------------|-------|
| Engagement Lead | Daniel Turcu | 20% | 1 + 2 |
| [Role] | [Name or TBD] | [%] | [Phase] |
| [Role] | [Name or TBD] | [%] | [Phase] |

---

## 7. Comparable Engagements

Reference past engagements from RAG results to establish credibility:

- **[Past client]**: [Brief description of comparable work and outcome]
- **[Past client]**: [Brief description of comparable work and outcome]

---

## 8. Commercial Terms

| Term | Value |
|------|-------|
| Payment terms | Net 30 from milestone acceptance |
| Currency | EUR |
| VAT | [Applicable / Not applicable] |
| Intellectual property | Remains with [Client / TIC] per MSA |
| Validity | This proposal is valid for 30 days |

---

## 9. Next Steps

1. Client confirms Phase 1 scope and signs SOW
2. TIC schedules kick-off within [N] business days of signature
3. Phase 1 diagnostic begins; Phase 2 scope finalized by end of Phase 1

---

## 10. Notes for TIC Internal Use

- RAG comparison: [Which past proposal this most resembles]
- Scope drift risk: [Low / Medium / High] — [reason]
- Reframe needed: [Yes / No] — [if scope is drifting toward staff augmentation, note it here]
- CRM stage: [Target stage after proposal sent]
