# PM -- Automotive-Safety Domain -- Red-team review

Reviewer lens: 10+ yr senior PM, Tier-1/OEM safety consulting (ISO 26262, 21434, ASPICE, AUTOSAR).
Scope: 8 active agents, CRM, dashboard, data/. Assessing product-market fit and day-of-operator utility for "Thinking in Code".

## Top findings

1. **[critical] No HARA/TARA/FMEA authoring or review support -- the core of functional safety work is missing**
   - Evidence: `packages/jarvis-agents/src/prompts/evidence-system.md` only audits whether a "Software Safety Analysis" artifact exists; no agent performs or scaffolds HARA, FMEDA, FTA, DFA, TARA. Legacy prompts (`legacy/prompts/content-pillars.md`) reference TARA/HARA integration as TIC's differentiator -- then the active roster discards it.
   - Impact: A safety consultant spends 40-60% of delivery hours in HARA/TARA/FMEA workshops. Jarvis assists with none of it. A client asking "help me review this HARA" gets zero leverage.
   - Fix: Add a `safety-analysis` agent (HARA scaffold from item definition, TARA asset/threat enumeration, FMEA template pre-fill) as a `high_stakes_manual_gate` workflow.

2. **[critical] No client status-report / weekly update agent -- the single most recurrent consultant deliverable is absent**
   - Evidence: No "status", "weekly update", "progress report" agent in `definitions/`. `self-reflection` is internal-only ("NEVER auto-apply"); `staffing-monitor` is internal ("Never send staffing data externally").
   - Impact: Every active engagement expects a weekly/bi-weekly status update (progress vs. plan, risks, blockers, next-step asks). Daniel will write them by hand. This is the #1 missed automation win.
   - Fix: Add `engagement-status-reporter` agent: reads CRM engagement + time entries + meeting minutes + gap-matrix delta, produces client-ready DOCX/email draft with approval gate.

3. **[high] Proposal-engine is over-confident on pricing, under-specified on discovery**
   - Evidence: `definitions/proposal-engine.ts` lines 6-10 jump from "Ingest RFQ" to "Build quote" with no discovery-call scaffolding, no pricing-band calibration by ASIL mix or integration depth, no "questions to ask before we quote" artifact. Rate guidance is a flat EUR band with no geography/scarcity modifier (Timing/MPU is called "resource-constrained" in staffing-system yet not priced higher).
   - Impact: Real automotive proposals come from 1-3 discovery calls. Quoting from an RFQ alone produces proposals that lose on scope or lose margin on unpriced risk.
   - Fix: Require a `discovery_questions` artifact pre-quote; add pricing-band multiplier by skill scarcity (surface from staffing-monitor) and ASIL mix.

