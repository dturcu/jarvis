# Agent Framework Architect — Red-team review

Scope: runtime.ts, memory.ts, entity-graph.ts, lesson-capture.ts, orchestrator.ts, orchestrated-execution.ts, agent-worker. Phase 0 seed findings are **partially disproven** — daemon uses `SqliteMemoryStore`, `SqliteEntityGraph`, `SqliteDecisionLog`, and lesson capture runs post-run. However, significant framework-level defects remain.

## Top findings

1. **[HIGH] No mutex on SQLite writes — concurrent orchestrated runs will race.**
   - Evidence: `packages/jarvis-agent-framework/src/sqlite-memory.ts:55-58` does `SELECT COUNT` then `DELETE ORDER BY LIMIT` in two statements, and `orchestrated-execution.ts:122-168` dispatches `maxConcurrent=2` `runAgent()` calls sharing the same connection.
   - Impact: Long-term memory pruning, entity upserts, and lesson writes can interleave, corrupting the 500-cap invariant and producing duplicate entities under parallel DAG execution.
   - Fix: Wrap the count+delete in `BEGIN IMMEDIATE` (as `sqlite-entity-graph.ts:39` already does) or serialize writes via an async queue keyed on DB path.

2. **[HIGH] `AgentRuntime.startRun` is stateless — no run registry, no concurrency guard.**
   - Evidence: `packages/jarvis-agent-framework/src/runtime.ts:35-87` — the class only holds `definitions` and `memory`; it does not track active runs. Nothing prevents two simultaneous runs for the same agent, and `listActiveRuns` does not exist.
   - Impact: The orchestrator's DAG dispatch cannot detect "agent already running"; `AgentWorkerError("AGENT_ALREADY_RUNNING")` (adapter.ts:23) is declared but never raised. No in-process visibility into live runs without querying SQLite.
   - Fix: Add an in-memory `Map<run_id, AgentRun>` with register/unregister on start/finalize and an `activeForAgent(id)` guard; expose in `runtime.listActiveRuns()`.

3. **[HIGH] Lesson capture has zero LLM synthesis — it only mirrors the decision log.**
   - Evidence: `packages/jarvis-agent-framework/src/lesson-capture.ts:75-143` — the docstring promises "in production the extraction would call inference.chat", but the implementation emits one string-concatenated doc per DecisionLog row, severity derived from a `.includes("fail")` check on the outcome string (line 114-116).
   - Impact: The knowledge store fills with low-signal noise (`"Step 3: inference.chat — Outcome: completed"`), drowning real lessons. `LessonInjector` then retrieves this noise back at plan time, forming a negative feedback loop.
   - Fix: Route through `registry.chat` with a summarization profile, gate by heuristic (only synthesize from failed/long/approved-mutating runs), and dedupe by action-hash.

4. **[HIGH] `runAgent` is a 750-line monolith with no pluggable lifecycle.**
   - Evidence: `packages/jarvis-runtime/src/orchestrator.ts:99-748` — one function interleaves planning, approval, execution, retry, cancellation, lesson capture, wiki publication, notification, and post-hoc review. No observer hooks, no step middleware, no strategy injection.
   - Impact: Untestable without spinning the whole daemon; cannot insert a tracer, cost tracker, or alternative retry policy without editing the function. Tests under `tests/agent-framework.test.ts` only exercise the trivial `AgentRuntime` wrapper, not `runAgent`.
   - Fix: Extract phases into a chain of `LifecycleStage` objects (plan → gate → execute → observe) with before/after hooks; make retry a `RetryPolicy` strategy instead of the inline `result.error.retryable` branch at line 559.

5. **[HIGH] Orchestrated DAG serializes recursion risk — orchestrator can dispatch orchestrator.**
   - Evidence: `packages/jarvis-runtime/src/orchestrated-execution.ts:61` filters out orchestrator from candidates, but `runAgent` (`orchestrator.ts:147`) only triggers DAG mode when `agentId === "orchestrator"`. A sub-goal with ambiguous wording that any child agent then re-routes via `isMultiAgentGoal` (`orchestrated-execution.ts:209-222`) has no guard. Line 218 matches on `"comprehensive"` — trivially user-supplied.
   - Impact: Infinite or exponential fan-out possible; there is no depth limit, budget, or parent-run trace passed to children.
   - Fix: Pass a `depth` counter through `runAgent` deps and abort when >2; require orchestrator to refuse when invoked as a child.

