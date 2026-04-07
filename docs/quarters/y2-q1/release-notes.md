# Y2-Q1 Provenance Artifacts — Release Notes

## Summary

Artifacts produced by agent runs now carry provenance metadata: which agent, which run, which step, and which source materials (RFQ excerpts, clauses, case studies, documents, work products) contributed to each output. This is the foundation for inspectable, source-grounded deliverables.

## What Changed

### ArtifactProvenance Type
- Extended `ArtifactRecord` with optional `provenance` field
- `ArtifactProvenance`: `source_agent_id`, `source_run_id`, `step_no`, `action`, `source_refs[]`, `assumptions[]`
- `ArtifactSourceRef`: `ref_type` (rfq_excerpt, clause, case_study, document, precedent, work_product), `label`, `location`, `excerpt`

### Orchestrator
- Run step completion automatically attaches provenance to artifacts produced by each step
- Provenance includes agent ID, run ID, step number, and action

### Backward Compatible
- `provenance` is optional on `ArtifactRecord` — existing artifacts continue to work
- No database migration required

## Rollback
Revert code. Provenance fields are optional; removing them has no data impact.
