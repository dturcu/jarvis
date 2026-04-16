# Compliance/Regulatory Analyst — Red-team review

Scope: approval/audit surface, provenance chain, decision log, retention, GDPR/AI Act posture. Context: Jarvis will produce work-products that feed client safety cases (ISO 26262/ASPICE/21434) and publish regulatory intelligence. From an assessor's view the core question is: given any artifact that leaves Jarvis, can we prove who produced it, from what input, via which model, with what human authorization, and has that chain been tamper-evident since? The architecture has the right primitives (signed provenance chain, audit_log, decisions table) but gaps in identity, coverage, and retention would not survive an external audit.

## Top findings

1. **[high] Approver identity is not traceable to a natural person — segregation of duties unprovable**
   - Evidence: `packages/jarvis-dashboard/src/api/approvals.ts:100,120,146` always passes the literal string `'dashboard'` to `resolveApproval`; `middleware/audit.ts:64-68` only records `role:token_prefix` (4 hex chars); there is no user table, no name/email, and a shared admin token is common (`auth.ts:36-38`).
   - Impact: An ISO 26262 assessor, ASPICE SUP.10, or GDPR Art. 30 reviewer cannot attribute an approval to an accountable individual. 4-eyes / segregation-of-duties control is absent — the same operator can propose and approve; there is no second-approver field anywhere in `approvals` schema (`0001_runtime_core.ts:15-28`).
   - Fix: Replace `'dashboard'` with authenticated user identity; add `proposed_by`/`approved_by`/`second_approver` columns and enforce `proposed_by != approved_by` for `severity='critical'` actions.

2. **[high] audit_log and decisions tables are mutable — no append-only enforcement, no hash chain**
   - Evidence: `0001_runtime_core.ts:99-108` creates `audit_log` as a plain table with no `AFTER UPDATE/DELETE` triggers and no hash column; `knowledge_0001_core.ts:59-67` same for `decisions`. Anyone with filesystem access to `~/.jarvis/runtime.db` can `UPDATE audit_log SET actor_id=…` undetectably. Only `provenance_traces` has HMAC signing (`0009_provenance.ts`).
   - Impact: Audit trail fails the "tamper-evident" test required by ISO 27001 A.8.15, AI Act Art. 12 logging obligations, and any FDA/MDR-style audit. The SQLite file is a single-writer-trust artifact.
   - Fix: Add `INSTEAD OF UPDATE/DELETE RAISE(ABORT)` triggers on `audit_log` and `decisions`; add `prev_hash`/`hash` columns so the chain can be replayed like `provenance_traces`.

3. **[high] Provenance signing key is dev-default in non-production, breaking chain-of-custody**
   - Evidence: `worker-registry.ts:92` — `signingKey = JARVIS_SIGNING_KEY ?? (mode === "production" ? undefined : "jarvis-dev-signing-key-not-for-production")`. `.env.example` does not even mention `JARVIS_SIGNING_KEY`. There is no key-rotation ledger, no KMS integration, and the key can be supplied per-request via HTTP body (`api/provenance.ts:57,63`).
   - Impact: Any artifact produced in dev mode bears a signature everyone on the internet can forge. Mixed prod/dev artifacts make the chain unverifiable. Assessor cannot bind an output to a specific key-custody period.
   - Fix: Hard-fail startup outside production if no key; forbid `signing_key` in request body; add a `signing_keys` registry table with `key_id`, `activated_at`, `retired_at` and stamp `key_id` on each provenance record.

4. **[high] No model/version captured in provenance or decision log — ISO 26262 tool-qualification gap**
   - Evidence: `ProvenanceRecord` (`observability/src/provenance.ts:5-24`) has `input_hash`/`output_hash` but no `model_id`, `model_version`, `runtime`, `prompt_hash`, or `tool_version`. `DecisionLog` (`memory.ts:22-31`) has no model field. `enrichApprovals` and `Decisions.tsx` never display a model.
   - Impact: An ISO 26262 clause 11 tool-qualification assessor asking "which model produced this FMEA draft?" gets no answer. AI Act Art. 13 transparency ("which AI system, which version") is unmet. Re-running with a different model yields different outputs with no way to distinguish.
   - Fix: Add `model_id`, `model_version`, `prompt_version`, `runtime_build` to both `provenance_traces` and `decisions`; populate at every inference call site.

5. **[medium] Provenance coverage is partial and silently best-effort**
   - Evidence: `worker-registry.ts:114` — `storeProvenance` wraps the INSERT in `try { … } catch { /* best-effort */ }`; signing is skipped entirely when key absent (line 93). Chat, orchestrator decisions, regulatory-watch ingestion, and `approvals.ts` writes bypass the signer altogether. No coverage-gate metric.
   - Impact: Assessor samples N artifacts, finds a percentage with no signed chain; cannot distinguish "Jarvis misconfigured" from "tamper". Safety case accepts evidence only if coverage is demonstrably 100% for a declared scope.
   - Fix: Make `requireSignedProvenance` a policy flag that refuses job completion without a stored record; add `/api/provenance/coverage` returning `(signed_jobs / total_jobs)` per day.