6. **[MEDIUM] Retry logic is a single inline branch — no backoff, no idempotency key, no jitter.**
   - Evidence: `packages/jarvis-runtime/src/orchestrator.ts:559-585` — the retry reuses the same envelope with `attempt: 2` (line 561) and fires immediately with no delay.
   - Impact: Transient 429/ECONNRESET against LM Studio will double-hammer the host; no dedup means a partially-completed mutating job can run twice.
   - Fix: Adopt the `createErrorPolicyHook` backoff formula already defined in `packages/jarvis-core/src/hooks.ts:278` (`1000 * 2^retry`) and add an idempotency header to envelopes.

7. **[MEDIUM] Concurrent agent runs share one `DatabaseSync` connection — synchronous SQLite blocks the event loop.**
   - Evidence: `packages/jarvis-runtime/src/daemon.ts:134` constructs a single `SqliteMemoryStore`; every `runAgent` call funnels through the same `node:sqlite` handle which is synchronous. `orchestrated-execution.ts:122` issues up to 2 parallel `runAgent`s.
   - Impact: Parallelism is illusory — CPU-bound SQL serializes; a long query (entity search) blocks all other agents, approval polling, and the HTTP API.
   - Fix: Use `better-sqlite3` worker_threads, or add a connection pool keyed per-agent and move the poll-based `waitForApproval` (`approval-bridge.ts:48-74`) to an event-driven SQLite `update_hook`/fs-watch.

8. **[MEDIUM] Cross-agent context has no sharing mechanism — each child re-builds from scratch.**
   - Evidence: `orchestrated-execution.ts:131-135` calls `runAgent(sg.agent_id, { kind: "manual", goal: sg.goal }, deps)` — the child gets no parent run_id, no sibling outputs, no shared memory key. `gatherContext` (`orchestrator.ts:827-879`) redundantly re-queries knowledge and entity graphs for every child.
   - Impact: Orchestrator cannot pass evidence-auditor's output to proposal-engine; the "merged_output" on line 181-183 is just concatenated summaries, not structured handoff.
   - Fix: Extend `AgentTrigger` with `parent_run_id` + `upstream_artifacts`, and have `gatherContext` include completed-sibling summaries from the DAG.

9. **[MEDIUM] `buildPlan` in the framework is a stub — the real planner lives in the runtime package.**
   - Evidence: `packages/jarvis-agent-framework/src/planner.ts:16-32` returns `{ steps: [] }`. The exported `buildPlan` is imported by tests (`tests/agent-framework.test.ts:348-366`) which assert it returns an empty array — tautological test of dead code.
   - Impact: Misleading API surface; new contributors will call `buildPlan` from `@jarvis/agent-framework` and get nothing. The real inference planner (`planner-real.ts`) is not exported from the framework package.
   - Fix: Delete the stub (or re-export the runtime planner behind a dep-injected `chat` callback) and rewrite the test to cover real behavior.

10. **[LOW] Entity graph provenance is silently swallowed when tables are absent.**
    - Evidence: `sqlite-entity-graph.ts:257-260` and `269-280` wrap provenance writes in empty `try/catch`. The comment says tables are created by `init-jarvis.ts`.
    - Impact: If bootstrap was skipped (fresh dev clone, test harness), entity writes succeed but provenance is lost without any log — auditability gap impossible to detect from the application side.
    - Fix: On construction, verify `entity_provenance` exists; if missing, throw or log a single startup warning rather than swallowing every insert.

## Positive notes

- **RunStore state machine is solid** — `packages/jarvis-runtime/src/run-store.ts:23-31` declares explicit `VALID_TRANSITIONS`, atomic `startRun` in `BEGIN IMMEDIATE` (line 62), and durable event audit. This is the framework's best piece.
- **JobGraph DAG primitives are correct and well-tested** — `packages/jarvis-runtime/src/job-graph.ts:136-160` does proper 3-color cycle detection; `tests/orchestrated-execution.test.ts:37-253` covers sequential, diamond, failure cascade, and parallel patterns.
- **Hook catalog is well-factored forward-looking design** — `packages/jarvis-core/src/hooks.ts:296-305` decouples approval, provenance, guardrails, and error policy from `runAgent`, giving a clean migration path once OpenClaw exposes `after_tool_call`/`before_reply` hook points.
