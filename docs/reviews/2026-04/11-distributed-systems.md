# Distributed Systems Engineer — Red-team review

## Top findings

1. **[Critical] Approval-gated `submitJob` drops the job on the floor.**
   - Evidence: `packages/jarvis-shared/src/state.ts:359-371` returns `awaiting_approval` + approval_id but never calls `writeJobRecord`; no reactor re-queues on approval.
   - Impact: every `required`-approval job (email.send, publish_post, trade_execute) is silently lost unless the caller re-submits.
   - Fix: persist envelope as `awaiting_approval`, promote to `queued` inside `resolveApproval('approved')`.

2. **[Critical] Approval `modified_input` is cosmetic.**
   - Evidence: `packages/jarvis-dashboard/src/api/approvals.ts:136-160` stringifies `modified_input` into `resolution_note` only; envelope untouched, no schema validation.
   - Impact: operator edits on high-stakes actions silently ignored; worker runs the original payload.
   - Fix: add `modifyJobInput(jobId, input)` running `validateJobInput` in the same tx as resolution.

3. **[High] Heartbeat↔reaper race resurrects expired claims.**
   - Evidence: `state.ts:675-726` and `state.ts:564-590` read-modify-write without `BEGIN IMMEDIATE`; lease math trusts client-supplied `heartbeat_at`.
   - Impact: a late heartbeat overwrites the reaper's reset; two workers can end up on the same attempt under clock skew.
   - Fix: wrap both in `BEGIN IMMEDIATE`; reject heartbeats when claim is null/expired; use server time only.

4. **[High] No automatic retry or attempt increment.**
   - Evidence: `requeueExpiredJobs` does not bump `envelope.attempt` (`state.ts:572-587`); `retry_policy.max_attempts` is never read (`state.ts:1185-1188`); `WORKER_CRASH`/`EXECUTION_TIMEOUT` are terminal (`worker-registry.ts:525-536`).
   - Impact: transient failures need manual `retryJob`; persistent failures loop forever after each lease expiry.
   - Fix: bump attempt on requeue, enforce `max_attempts`, transition to `dead_letter` on exhaustion.

5. **[High] No DLQ; queue-depth metric never updated.**
   - Evidence: `queueDepth` declared (`jarvis-observability/src/metrics.ts:42`) is never `.set()`; only `agent_commands` has stale logging (`daemon.ts:546-553`).
   - Impact: terminal failures indistinguishable from retryable; no backpressure signal.
   - Fix: add `dead_letter` status; emit `queueDepth` by `{status, priority}`.

6. **[High] Failed dispatches marked `retryable:true` but nothing retries.**
   - Evidence: `markDispatchFailed` stores the flag without a driver (`state.ts:841-865`); broadcast partial failures live only in the receipt (`jarvis-dispatch/src/index.ts:284-308`).
   - Impact: cross-session messages and completion notifications permanently lost on transient send failures.
   - Fix: dispatch-retry interval with backoff plus its own dead-letter state.

7. **[Medium] Idempotency lookup is O(N) and blocks legitimate retries.**
   - Evidence: `findJobByIdempotencyKey` deserialises every row (`state.ts:1148-1161`); Telegram generates a key per inbound message (`jarvis-telegram/src/session-adapter.ts:128`); terminal jobs still match.
   - Impact: submit latency grows with history; retries after failure return the old failed job.
   - Fix: promote `idempotency_key` to a `UNIQUE` column; scope dedup to non-terminal states.

8. **[Medium] Cancellation cannot interrupt a running job.**
   - Evidence: `cancelJob` flips status but supervisor never polls state and no `AbortSignal` reaches handlers (`state.ts:455-493`, `supervisor.ts:338-442`); the callback then hits `TERMINAL_STATES` (`state.ts:734`) and is dropped.
   - Impact: cancel is advisory — side effects (email sent, files written) still occur.
   - Fix: return `cancelled=true` in heartbeat response; plumb `AbortSignal` into handlers.

9. **[Medium] 1 MB callback cap creates re-execution loop on large outputs.**
   - Evidence: `readRequestBody` 413s >1 MB on `/callback` (`jarvis-jobs/src/index.ts:275-289`); callback never lands, lease expires, job reruns with the same payload.
   - Impact: document/office jobs with large `structured_output` loop until operator intervention.
   - Fix: stream large output to artifact store; configure the cap; on 413, fail terminally.

10. **[Medium] Scheduler store is in-memory only.**
    - Evidence: `SchedulerStore` uses `Map`s (`packages/jarvis-scheduler/src/store.ts:70-75`); `DbSchedulerStore` exists but is unwired; no leader election.
    - Impact: HA pairs fire every cron tick twice; a single restart loses every operator-created schedule.
    - Fix: swap to the DB-backed store behind an advisory-lock row per daemon.

## Positive notes

- **`claimJob` uses `BEGIN IMMEDIATE`** (`state.ts:592-672`) — serializable claim with safe rollback; two workers cannot both win.
- **Callback validates `claim_id` + `worker_id` + `attempt`** (`state.ts:738-755`) — zombie workers cannot overwrite the current claim's result.
- **Restart recovery is explicit** (`daemon.ts:90-99, 393-433`) — stuck runs fail deterministically; stale `agent_commands` claims release after 10 min.
