## LinkedIn Content Pillar Queue

Five content pillars with rotating topic ideas. The Content Engine agent selects from this queue, tracking which topics have been used recently to ensure coverage across all pillars. Each pillar maps to one or more publishing days (Mon/Wed/Thu).

---

## Pillar 1: Release Gates & Delivery Discipline

**Maps to:** Monday (leadership), Wednesday (company), Thursday (technical)

### Topic Ideas

**1.1 Gate criteria that actually work**
Angle: Most gate criteria are written by process people who've never shipped a safety release. Real gate criteria are binary, evidence-backed, and uncomfortable. Walk through what a TIC gate checklist looks like: safety case status, open ASIL-D anomalies at zero, timing analysis complete with margins documented, MPU configuration verified on target. If any item is yellow, the gate doesn't pass. No "conditional approvals."

**1.2 Why most gate reviews are theater**
Angle: The gate review meeting where 15 people sit in a room, nobody has read the evidence package, the project manager asks "any concerns?", silence, gate passed. This happens on 80% of programs. Compare to what a real gate review looks like: evidence reviewed 48 hours before the meeting, each reviewer signs off on their domain, open items tracked with owners and deadlines, gate blocked until closure. The meeting itself should be 15 minutes if the prep was done right.

**1.3 The 3 documents that predict delivery success**
Angle: You can predict whether a safety program will deliver on time by looking at three documents in week 2: the DIA (Development Interface Agreement), the safety plan's verification strategy section, and the project schedule's dependency map. If any of these are vague, incomplete, or copy-pasted from the last program, you're already behind. Explain why each one matters and what "good" looks like.

**1.4 "Done" vs "deliverable"**
Angle: Engineers say "it's done" when the code compiles and tests pass. A deliverable is done when the evidence package is complete, the traceability is verified, the safety case references it, and it survives an independent review. The gap between "done" and "deliverable" is where programs die. This is especially true for ASIL-C and ASIL-D work where the evidence burden is non-trivial.

**1.5 Why TIC prices by deliverable, not by hour**
Angle: Staff augmentation incentivizes hours. Workstream ownership incentivizes delivery. When TIC quotes a workstream, the price is tied to gate-ready deliverables, not to how many hours the team logged. This changes behavior: engineers focus on closing evidence gaps instead of filling timesheets. Explain the mechanics without revealing specific rates.

---

## Pillar 2: Timing Analysis & MPU Closure

**Maps to:** Thursday (technical), Wednesday (company wins)

### Topic Ideas

**2.1 Real-world timing budgets nobody talks about**
Angle: Timing budgets on paper look clean. Then you add interrupt latency, OS overhead, cache effects, and multicore interference. The gap between theoretical WCET and measured worst-case is often 40-60%. Walk through a realistic timing budget for an ASIL-D task on a multicore ECU, including the margins that standards actually require (ISO 26262 Part 6, Clause 7.4.15 for timing analysis).

**2.2 Why MPU analysis gets deferred until it's too late**
Angle: MPU configuration is the task that every program schedules for "later." Then "later" arrives 3 weeks before SOP and nobody has verified memory protection regions, stack sizes are guesses, and the first integration test crashes with a memory protection fault. Explain why early MPU analysis saves programs and what "early" actually means (hint: before the first integration build, not after).

**2.3 Scheduling analysis tools and their honest limits**
Angle: Tools like Timing Architects arti-T, TA Tool Suite, and AbsInt aiT are powerful but not magic. They require accurate models, calibrated measurement data, and someone who understands what the results actually mean. Walk through the gap between "the tool says it's schedulable" and "it's actually schedulable on target hardware." Reference the AUTOSAR Timing Extensions specification and where it falls short.

**2.4 The AUTOSAR Timing Extensions gap**
Angle: AUTOSAR defines timing extensions (TimEx) for modeling execution time, communication latency, and synchronization. In practice, most projects don't use them correctly because the toolchain support is inconsistent and the specification leaves too much to implementation. Explain the gap between the standard's intent and the tooling reality, and what TIC does to bridge it.

**2.5 Multicore timing interference and freedom from interference**
Angle: ISO 26262 requires freedom from interference between software components of different ASIL levels. On multicore ECUs, this means proving that a QM task on Core 1 can't cause an ASIL-D task on Core 2 to miss its deadline. This is harder than it sounds. Shared caches, shared buses, shared memory controllers. Walk through the analysis approach without oversimplifying.

---

## Pillar 3: Evidence Debt & ASPICE Gaps

**Maps to:** Thursday (technical), Wednesday (company patterns)

### Topic Ideas

**3.1 SWE.1 as the silent killer**
Angle: Everyone focuses on SWE.4 (unit verification) and SWE.5 (integration testing). Nobody talks about SWE.1 (software requirements analysis) because it's boring. But weak SWE.1 means your requirements are ambiguous, untestable, and disconnected from the safety concept. Every downstream problem traces back to SWE.1. Explain what good SWE.1 practice looks like and why assessors flag it first.

**3.2 Traceability theater vs real traceability**
Angle: Having links in DOORS or Polarion doesn't mean you have traceability. Real traceability means: every safety requirement traces to a software requirement, every software requirement traces to a design element and a test case, every test case traces to a test result, and the whole chain is consistent and current. Most teams have partial traceability with broken links and orphaned items. The assessment day reveal is brutal.

**3.3 What assessors actually look for**
Angle: After supporting multiple ASPICE assessments, the pattern is clear. Assessors don't care about your process descriptions. They care about evidence of consistent execution. They pick 3 random work products, trace the chain, and see if it holds. The teams that pass are the ones who do the work as they go, not the ones who backfill evidence the month before the assessment.

