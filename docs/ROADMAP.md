# Jarvis Roadmap

Three-year plan organized as 12 quarterly PRs. Each quarter produces one long-lived branch, one user-facing PR, and the following artifacts:

- Integration checklist
- Replay suite
- Migration plan
- Rollback note
- Release note draft

Every quarter PR description contains five sections: problem statement, architectural changes, migration and rollback, operator-visible changes, and acceptance evidence.

## Milestone Index

| Quarter | Milestone | PR Title |
|---------|-----------|----------|
| Y1-Q1 | Kernel Unification | Unify channel ingress into the durable runtime kernel |
| Y1-Q2 | Execution Hardening | Harden execution boundaries and make production posture real |
| Y1-Q3 | Core Workflow Focus | Focus Jarvis around the five core workflows |
| Y1-Q4 | Appliance Reliability | Finish Year 1 as an appliance: setup, doctor, backup, restore, readiness |
| Y2-Q1 | Provenance Artifacts | Add source-grounded artifacts and provenance-first review |
| Y2-Q2 | Multi-Viewpoint Planning | Introduce multi-viewpoint planning for high-value workflows only |
| Y2-Q3 | Knowledge Loop | Turn the knowledge plane into a real operating memory system |
| Y2-Q4 | Small-Team Mode | Enable small-team operating mode without becoming multi-tenant |
| Y3-Q1 | Plugin Platform | Make the plugin system a real, enforceable platform |
| Y3-Q2 | Artifact Engine | Build the first-class artifact and deliverable engine |
| Y3-Q3 | Upgrade and Observability | Production lifecycle maturity: signed releases, upgrades, rollback, observability |
| Y3-Q4 | Appliance Polish | Finish the category-defining appliance pass |

## Label Set

| Label | Purpose |
|-------|---------|
| `quarter-pr` | Quarter-level PR (one per quarter) |
| `platform` | Core platform infrastructure |
| `secure-exec` | Security and execution boundary work |
| `channels` | Channel ingress and adapter work |
| `workflows` | Core workflow functionality |
| `quality` | Testing, replay suites, reliability |
| `migration` | Database migration and schema changes |
| `release-gate` | Release gate evidence and criteria |
| `operator-visible` | Changes visible to operator UX |

## Quarter PR Discipline

Each quarter PR is treated as a release train:

1. Feature freeze in the last 2-3 weeks
2. Replay/eval pass before merge
3. Migration notes written before approval
4. Rollback note mandatory
5. Docs updated inside the same PR

Branch naming: `quarter/y1-q1-kernel-unification`

---

## Year 1

### Q1: Kernel Unification

**PR title:** Unify channel ingress into the durable runtime kernel

**Why:** Jarvis has a strong runtime/control-plane architecture, but Telegram chat and Godmode still act like side-door execution surfaces with direct tool loops. This quarter removes that architectural split.

**Epics:**

- Add `channel_threads`, `channel_messages`, and `artifact_deliveries` persistence
- Refactor Telegram endpoint into ingress adapter only
- Refactor Godmode endpoint into ingress/orchestration viewer only
- Route all privileged tool use through command -> run -> job flow
- Normalize run creation across dashboard, Telegram, email, and webhook sources
- Add unified run timeline API for channel-linked execution
- Add migration scripts and doctor checks for new channel tables
- Add replay tests for same request across dashboard and Telegram

**Packages:** jarvis-runtime, jarvis-dashboard/src/api, jarvis-telegram, jarvis-shared, migrations, setup/doctor scripts

**Dependencies:** None (foundation quarter)

**Acceptance:**

- No direct privileged execution remains in Telegram chat route
- No direct privileged execution remains in Godmode route
- Every Telegram action that causes work creates a durable command/run trail
- Run history shows source channel and linked thread/message IDs
- One operator can see the same task lineage from message to artifact to approval

**Not included:** Worker isolation overhaul, full artifact system, team mode.

---

### Q2: Execution Hardening

**PR title:** Harden execution boundaries and make production posture real

**Why:** The docs define safe local production and risky worker isolation as explicit targets. This quarter makes those guarantees real instead of aspirational.

**Epics:**

