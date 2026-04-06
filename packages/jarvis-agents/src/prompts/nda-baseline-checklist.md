# NDA & Contract Baseline Terms Checklist

Daniel Turcu's preferred contract terms for Thinking in Code (TIC). Used by the Contract Review agent as the comparison baseline when analyzing incoming NDAs, MSAs, SOWs, and consulting agreements.

TIC entity: Thinking in Code SRL, registered in Iasi, Romania. EU-based company subject to Romanian law and EU regulations (GDPR, EU contract law).

---

## 1. Jurisdiction and Governing Law

**Preferred**: Romania (Romanian law)
**Acceptable**: Any EU member state (Germany, France, Netherlands, etc.)
**Flag as YELLOW**: Switzerland, Norway (non-EU but close regulatory alignment)
**Flag as RED**: United States (especially California, New York, Texas), United Kingdom (post-Brexit, separate legal framework), any non-European jurisdiction

**Rationale**: TIC is a Romanian entity. Litigation in a foreign jurisdiction is disproportionately expensive and creates enforcement risk. EU jurisdictions are acceptable because of the Brussels Regulation on mutual recognition of judgments.

**Dispute resolution preference**: Mediation first, then arbitration under ICC or VIAC rules with seat in Bucharest or Vienna. Litigation as last resort. Flag mandatory litigation in a foreign court as RED.

---

## 2. Confidentiality Term

**Preferred**: 3 years from the date of disclosure or termination of the engagement, whichever is later
**Acceptable**: Up to 5 years
**Flag as YELLOW**: 5 years exactly
**Flag as RED**: Greater than 5 years, "indefinite", "in perpetuity", "survives termination without limit"

**Required carve-outs** (flag if missing):
- Information that becomes publicly available through no fault of receiving party
- Information independently developed without reference to confidential information
- Information received from a third party without breach of obligation
- Disclosure required by law, court order, or regulatory authority (with prior notice to disclosing party where permitted)
- Residual knowledge: TIC's engineers retain the right to use general skills, knowledge, experience, and techniques acquired during the engagement

---

## 3. Intellectual Property Assignment

**Preferred**: IP assignment limited to specific deliverables explicitly listed in the SOW. TIC retains all background IP, tools, templates, methodologies, and frameworks.

**Acceptable terms**:
- "Deliverables as defined in the SOW" — acceptable if SOW scope is specific
- "Custom code developed exclusively for Client under this SOW" — acceptable
- Client receives a perpetual, non-exclusive license to background IP incorporated in deliverables — acceptable

