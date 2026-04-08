# ISO 26262 Part 6 Required Work Products Checklist

Reference checklist for the Evidence Auditor agent. Maps all required work products from ISO 26262-6:2018 by sub-clause, with ASIL applicability, structural coverage requirements, and review formality.

**Legend:**
- **R** = Required
- **HR** = Highly Recommended
- **Rec** = Recommended
- **--** = Not applicable at this level
- Review formality: **1a** = informal (walkthrough), **1b** = semi-formal (inspection), **1c** = formal (formal inspection with independence)

---

## 6-5: Initiation of Product Development at the Software Level

### 6-5.1: Software Safety Plan

| Work Product | ASIL-A | ASIL-B | ASIL-C | ASIL-D | Notes |
|---|---|---|---|---|---|
| Software safety plan | R | R | R | R | Must reference system-level safety plan; defines methods, tools, environments, and process tailoring |
| Software development environment description | R | R | R | R | Compiler, linker, IDE, AUTOSAR tooling, target hardware |
| Tool qualification plan (per Part 8, Clause 11) | HR | R | R | R | Required for TCL2/TCL3 tools at ASIL-B and above |
| Software configuration management plan | R | R | R | R | Branching strategy, baseline management, release process |

**Review formality:**
- ASIL-A/B: 1a (informal walkthrough)
- ASIL-C: 1b (semi-formal inspection)
- ASIL-D: 1c (formal inspection with independence)

---

## 6-7: Specification of Software Safety Requirements

### 6-7.1: Software Requirements Specification (SWRS)

| Work Product | ASIL-A | ASIL-B | ASIL-C | ASIL-D | Notes |
|---|---|---|---|---|---|
| Software safety requirements specification | R | R | R | R | Derived from TSR; each requirement must have unique ID, ASIL, verification method |
| Software requirements traceability (TSR to SWRS) | R | R | R | R | Bidirectional traceability required |
| Verification of software safety requirements | R | R | R | R | Review against criteria in Table 3 |

**Verification methods per ASIL (Table 2):**

| Method | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Informal notation | R | R | HR | HR |
| Semi-formal notation | HR | HR | R | R |
| Formal notation | -- | -- | HR | HR |

**Requirements properties to verify (Table 3):**
- Unambiguous, comprehensible, atomic, internally consistent, feasible, verifiable
- No unresolved TBDs at gate review
- Each requirement allocated to exactly one ASIL level (or ASIL decomposition documented)

**Review formality:**
- ASIL-A: 1a
- ASIL-B: 1b
- ASIL-C: 1b
- ASIL-D: 1c

---

## 6-8: Software Architectural Design

### 6-8.1: Software Architectural Design Specification (SWAD)

| Work Product | ASIL-A | ASIL-B | ASIL-C | ASIL-D | Notes |
|---|---|---|---|---|---|
| Software architectural design specification | R | R | R | R | Static and dynamic views; component interfaces |
| Traceability (SWRS to architectural components) | R | R | R | R | Every requirement maps to at least one component |
| Safety analysis of software architecture | HR | R | R | R | Dependent failure analysis, freedom from interference analysis |
| Verification of software architectural design | R | R | R | R | Review against criteria in Table 5 |

**Notation methods (Table 4):**

| Method | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Informal notation | R | R | HR | HR |
| Semi-formal notation | HR | HR | R | R |
| Formal notation | -- | -- | HR | HR |

**Architectural design principles (Table 5):**

| Principle | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Hierarchical structure | HR | R | R | R |
| Restricted size and complexity of components | HR | R | R | R |
| Restricted size of interfaces | HR | HR | R | R |
| Strong cohesion within components | -- | HR | R | R |
| Loose coupling between components | HR | HR | R | R |
| Appropriate scheduling properties | HR | HR | R | R |
| Restricted use of interrupts | HR | HR | R | R |
| Appropriate spatial isolation (freedom from interference) | -- | HR | R | R |
| Appropriate temporal isolation (freedom from interference) | -- | HR | R | R |

**Review formality:**
- ASIL-A: 1a
- ASIL-B: 1b
- ASIL-C: 1b
- ASIL-D: 1c

---

## 6-9: Software Unit Design and Implementation

### 6-9.1: Software Unit Design (SWUD) and Source Code

| Work Product | ASIL-A | ASIL-B | ASIL-C | ASIL-D | Notes |
|---|---|---|---|---|---|
| Software unit design specification | HR | R | R | R | Detailed design for each unit; data structures, algorithms, interfaces |
| Source code | R | R | R | R | Implementation of units |
| Traceability (SWAD to SWUD to source code) | R | R | R | R | Architecture element to unit to file/function |
| Verification of software unit design and implementation | R | R | R | R | Review against coding guidelines and design principles |

**Design principles for unit design (Table 6):**

| Principle | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| One entry and one exit point per function | HR | R | R | R |
| No dynamic objects or variables | HR | HR | R | R |
| No unconditional jumps | R | R | R | R |
| No implicit type conversions | HR | HR | R | R |
| No hidden data flow or control flow | HR | HR | R | R |
| No recursion | HR | R | R | R |
| No global variables (or controlled access) | HR | HR | R | R |
| Limited pointer usage | HR | HR | R | R |

**Coding guidelines (Table 7):**

| Guideline | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Enforcement of low complexity | HR | R | R | R |
| Use of language subsets (MISRA C, CERT C) | R | R | R | R |
| Enforcement of strong typing | HR | R | R | R |
| Use of defensive programming | HR | HR | R | R |
| Use of established design patterns | HR | HR | R | R |
| Use of naming conventions | R | R | R | R |
| No uninitialized variables | R | R | R | R |

**Review formality:**
- ASIL-A: 1a
- ASIL-B: 1b
- ASIL-C: 1b (with partial independence)
- ASIL-D: 1c (with independence)