- Move risky workers behind isolated child-process or host boundary
- Replace unrestricted file bridge behavior with scoped filesystem policies
- Introduce capability-scoped execution policies for browser/files/interpreter/device/social
- Remove insecure production fallbacks from auth posture
- Make approval objects mandatory for irreversible external actions
- Add worker crash-restart and hard timeout handling
- Add failure injection tests for worker crash, stale claim, browser hang, malformed command
- Add operator-visible health and isolation status in dashboard

**Packages:** jarvis-runtime, worker packages, worker registry, dashboard auth/health APIs, files bridge, support/repair/daemon status

**Dependencies:** Q1

**Acceptance:**

- Risky actions cannot bypass policy/approval
- Worker crash does not kill daemon
- Filesystem access is scope-limited
- Auth posture clearly distinguishes dev from appliance mode
- 24h soak and injected-failure subset pass

---

### Q3: Core Workflow Focus

**PR title:** Focus Jarvis around the five core workflows

**Why:** The repo has broad agent coverage, but the defensible product center is proposal, contract, evidence, BD, and staffing. This quarter makes the product shape reflect that reality.

**Epics:**

- Declare product-core packs: proposal, contract, evidence, BD, staffing
- Mark non-core agents as experimental/personal packs in metadata and UI
- Redesign default home/workflows/inbox around core five only
- Add workflow-specific artifact previews and run summaries
- Add workflow start forms with correct required inputs
- Add maturity enforcement in registry and scheduler
- Add golden replay cases for all five workflows
- Rewrite docs/usage/onboarding around the core stack

**Packages:** jarvis-agents, jarvis-dashboard, runtime registry/scheduler/policy, docs/usage

**Dependencies:** Q1, Q2

**Acceptance:**

- Default operator journey centers on core five workflows
- Non-core packs do not clutter the main dashboard path
- Each core workflow has one start path, one run summary, one recovery path
- Docs and UI tell the same story

---

### Q4: Appliance Reliability

**PR title:** Finish Year 1 as an appliance: setup, doctor, backup, restore, readiness

**Why:** Jarvis becomes credible when install, repair, and recovery feel boring. The repo already has good seeds here. This quarter turns them into an appliance-grade experience.

**Epics:**

- Make setup wizard fully initialize the appliance end to end
- Expand doctor into operator-grade diagnostics with actionable fixes
- Validate backup artifacts and restore end to end
- Add rollback-on-failed-restore hardening everywhere needed
- Expose real readiness based on daemon, DB, migrations, model runtime, and channel health
- Add clean-machine smoke suite
- Add release-note template, migration notes, and rollback notes
- Finalize Gate B / most of Gate C evidence

**Packages:** scripts, jarvis-runtime, dashboard health/repair/support APIs, docs/runbooks

**Dependencies:** Q1-Q3

**Acceptance:**

- Clean install succeeds
- Doctor explains failures clearly
- Backup/restore works on tested scenario set
- Readiness reflects actual runtime state
- Fresh operator can install and run core workflows

---

## Year 2

### Q5: Provenance Artifacts

**PR title:** Add source-grounded artifacts and provenance-first review

**Why:** This is the beginning of the moat. Outputs must be inspectable and grounded in source material. The knowledge plane and workflow specs already imply this direction.

**Epics:**

- Add artifact provenance schema
- Link proposal sections to RFQ excerpts, case studies, and assumptions
- Link contract findings to clause extraction and precedent
- Link evidence gaps to concrete work products/documents
- Add dashboard artifact review mode with source inspection
- Add Telegram artifact summary/approval cards
- Add provenance-aware replay tests

**Dependencies:** Stable core workflows from Year 1

**Acceptance:**

- Every core artifact section can answer "source?"
- Operator can inspect support before approval
- Artifacts preserve provenance through delivery

---

### Q6: Multi-Viewpoint Planning

**PR title:** Introduce multi-viewpoint planning for high-value workflows only

**Why:** The release gates call for planner/critic/verifier/arbiter behavior and disagreement blocking. This is where that becomes real, but only for expensive workflows.

**Epics:**

- Add planner/critic/verifier/arbiter orchestration framework
- Implement disagreement scoring and escalation rules
- Apply multi-viewpoint mode to proposal, contract, evidence only
- Expose model-routing and planner-choice explanations in UI
- Add disagreement replay cases and operator review UX

**Dependencies:** Q5

**Acceptance:**

- Severe disagreement blocks silent execution
- Operator sees why views diverged
- Logs and dashboard explain planner/model decisions

