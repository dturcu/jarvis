/**
 * Domain-specific benchmark corpora for retrieval quality evaluation.
 *
 * Each corpus has documents seeded from Jarvis's knowledge domain
 * and queries with expected relevant document IDs.
 */

import type { BenchmarkCorpus } from "./benchmark.js";

export const CONTRACT_CORPUS: BenchmarkCorpus = {
  domain: "contracts",
  documents: [
    { doc_id: "c-nda-baseline", collection: "contracts", text: "Jurisdiction: Romania or EU member state. Confidentiality: 3 years post-engagement, not indefinite. IP assignment: customer owns deliverables explicitly listed in SOW, not background IP. Liability cap: total fees paid in preceding 12 months. Indemnity: mutual and symmetric. Non-compete: 6 months, product-line specific. Payment: Net 30." },
    { doc_id: "c-nordic-nda", collection: "contracts", text: "NDA between Thinking in Code and Nordic Auto AB. Swedish law jurisdiction. Confidentiality period: 5 years. IP assignment: all deliverables created for the project. Mutual indemnity. Liability capped at 12-month fees. Non-compete: specific product line, 6 months." },
    { doc_id: "c-sigma-msa", collection: "contracts", text: "Master Service Agreement with Sigma Components GmbH. German law jurisdiction. Payment terms: Net 45. IP: customer owns work product, TIC retains background IP license. Non-compete: automotive division only, 12 months. Termination: 60 days written notice." },
    { doc_id: "c-us-msa", collection: "contracts", text: "MSA with US-based client under Delaware law. Unlimited indemnity clause. No liability cap specified. Perpetual confidentiality. Customer-only termination right. Payment contingent on customer satisfaction approval." },
    { doc_id: "c-standard-sow", collection: "contracts", text: "Statement of Work for ASIL-D safety analysis. Fixed price EUR 85,000. Deliverables: HARA report, safety concept, TSR set, DIA. Timeline: 12 weeks. Acceptance criteria: formal review with customer safety team." },
  ],
  queries: [
    { query_id: "cq-1", query: "What are the standard liability terms for TIC contracts?", relevant_doc_ids: ["c-nda-baseline"] },
    { query_id: "cq-2", query: "Find contracts with non-EU jurisdiction", relevant_doc_ids: ["c-us-msa"] },
    { query_id: "cq-3", query: "Which contracts have unlimited indemnity or no liability cap?", relevant_doc_ids: ["c-us-msa"] },
    { query_id: "cq-4", query: "Nordic Auto NDA confidentiality terms", relevant_doc_ids: ["c-nordic-nda"] },
    { query_id: "cq-5", query: "ASIL-D safety analysis scope and deliverables", relevant_doc_ids: ["c-standard-sow"] },
    { query_id: "cq-6", query: "Non-compete clause comparison across clients", relevant_doc_ids: ["c-nda-baseline", "c-nordic-nda", "c-sigma-msa", "c-us-msa"] },
    { query_id: "cq-7", query: "Payment terms longer than Net 30", relevant_doc_ids: ["c-sigma-msa"] },
  ],
};

export const EVIDENCE_CORPUS: BenchmarkCorpus = {
  domain: "evidence",
  documents: [
    { doc_id: "e-iso-part6", collection: "iso26262", text: "ISO 26262 Part 6 required work products by ASIL level. ASIL A: software safety plan, design spec, unit tests. ASIL B adds: formal review of unit tests. ASIL C adds: MC/DC coverage, software safety analysis. ASIL D adds: independent review, 100% structural coverage, formal inspection records." },
    { doc_id: "e-aspice-swe1", collection: "iso26262", text: "ASPICE SWE.1 Software Requirements Analysis. Purpose: establish software requirements. Base practices: elicitation, analysis, evaluation, agreement. Output: software requirements specification, traceability matrix from system requirements. Capability Level 2 requires: review records, stakeholder sign-off, change management log." },
    { doc_id: "e-traceability", collection: "iso26262", text: "ISO 26262 traceability requirements for ASIL C and D. HSR to FSR to TSR to SSR requirement chain. SSR to SW Arch to SW Unit Design for design traceability. SSR to Test Cases to Test Results for test traceability. All links must be formally documented and reviewable." },
    { doc_id: "e-dia-guide", collection: "playbooks", text: "Development Interface Agreement (DIA) guidelines. Required when work is split across suppliers. Must cover: responsibility matrix, deliverable formats, review gates, change notification process, tool compatibility, and traceability handoff procedures. Missing DIA is a common audit finding." },
    { doc_id: "e-gate-review", collection: "case-studies", text: "Gate review findings from 14 supplier audits. Most common gap: SWE.1 work product completeness. Second: missing traceability from HSR to SSR. Third: no formal review records for ASIL C/D unit tests. Fourth: DIA gaps in multi-supplier projects." },
  ],
  queries: [
    { query_id: "eq-1", query: "What work products are required for ASIL D?", relevant_doc_ids: ["e-iso-part6"] },
    { query_id: "eq-2", query: "SWE.1 requirements for ASPICE Level 2", relevant_doc_ids: ["e-aspice-swe1"] },
    { query_id: "eq-3", query: "Traceability chain from HSR to test results", relevant_doc_ids: ["e-traceability"] },
    { query_id: "eq-4", query: "When is a DIA required and what should it cover?", relevant_doc_ids: ["e-dia-guide"] },
    { query_id: "eq-5", query: "Most common audit findings in supplier gate reviews", relevant_doc_ids: ["e-gate-review"] },
    { query_id: "eq-6", query: "MC/DC coverage requirements by ASIL level", relevant_doc_ids: ["e-iso-part6"] },
  ],
};