6. **[medium] No retention policy, no deletion log, no legal-hold — GDPR Art. 5(1)(e) and 17 exposed**
   - Evidence: Grep confirms zero references to `retention`, `purge`, `erasure`, or `legal_hold` across packages. `audit_log`, `decisions`, `agent_memory`, `embedding_chunks`, and `crm` tables grow forever; no tombstone/soft-delete pattern; entity_provenance (`knowledge_0001_core.ts:72-81`) tracks entity changes but has no "deleted" event emitter. Meeting transcripts ingested by knowledge-curator inherit no consent/basis-of-processing flag.
   - Impact: GDPR data-subject-access-request (Art. 15) and erasure (Art. 17) cannot be fulfilled in bounded time; no proof of deletion when client contract ends; no record that a source was removed under legal hold. Clients with EU PII on file cannot use Jarvis under DPA.
   - Fix: Add `retention_class`, `delete_after` columns; add a `deletion_log` table recording `{subject_id, reason, operator, deleted_at, hash_of_deleted}`; implement a scheduled purger that writes a proof-of-erasure signed record.

7. **[medium] No data-classification / PII flag on ingested content; regulatory source provenance incomplete**
   - Evidence: `documents` (`knowledge_0001_core.ts:13-23`) has no `sensitivity`, `classification`, `lawful_basis`, `source_url`, `source_hash`, or `fetched_at`. `regulatory-watch-system.md` says to store findings but prescribes no source-hash/fetch-time capture. `hooks.ts:212-217` only redacts keys/CC in replies, not at ingest.
   - Impact: A regulatory update claimed to be from ISO cannot be cryptographically bound to a URL+timestamp — an assessor will reject such a finding. Client-confidential material cannot be segregated by label. Export-control / ITAR material cannot be blocked from outbound channels.
   - Fix: Add `classification`, `source_url`, `source_sha256`, `fetched_at`, `http_etag` on `documents` and require them for collection `regulatory`; add pre-ingest classifier hook.

8. **[medium] No auditor-grade export; token rotation not audited**
   - Evidence: No `audit` router in `api/`; `history.ts` shows a timeline but there is no signed-bundle export endpoint (CSV/JSON/PDF with the HMAC chain and verification manifest). Security-engineer review (13-security-engineer.md:5) already flagged `/api/auth/rotate` missing `writeAuditLog`; role/token creation has no dedicated audit events either.
   - Impact: Responding to a third-party audit means hand-crafting a dump. Configuration-change audit (Art. 12(3) AI Act) and token lifecycle events are missing from the record.
   - Fix: Add `GET /api/audit/export?from=&to=` returning a signed tarball (records + chain manifest + public-verification doc); emit `auth.token_rotated`, `auth.token_created`, `settings.updated`, `approval_rule.changed` audit events.

9. **[medium] Approval bypass on timeout maps to "rejected" silently; approval rules not versioned**
   - Evidence: `approval-bridge.ts:66-73` — `waitForApproval` returns `"rejected"` for `expired`/`cancelled`; the distinction is lost to the caller. Approval-rule definitions live in code (`hooks.ts:106-111`, `@jarvis/shared` catalog) with no schema migration and no audit entry when a rule is changed.
   - Impact: An assessor asking "was this action rejected by a human or just timed out?" gets the wrong answer. Silent policy drift: a commit moving `email.send` out of the critical set is invisible in audit.
   - Fix: Preserve `expired` as its own status end-to-end; add `approval_rules` table with `rule_id`, `version`, `activated_at`, stored JSON and an audit event on change.

10. **[low] AI Act risk classification absent — regulated-use posture undeclared**
    - Evidence: No `risk_class` / `high_risk_system` declaration in any manifest. Agents that affect safety-case output (evidence-auditor, contract-reviewer) carry `high_stakes` maturity (`CLAUDE.md`) but no AI-Act mapping. `03-accessibility` and `16-pm-automotive-domain` reviews already flagged missing AI Act scan.
    - Impact: When EU AI Act Art. 6/Annex III applies (Jarvis influencing safety deliverables), provider obligations (risk mgmt, data governance, logging, transparency, human oversight) need documented traceability. Currently none exists in-repo.
    - Fix: Publish `docs/AI-ACT-POSTURE.md`; tag each agent definition with `ai_act.risk_class` and `human_oversight` descriptor; surface in dashboard.

## Positive notes

- `ProvenanceSigner` (`observability/src/provenance.ts`) implements HMAC-SHA256 with canonical serialization, prev-signature chaining, sequence-gap detection, and timing-safe verification — this is the right building block; the gap is coverage and key-lifecycle, not cryptography.
- `resolveApproval` (`approval-bridge.ts:86-122`) wraps status change + audit_log insert in `BEGIN IMMEDIATE`/`COMMIT` — atomic pairing is the correct pattern; extend the same discipline to all state mutations.
- Role-based route permission matrix (`middleware/auth.ts:90-135`) with `admin`/`operator`/`viewer` hierarchy and localhost-only default bind is a strong baseline; the compliance work is additive to a sound security foundation.