**3.4 The cost of retroactive evidence**
Angle: Retroactive evidence creation costs 3-5x more than doing it right the first time. You're reverse-engineering decisions that were made months ago, reconstructing review records from memory, and creating traceability links for requirements that have already changed twice. Put a number on it: a single retroactive ASIL-D software safety analysis (Part 6, Clause 7) typically takes 3-4 weeks when it should have taken 1.

**3.5 The gap between ASPICE Level 2 and Level 3**
Angle: Level 2 means "managed" at the project level. Level 3 means "established" at the organization level. The jump from 2 to 3 is where most companies stall because it requires process standardization across projects, not just one team doing it right. Explain what this looks like in practice and why many Tier-1s are stuck at Level 2 for years.

---

## Pillar 4: Cybersecurity x Safety Overlap

**Maps to:** Thursday (technical), Monday (leadership/strategy)

### Topic Ideas

**4.1 UN R155/R156 meets ISO 26262**
Angle: UN R155 (cybersecurity management system) and R156 (software update management) are now type-approval requirements. They overlap with ISO 26262 in uncomfortable ways: threat analysis (TARA) and hazard analysis (HARA) use different risk models, different severity scales, different likelihood assessments. Most OEMs run these as separate workstreams. They shouldn't. Explain where the integration points are and why siloed teams create gaps.

**4.2 TARA in the safety context**
Angle: ISO 21434 defines Threat Analysis and Risk Assessment (TARA). ISO 26262 defines Hazard Analysis and Risk Assessment (HARA). When a cybersecurity attack can cause a safety-relevant failure, these analyses must talk to each other. Walk through a concrete example: an attacker spoofs a CAN message that feeds into a safety-relevant actuator. How do TARA and HARA connect for this scenario?

**4.3 Cybersecurity in OTA updates**
Angle: Over-the-air software updates are now standard. UN R156 requires a software update management system. But what happens when an OTA update modifies a safety-relevant software component? You need to re-verify the safety case, re-validate the integration, and ensure the update doesn't violate freedom from interference. Most OTA frameworks don't account for this. Explain the gap and what a compliant OTA process looks like for safety-critical ECUs.

**4.4 The staffing gap in cyber-safety dual roles**
Angle: The market needs engineers who understand both ISO 26262 and ISO 21434. These people barely exist. Most safety engineers don't understand threat modeling. Most cybersecurity engineers don't understand ASIL decomposition. The overlap role (someone who can do TARA-HARA integration, review security-relevant safety requirements, assess cybersecurity impact on functional safety) is the hardest role to fill in automotive right now. This is a business opportunity and a risk.

**4.5 The SecOC implementation gap**
Angle: AUTOSAR Secure Onboard Communication (SecOC) is supposed to protect safety-relevant CAN/Ethernet messages from spoofing and replay attacks. In practice, most implementations are incomplete: MAC truncation is too aggressive, freshness value management is fragile, and key management is an afterthought. Walk through what a robust SecOC implementation requires and where most projects cut corners.

---

## Pillar 5: Workstream Ownership vs Staff Augmentation

**Maps to:** Monday (leadership), Wednesday (company model)

### Topic Ideas

**5.1 Why staff augmentation fails for safety-critical work**
Angle: You can't rent an ASIL-D deliverable. Staff augmentation puts a body in a seat and hopes they absorb enough context to be useful. But safety-critical work requires end-to-end ownership: from requirements through verification, with evidence integrity maintained throughout. A contractor who leaves after 6 months takes institutional knowledge with them and leaves evidence gaps. Workstream ownership means TIC is accountable for the deliverable, not just the hours.

**5.2 The "your deliverable, not your hours" model**
Angle: When TIC takes a workstream, the client gets a gate-ready deliverable with complete evidence. They don't get a timesheet. This changes the incentive structure completely. TIC's engineers are motivated to find efficient paths to closure, not to maximize billable hours. Explain how this works commercially without revealing pricing details. Reference how this model handles scope changes (they trigger requoting, not silent overruns).

**5.3 Building accountability in consulting engagements**
Angle: The hardest part of consulting isn't the technical work. It's accountability. When you own a workstream, you own the schedule, the quality, and the gate readiness. If the gate slips, it's your problem. Most consulting firms avoid this by selling T&M and shifting risk to the client. TIC embraces it because accountability is how you build repeat business.

**5.4 When to use staff augmentation (it's not never)**
Angle: Staff aug has legitimate uses: short-term capacity for well-defined tasks, backfilling a known role during a leave, or adding a specific specialist skill for a bounded period. The problem is when companies use staff aug as their default model for safety-critical delivery. Know the difference: if the deliverable requires sustained context and evidence continuity, it's a workstream, not a seat.

**5.5 How to evaluate a consulting partner for safety-critical work**
Angle: When a Tier-1 is evaluating consulting partners, the questions that matter are not "how many engineers do you have?" or "what's your rate?" The questions are: "Show me a safety case you delivered." "Walk me through how you handle evidence gaps discovered late." "What happens when your engineer finds a design error during verification, who owns the fix?" Frame this as advice for the buyer, positioning TIC's model as the answer without being salesy.

---

## Queue Management

The Content Engine agent tracks:
- Last used date for each topic
- Which pillar has the fewest posts in the last 30 days (prioritize underserved pillars)
- Seasonal relevance (e.g., ASPICE assessments cluster in Q1 and Q3, R155 enforcement deadlines)
- Topics Daniel has flagged as high priority or has asked to skip
- Topics that generated high engagement on previous posts (reuse the angle, not the content)

Rotation rule: never post from the same pillar in consecutive weeks unless Daniel explicitly requests it.
