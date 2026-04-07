# Y2-Q2 Multi-Viewpoint Planning — Release Notes

## Summary

Multi-viewpoint disagreement handling is now severity-aware. The orchestrator classifies disagreements as minor/moderate/severe and responds accordingly: minor logs and proceeds, moderate flags for review and proceeds, severe blocks execution and escalates to operator.

## What Changed

### DisagreementPolicy
- New `DisagreementPolicy` type with configurable thresholds and severity response
- Three presets: DEFAULT (severe blocks), MODERATE (flags for review), MINOR (log only)
- `classifyDisagreement()` maps detection results to severity levels
- Substantial disagreement (both action and step heuristics) always escalates as severe

### Orchestrator
- Emits `disagreement_classified` event with severity, reason, planner metadata
- Severe: blocks execution, requests approval (existing behavior, now explicit)
- Moderate: proceeds but sends review notification via Telegram
- Minor: logs and proceeds silently

### Backward Compatible
No database migration. Existing multi-viewpoint behavior is preserved under DEFAULT policy.

## Rollback
Revert code. Disagreement handling reverts to pre-severity behavior (all disagreements block).