---

### Q7: Knowledge Loop

**PR title:** Turn the knowledge plane into a real operating memory system

**Why:** Entity graph, lessons, decisions, proposals, contracts, and CRM history need to become a reusable advantage, not just stored data.

**Epics:**

- Strengthen entity graph around company/contact/project/proposal/contract/evidence entities
- Add provenance-aware lesson capture from completed runs
- Add decision-to-entity linking
- Improve deduplication and canonicalization
- Add knowledge views and traversal UX
- Add contamination and hallucinated-link tests

**Dependencies:** Q5, Q6

**Acceptance:**

- Operator can move through related proposals, contracts, contacts, and decisions
- Lessons are traceable to source runs
- Memory retrieval supports core workflows without becoming opaque

---

### Q8: Small-Team Mode

**PR title:** Enable small-team operating mode without becoming multi-tenant

**Why:** The production target is one operator or a small trusted team. This quarter makes that mode real while preserving the local appliance model.

**Epics:**

- Strengthen RBAC across dashboard, Telegram, approvals, and settings
- Add delegated approvals and shared operator inboxes
- Add ownership and assignee fields for runs/approvals
- Add handoff notes and review queue UX
- Add team-visible audit and activity timelines
- Add role-based replay and security tests

**Dependencies:** Q5-Q7

**Acceptance:**

- Multiple trusted users can operate one Jarvis node coherently
- Audit trail remains precise
- No multi-tenant abstractions leak into the architecture

---

## Year 3

### Q9: Plugin Platform

**PR title:** Make the plugin system a real, enforceable platform

**Why:** The repo already has manifest validation and install logic. This quarter makes runtime enforcement, compatibility, and signed packs real.

**Epics:**

- Signed manifest support
- Compatibility/version gating
- Runtime enforcement of declared permissions
- Plugin health and lifecycle state
- Install/uninstall/upgrade rollback hardening
- Malicious or over-privileged plugin tests

**Dependencies:** Year 1-2 complete

**Acceptance:**

- Invalid or over-privileged packs are rejected
- Installed packs cannot exceed declared capabilities
- Plugin lifecycle is observable and recoverable

---

### Q10: Artifact Engine

**PR title:** Build the first-class artifact and deliverable engine

**Why:** Important outputs should be managed as formal artifacts with states, not loose generated text. Jarvis already has office/document infrastructure and report generation paths.

**Epics:**

- Formal artifact lifecycle: draft, review, approved, delivered, superseded
- Support proposal packs, review packets, compliance reports, decision memos
- Artifact comparison and supersession logic
- Artifact-linked channel deliveries
- Artifact retention/export rules
- Review and signoff UX across dashboard and Telegram

**Dependencies:** Q9

**Acceptance:**

- All core deliverables use first-class artifact state
- Channel deliveries point to exact artifact versions
- Operator can compare versions before delivery

---

### Q11: Upgrade and Observability

**PR title:** Production lifecycle maturity: signed releases, upgrades, rollback, observability

**Why:** The appliance needs a reliable lifecycle, not just runtime features. This quarter makes release and upgrade behavior trustworthy.

**Epics:**

- Signed release metadata
- Tested upgrade path with migration preview
- Backup-before-upgrade enforcement
- Rollback support and operator guidance
- Richer per-worker/per-model/per-channel observability
- Support bundle improvements
- Upgrade-from-prior-version test matrix

**Dependencies:** Q9, Q10

**Acceptance:**

- Upgrades are testable and reversible
- Operator can understand health quickly
- Releases ship with migration and rollback notes

---

### Q12: Appliance Polish

**PR title:** Finish the category-defining appliance pass

**Why:** Final integration and polish quarter. No new major surfaces. No new broad packs. Only consistency, trust, speed, and operability.

**Epics:**

- Remove remaining developer-tool leakage from operator flows
- Tighten approval ergonomics and failure explanations
- Final performance pass on core workflows
- Final install-to-daily-use documentation and runbooks
- Final replay/eval benchmark refresh
- Final production-readiness checklist and operator drills

**Dependencies:** Q9-Q11

**Acceptance:**

- Trusted team can install, reach via Telegram/email, operate daily, recover from failure, and explain major outputs/actions after the fact
- Product experience feels cohesive, not like a repo of subsystems