export const PROPOSAL_CORPUS: BenchmarkCorpus = {
  domain: "proposals",
  documents: [
    { doc_id: "p-rate-card", collection: "proposals", text: "Thinking in Code 2026 rate card. Senior Safety Engineer: EUR 130-180/h. Safety Architect ASIL-D: EUR 160-200/h. Cyber Security Engineer: EUR 120-160/h. AUTOSAR Architect: EUR 140-180/h. Standard engagement: T&M with 3-month minimum. Fixed price only for well-scoped work products." },
    { doc_id: "p-nordic-proposal", collection: "proposals", text: "Proposal for Nordic Auto ASIL-D E/E architecture safety analysis. Phase 1: 2-week diagnostic at EUR 12,000 fixed. Phase 2: 12-week delivery, 2 senior engineers, milestone-based pricing. Deliverables: HARA, FSC, TSR, DIA with 3 Tier-1s." },
    { doc_id: "p-garrett-proposal", collection: "proposals", text: "Proposal for Garrett Motion E-Axle timing closure. Phase 1: 3-week diagnostic at EUR 15,000 fixed. Key risk: timing analysis tool compatibility. Phase 2: workstream ownership with dedicated timing specialist. 4 engineers assigned." },
    { doc_id: "p-scope-lesson", collection: "lessons", text: "Every proposal that omitted explicit out-of-scope statements led to scope creep disputes. Include EXCLUSIONS section listing: validation of third-party components, tool qualification, production software delivery, acceptance testing unless specified." },
    { doc_id: "p-phase1-lesson", collection: "lessons", text: "Phase 1 diagnostic for new clients prevents failed engagements. 3 of 5 proposals that skipped Phase 1 resulted in scope disputes. Always recommend Phase 1 for first-time clients. Fixed price EUR 5-15k depending on complexity." },
  ],
  queries: [
    { query_id: "pq-1", query: "What is the standard rate for an ASIL-D safety architect?", relevant_doc_ids: ["p-rate-card"] },
    { query_id: "pq-2", query: "Past proposals for Nordic Auto", relevant_doc_ids: ["p-nordic-proposal"] },
    { query_id: "pq-3", query: "Timing analysis engagement examples", relevant_doc_ids: ["p-garrett-proposal"] },
    { query_id: "pq-4", query: "How to avoid scope creep in proposals", relevant_doc_ids: ["p-scope-lesson"] },
    { query_id: "pq-5", query: "Should we always include a Phase 1 diagnostic?", relevant_doc_ids: ["p-phase1-lesson"] },
    { query_id: "pq-6", query: "Fixed price quote for safety analysis", relevant_doc_ids: ["p-rate-card", "p-nordic-proposal"] },
  ],
};

export const REGULATORY_CORPUS: BenchmarkCorpus = {
  domain: "regulatory",
  documents: [
    { doc_id: "r-unr155", collection: "regulatory", text: "UN Regulation 155 on cybersecurity management systems. Effective July 2024 for new vehicle types. Requires OEMs to demonstrate cybersecurity management throughout vehicle lifecycle. Compliance mandatory for EU type approval. Impacts all Tier-1 suppliers providing connected ECUs." },
    { doc_id: "r-iso21434", collection: "regulatory", text: "ISO/SAE 21434 Road vehicles Cybersecurity engineering. Published 2021, first amendment 2023. Defines cybersecurity lifecycle for automotive systems. Covers threat analysis, risk assessment, cybersecurity goals, verification, and validation. Referenced by UN R155 for compliance evidence." },
    { doc_id: "r-cra", collection: "regulatory", text: "EU Cyber Resilience Act. Applies to products with digital elements sold in EU market. Mandatory vulnerability handling, security updates for product lifetime. Effective 2027 for most products. Impacts embedded automotive components if sold separately." },
    { doc_id: "r-aspice-v4", collection: "regulatory", text: "ASPICE version 4.0 published Q1 2026. Key changes: merged SWE.1 and SWE.2 into single requirements/architecture practice. New explicit AI/ML process areas. Updated capability level criteria. Transition period: v3.1 assessments valid until 2028." },
    { doc_id: "r-sotif", collection: "regulatory", text: "ISO 21448 SOTIF Safety of the Intended Functionality. Addresses safety risks from functional insufficiencies in sensor-based systems, ADAS, and autonomous driving. Supplements ISO 26262 for scenarios where hazards arise from nominal behavior, not systematic or random faults." },
  ],
  queries: [
    { query_id: "rq-1", query: "Cybersecurity requirements for EU type approval", relevant_doc_ids: ["r-unr155"] },
    { query_id: "rq-2", query: "What changed in ASPICE v4?", relevant_doc_ids: ["r-aspice-v4"] },
    { query_id: "rq-3", query: "EU legislation affecting embedded automotive components", relevant_doc_ids: ["r-cra", "r-unr155"] },
    { query_id: "rq-4", query: "Safety standard for ADAS functional insufficiencies", relevant_doc_ids: ["r-sotif"] },
    { query_id: "rq-5", query: "ISO 21434 relationship to UN R155", relevant_doc_ids: ["r-iso21434", "r-unr155"] },
  ],
};

export const ALL_CORPORA: BenchmarkCorpus[] = [
  CONTRACT_CORPUS,
  EVIDENCE_CORPUS,
  PROPOSAL_CORPUS,
  REGULATORY_CORPUS,
];