---

## 6-10: Software Unit Testing

### 6-10.1: Software Unit Test Specification and Results

| Work Product | ASIL-A | ASIL-B | ASIL-C | ASIL-D | Notes |
|---|---|---|---|---|---|
| Software unit test specification | R | R | R | R | Test cases, expected results, pass/fail criteria |
| Software unit test results | R | R | R | R | Executed test results with traceability to requirements |
| Structural coverage measurement results | HR | R | R | R | Tool-generated reports |

**Test methods (Table 8):**

| Method | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Requirements-based testing | R | R | R | R |
| Interface testing | HR | R | R | R |
| Fault injection testing | -- | HR | HR | R |
| Resource usage evaluation | HR | HR | R | R |
| Back-to-back comparison testing | -- | HR | HR | R |

**Structural coverage requirements (Table 9) -- CRITICAL:**

| Coverage Metric | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Statement coverage (C0) | R | R | R | R |
| Branch coverage (C1) | HR | R | R | R |
| MC/DC (Modified Condition/Decision Coverage) | -- | HR | HR | R |

**If coverage target is not met:**
- Provide a rationale for why it cannot be achieved
- Document the uncovered code paths and justify they are dead code or defensive code
- At ASIL-D, MC/DC shortfall requires formal justification and approval

**Review formality:**
- ASIL-A: 1a
- ASIL-B: 1a
- ASIL-C: 1b
- ASIL-D: 1b (with independence)

---

## 6-11: Software Integration and Integration Testing

### 6-11.1: Software Integration Test Specification and Results

| Work Product | ASIL-A | ASIL-B | ASIL-C | ASIL-D | Notes |
|---|---|---|---|---|---|
| Software integration test specification | R | R | R | R | Tests for inter-component interfaces and data flow |
| Software integration test results | R | R | R | R | Executed results with traceability |
| Software integration verification report | R | R | R | R | Summary of integration status |

**Test methods (Table 10):**

| Method | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Requirements-based testing | R | R | R | R |
| Interface testing | R | R | R | R |
| Fault injection testing | -- | HR | HR | R |
| Resource usage testing | HR | HR | R | R |

**Structural coverage at integration level (Table 11):**

| Coverage Metric | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Function coverage | R | R | R | R |
| Call coverage | HR | R | R | R |

**Review formality:**
- ASIL-A: 1a
- ASIL-B: 1a
- ASIL-C: 1b
- ASIL-D: 1b (with independence)

---

## 6-12: Verification of Software Safety Requirements

### 6-12.1: Software Safety Validation

| Work Product | ASIL-A | ASIL-B | ASIL-C | ASIL-D | Notes |
|---|---|---|---|---|---|
| Software safety validation plan | HR | R | R | R | Defines validation scope, methods, acceptance criteria |
| Software safety validation results | HR | R | R | R | Evidence that software meets TSR at the software boundary |
| Software verification report (summary) | R | R | R | R | Consolidated evidence package for gate review |

**Validation methods:**

| Method | ASIL-A | ASIL-B | ASIL-C | ASIL-D |
|---|---|---|---|---|
| Requirements-based testing at software level | R | R | R | R |
| Simulation in target environment | HR | HR | R | R |
| Testing on target hardware | HR | R | R | R |
| Fault injection at software boundaries | -- | HR | HR | R |

**Review formality:**
- ASIL-A: 1a
- ASIL-B: 1b
- ASIL-C: 1b
- ASIL-D: 1c (with independence)

---

## Cross-Cutting Work Products (All Clauses)

These work products span multiple clauses and must be present regardless of specific phase:

| Work Product | ASIL-A | ASIL-B | ASIL-C | ASIL-D | Clause Reference |
|---|---|---|---|---|---|
| Development Interface Agreement (DIA) | R | R | R | R | Part 8, Clause 5 (referenced by Part 6) |
| Configuration management records | R | R | R | R | Part 8, Clause 7 |
| Change management records | R | R | R | R | Part 8, Clause 8 |
| Tool qualification report (per tool) | HR | R | R | R | Part 8, Clause 11 |
| Software release note | R | R | R | R | Part 6, Clause 5 |
| Safety case (software contribution) | R | R | R | R | Part 4, Clause 8 |

---

## Auditor Quick-Reference: Minimum Gate Package by ASIL

### ASIL-A Minimum Gate Package
- Software safety plan
- SWRS with traceability to TSR
- SWAD (informal notation acceptable)
- Source code with coding guidelines compliance evidence
- Unit test results with statement coverage
- Integration test results with function coverage
- Software verification report
- Configuration management records

### ASIL-B Minimum Gate Package
Everything in ASIL-A, plus:
- Formal tool qualification for TCL2+ tools
- Semi-formal notation for SWRS and SWAD
- Software unit design specification
- Branch coverage evidence at unit level
- Call coverage at integration level
- Software safety validation results
- Safety analysis of software architecture
- DIA (if distributed development)

### ASIL-C Minimum Gate Package
Everything in ASIL-B, plus:
- Semi-formal inspection records for SWRS, SWAD, SWUD
- Branch coverage required (MC/DC highly recommended)
- Fault injection test evidence (highly recommended)
- Freedom from interference analysis (spatial and temporal)
- Resource usage evaluation
- Partial independence in unit design review

### ASIL-D Minimum Gate Package
Everything in ASIL-C, plus:
- MC/DC coverage required at unit level
- Fault injection testing required at unit and integration level
- Formal inspection with independence for SWRS, SWAD, SWUD
- Back-to-back comparison testing (highly recommended)
- Independent verification of software safety validation
- Complete traceability chain with zero orphan requirements
- All tools at TCL2+ formally qualified with qualification report