4. **[high] Contract-reviewer misses the 3 clauses that actually kill automotive deals**
   - Evidence: `definitions/contract-reviewer.ts` baseline covers IP/liability/confidentiality well but omits (a) safety indemnity / product-liability pass-through, (b) audit-rights clauses (OEM's right to audit supplier processes -- ASPICE-relevant), (c) DIA obligations and change-management-on-safety-artifact clauses, (d) export-control/ECCN, (e) insurance minima (professional indemnity EUR 1-5M typical).
   - Impact: These are the clauses in-house counsel pushes back hardest on. A "SIGN" verdict that missed a safety indemnity is a malpractice-grade miss.
   - Fix: Expand baseline categories to 12-13, add an "automotive-specific" red-flag set, require counsel-review escalation when safety-indemnity or audit-rights clauses are non-standard.

5. **[high] Regulatory-watch has scope gaps on the regulation wave that matters 2026-2028**
   - Evidence: `prompts/regulatory-watch-system.md` lists ISO 26262/21434/ASPICE/R155/R156/8800/SOTIF/CRA. Missing: EU AI Act (Annex III automotive AI), EU Data Act (in-vehicle data), ISO 8608/PAS 5112, Radio Equipment Directive (RED 2022/30/EU cybersecurity), China GB/T 44464/44495, US NHTSA cybersecurity best practices, UNECE WP.29 GRVA OTA amendments.
   - Impact: Client asks "what does AI Act mean for our ADAS pipeline?" -- agent has nothing to retrieve.
   - Fix: Add AI Act, Data Act, RED, NHTSA, and China regs to scan list; tag findings with affected product domain.

6. **[high] Evidence-auditor's gap matrix isn't against the right artifact templates**
   - Evidence: `definitions/evidence-auditor.ts` hard-codes a generic ISO 26262 Part 6 work-product list. No mention of Part 4 (system), Part 5 (HW), Part 9 (ASIL decomposition rationale). ASPICE coverage is "SWE.1-SWE.6" -- missing SYS.1-SYS.5, SUP.8-SUP.10, MAN.3, ACQ.4. Output format doesn't match what a Functional Safety Manager signs off (no "evidence path", no reviewer, no approval date column).
   - Impact: FSM-graded engagements produce audit evidence in ISO/IEC 15504-assessor-compatible format. Current matrix wouldn't pass an ASPICE Level 2 assessment.
   - Fix: Extend to full ISO 26262 Parts 3-9 and ASPICE v3.1 full process set; match output columns to standard assessment template (path, reviewer, approval, ASIL).

7. **[medium] Staffing-monitor treats consulting as headcount, not billable-hours / margin**
   - Evidence: `staffing-system.md` tracks utilization % but no billable-vs-non-billable split, no project-margin reporting, no day-rate-vs-engagement-rate gap, no "bench days" cost accumulator, no skill tags at Part-level (ISO 26262 Part 2 vs Part 3 vs Part 6) -- cluster granularity is too coarse.
   - Impact: A consulting firm lives or dies on utilization * realised-rate. "85% util, 40% billable" is a disaster the current monitor wouldn't flag.
   - Fix: Add billable_pct, realised_rate, margin_pct per engineer; refine skill taxonomy to standard-part granularity.

8. **[medium] No orchestrator example that exercises a realistic multi-agent hand-off**
   - Evidence: `orchestrator-system.md` is 18 lines, no workflow templates, no example DAGs. The roster lists 7 agents but no canonical chain like "regulatory update -> evidence-auditor rescan of affected engagements -> proposal-engine amendment for clients at risk -> contract-reviewer check for scope-change clauses".
   - Impact: Orchestrator is the pitch-deck hero but ships as a bare shell. Without seeded workflows, the 80% case (cross-agent reactive chains) never fires.
   - Fix: Seed 5-8 canonical DAGs as playbook documents; wire `regulatory-watch` CRITICAL findings to auto-emit orchestrator-run proposals.

9. **[medium] `data/` garden/planting legacy is cleaned up, but prompt content-pillars and legacy remain in tree and pollute retrieval**
   - Evidence: `packages/jarvis-agents/src/data/` contains only `.gitkeep` (verified). Garden/planting prompts exist only under `src/legacy/` (archived) -- correctly separated. However, `legacy/prompts/` is still compiled into the tree and could be retrieved by a RAG pipeline if the filter is ever wrong.
   - Impact: Minor -- embarrassing if a prompt leaks "tomato planting schedule" into a client-facing response.
   - Fix: Exclude `legacy/**` from retrieval indices and embedding pipelines explicitly; add a boundary test.

10. **[low] Portal vs Dashboard distinction is unclear and under-developed**
    - Evidence: `Portal.tsx` is token-gated, shows client status + documents + milestones (client-facing). `Home.tsx` is operator dashboard. But there is no NDA/portal gating on document visibility, no client-facing approval ("approve this proposal") surface, no audit log of what the client saw.
    - Impact: Promising differentiator ("client portal") is 30% built. Risks leaking internal notes if misconfigured.
    - Fix: Harden portal with per-client doc scoping, viewed/signed audit trail, signed-doc ingestion path.

## Positive notes

- **Workstream ownership + Phase 1 diagnostic framing** (`proposal-system.md`) is the correct consulting-firm anti-body-shop positioning. This alone is 2 years of PM learning baked in.
- **Regulatory-knowledge integration across agents** is genuinely differentiated: contract-reviewer, evidence-auditor, and proposal-engine all query the `regulatory` collection. When fleshed out, this is the moat.
- **Maturity taxonomy** (`high_stakes_manual_gate`, `trusted_with_review`) with per-agent approval gates is exactly what a safety-domain operator needs to build trust incrementally -- and matches ISO 26262's rigor-by-risk ethos.