**Flag as YELLOW**:
- "All work product created during the engagement" without SOW-specific limitation
- IP assignment includes "documentation" broadly (could capture TIC's internal process templates)
- No distinction between foreground IP (new, created for client) and background IP (pre-existing)

**Flag as RED**:
- "All work product, including derivatives, improvements, and modifications"
- Background IP or pre-existing IP included in assignment
- "Derivatives" of TIC's methodologies, tools, or frameworks
- "Work made for hire" language (US copyright doctrine, not applicable under Romanian law)
- "Including but not limited to" before IP categories (open-ended assignment)
- No license-back provision (if TIC assigns IP, it should retain a non-exclusive license to reuse for other clients, excluding client-specific business logic)
- Moral rights waiver (not enforceable under Romanian law, but flag the attempt)

---

## 4. Liability and Liability Cap

**Preferred**: TIC's total aggregate liability capped at the total fees paid by Client to TIC in the 3-month period preceding the claim.

**Acceptable**: Liability capped at total fees paid in the preceding 6 months, or at the total value of the specific SOW giving rise to the claim.

**Flag as YELLOW**:
- Cap at 12 months of fees
- Cap at total contract value (acceptable for small engagements, risky for large ones)

**Flag as RED**:
- No liability cap stated (treat as unlimited)
- Unlimited liability
- Cap exceeding 24 months of fees
- Inclusion of consequential, indirect, incidental, or special damages without mutual exclusion
- Liability for lost profits, lost revenue, or loss of business opportunity
- Liability for third-party claims arising from client's use or modification of deliverables after acceptance

**Required exclusion clause**: Both parties exclude liability for indirect, consequential, incidental, and special damages, including loss of profits, regardless of whether advised of the possibility.

---

## 5. Indemnification

**Preferred**: Mutual and symmetric. Both parties indemnify each other for third-party claims arising from their own breach, negligence, or willful misconduct.

**Acceptable**: Mutual indemnification with reasonable scope limitations.

**Flag as YELLOW**:
- Asymmetric indemnification where TIC's obligations are broader than client's
- Indemnification for IP infringement of deliverables (acceptable if limited to TIC's original work, not client-provided specifications or third-party components)

**Flag as RED**:
- One-sided indemnification (TIC indemnifies client, client does not indemnify TIC)
- TIC indemnifies for any claim arising from the engagement (too broad)
- Indemnification for client's regulatory non-compliance
- No cap on indemnification exposure (should align with liability cap)
- TIC indemnifies against claims arising from client's modification of deliverables

---

## 6. Non-Compete and Non-Solicitation

**Preferred**: No non-compete. If required, maximum 12 months post-engagement, limited to direct competitors of the client in the same specific product domain.

**Acceptable**: 12 months, limited scope (same vehicle platform or same product line), limited geography (same country as client's primary operations).

**Flag as YELLOW**:
- Duration of 12-18 months
- Broad but defined scope ("automotive safety consulting for [specific OEM list]")
- Includes non-solicitation of client's employees (acceptable if mutual)

**Flag as RED**:
- Duration exceeding 24 months
- "Indefinite" or "surviving termination without limit"
- Unrestricted geographic scope ("worldwide")
- Covers entire automotive industry ("shall not provide services to any entity in the automotive sector")
- Applies to TIC's individual employees after they leave TIC
- No consideration or compensation for non-compete period
- Non-solicitation that prevents TIC from hiring from the general job market

---

## 7. Payment Terms

**Preferred**: Net 30 from invoice date. Invoices submitted monthly or at milestone completion.

**Acceptable**: Net 30 from invoice receipt (adds a few days for "receipt" processing).

**Flag as YELLOW**:
- Net 45
- Payment tied to client's internal approval process (adds unpredictable delay)
- Currency other than EUR (acceptable if USD or GBP with exchange rate clause)

**Flag as RED**:
- Net 60 or longer
- Payment contingent on client's end-customer payment ("pay-when-paid")
- No late payment interest clause
- Right to withhold payment for "unsatisfactory" deliverables without defined acceptance criteria
- Payment only upon project completion (for engagements longer than 1 month)

**Required terms**:
- Late payment interest: ECB base rate + 8% (per EU Late Payment Directive 2011/7/EU)
- Right to suspend work if payment is overdue by more than 30 days
- All amounts in EUR unless explicitly agreed otherwise

---

## 8. Termination

**Preferred**: Either party may terminate for convenience with 30 calendar days written notice. Client pays for all work completed and accepted up to termination date, plus work in progress at pro-rata rates.

**Acceptable**: 60-day notice period for convenience. Immediate termination for material breach with 30-day cure period.

**Flag as YELLOW**:
- 90-day notice period (long, but negotiable)
- Termination for convenience only available to client (one-sided)
- No payment for work in progress at termination

**Flag as RED**:
- No termination for convenience clause (locked into the full term)
- Client can terminate for convenience but TIC cannot
- No cure period for breach (immediate termination for any breach)
- Termination triggers IP forfeiture (TIC loses rights to background IP upon termination)
- No obligation to pay for delivered work upon termination
- Penalty clauses upon early termination (beyond returning advance payments)

---

## 9. Governing Language

**Preferred**: English as the governing language of the agreement.
**Acceptable**: Romanian.
**Flag as YELLOW**: German, French (common in automotive, but adds translation burden for disputes).
**Flag as RED**: Any other language as the sole governing version, especially if TIC does not have fluent speakers. Dual-language agreements where the non-English version prevails in case of conflict.

---

## 10. Data Protection (GDPR)

**Preferred**: Standard GDPR data processing agreement (DPA) as an annex if TIC processes any personal data on behalf of client.

**Required elements** (flag if missing when personal data is involved):
- Data processing purposes limited to engagement scope
- Sub-processor notification and approval process
- Data breach notification within 72 hours
- Data subject rights cooperation
- Data deletion or return upon engagement termination
- Appropriate technical and organizational measures

**Flag as RED**:
- No GDPR provisions when personal data processing is in scope
- Client requires data transfer outside EU/EEA without adequate safeguards (SCCs, adequacy decision)
- TIC required to process personal data without a documented legal basis

---

## 11. Insurance Requirements

**Preferred**: Professional indemnity insurance (E&O) at levels proportionate to engagement value.
**Acceptable**: Requirement for professional indemnity insurance up to EUR 1M per claim.
**Flag as YELLOW**: Insurance requirements exceeding EUR 2M per claim.
**Flag as RED**: Insurance requirements exceeding EUR 5M per claim (disproportionate for a 23-person consultancy), or requirement for US-specific insurance policies.

---

## 12. Assignment and Subcontracting

**Preferred**: Neither party may assign without prior written consent (not to be unreasonably withheld). TIC may use subcontractors with prior notice.
**Flag as YELLOW**: Client may assign to affiliates without consent.
**Flag as RED**: Client may freely assign to any third party without TIC's consent. TIC prohibited from using any subcontractors (restricts operational flexibility).
