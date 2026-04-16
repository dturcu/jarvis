# Prompt Engineer — Red-team review

## Top findings (7)

1. **[critical] Prompts are not wired to any LLM call**
   - Evidence: `packages/jarvis-agent-framework/src/planner.ts:24-32` — `buildPlan` accepts `system_prompt` and `context` but returns `{ steps: [] }` with the args unused. `runtime.ts` never reads `definition.system_prompt`; there is no `messages: [{role:"system", content:...}]` anywhere in `agent-framework`.
   - Impact: Every carefully-written agent prompt is dead code — agents run only through their plugin tool schemas, not the authored system prompts, so none of the safety rails, approval language, or retrieval guidance actually constrains inference.
   - Recommended fix: Compose `system_prompt + lessons_context + memory_context + goal` into a real model call inside a `planner.execute()` implementation before adding new prompt text.

2. **[high] Two divergent prompt copies — `.md` files are orphaned stubs**
   - Evidence: `packages/jarvis-agents/src/prompts/orchestrator-system.md` (17 lines, "Always show plan before executing") vs `packages/jarvis-agents/src/definitions/orchestrator.ts:3-49` (46-line `ORCHESTRATOR_SYSTEM_PROMPT` with DECISION LOOP, NEVER, APPROVAL GATES sections). Only the `.ts` constant is referenced (`grep` for `.md` loading returns zero hits; `system_prompt: ORCHESTRATOR_SYSTEM_PROMPT` at line 68).
   - Impact: Human reviewers reading the `.md` files believe rules that the code no longer honors; drift will worsen the longer both exist.
   - Recommended fix: Delete `src/prompts/*.md` or replace with a one-line pointer to the canonical `.ts` constant.

3. **[high] Memory store has no injection path into prompts**
   - Evidence: `packages/jarvis-agent-framework/src/memory.ts:79-84` — `getContext()` returns short_term/long_term entries, but no caller in `runtime.ts` or `planner.ts` consumes it, and no prompt references `<memory>` / `{context}` placeholders. Similarly `getEntities()` and `getDecisions()` are orphan getters.
   - Impact: The "durable agent memory" claim in CLAUDE.md is fiction at runtime — past decisions, entity graph, and short-term scratchpad never reach the model, so each run is effectively zero-shot and repeats prior mistakes.
   - Recommended fix: Have the planner build a `<context>` block (recent decisions + top-k long-term + entity summary) and prepend it; define a 2-4k token budget per section with truncation.

4. **[high] Zero tool-use prompting and zero few-shot examples**
   - Evidence: Every prompt lists capabilities in `DECISION LOOP` (e.g., proposal-engine step 3 "Query 'proposals' and 'case-studies' knowledge") but never names the actual tool (`knowledge.search`? `crm.query`?), argument schema, or expected return shape. No `<example>` block exists in any of the 8 prompts.
   - Impact: Smaller models (Haiku tier) will hallucinate tool names or emit prose instead of tool calls; larger models waste tokens guessing the interface.
   - Recommended fix: Add a `## Tools` section per prompt listing exact tool names/signatures from `contracts/jarvis/v1/`, plus one worked `<example>` showing input → tool call → output per agent.

5. **[medium] Output format claims "JSON" without a schema**
   - Evidence: `self-reflection.ts:15-17` says `review_report: JSON document ... with fields: health_score (0-100), proposals[] (min 5), agent_metrics{}, approval_metrics{}, knowledge_metrics{}` — no JSON schema, no "respond with ONLY a JSON object" directive, no fence conventions. Orchestrator's `execution_plan: JSON DAG with nodes (agent_id, input, expected_output, depends_on)` has the same gap.
   - Impact: Downstream `validate its output against expected shape` (orchestrator:12) will fail unpredictably; consumers cannot write a stable parser.
   - Recommended fix: Reference an existing `contracts/jarvis/v1/*.json` schema by URI and add "Respond with a single JSON object matching this schema. No prose, no markdown fences."

6. **[medium] Responsibility overlap between knowledge-curator and regulatory-watch**
   - Evidence: regulatory-watch step 5 (`regulatory-watch.ts:11`) writes to `"regulatory"` collection directly; knowledge-curator owns that same collection (`knowledge-curator-system.md:6`, `knowledge-curator.ts:76`) and claims duplicate-check + metadata authority. Neither prompt mentions the other.
   - Impact: Two agents write to the same collection with different dedup rules — curator's `similarity > 0.85 = flag` never runs on regulatory's inserts; cross-agent invariants silently break.
   - Recommended fix: Regulatory-watch emits findings to an event/queue; knowledge-curator is the only writer to `"regulatory"`. Document the boundary in both prompts.

7. **[medium] Orchestrator prompt lacks the reasoning scaffold its task demands**
   - Evidence: `orchestrator.ts:6-13` is an imperative 7-step recipe ("Decompose into a DAG", "Dispatch agents in topological order") with no `<thinking>` / "before producing the DAG, list candidate decompositions and pick one with rationale" scaffold. `task_profile.objective: "plan"` at line 66 but no chain-of-thought template.
   - Impact: The highest-stakes agent in the system (`maturity: high_stakes_manual_gate`) will collapse complex goals into the first plausible DAG without alternatives — exactly the failure mode explicit CoT is known to prevent.
   - Recommended fix: Add a mandated pre-plan block: "Before emitting `execution_plan`, output `<analysis>` with: (a) goal restatement, (b) 2-3 candidate decompositions, (c) chosen decomposition with tradeoff rationale, (d) confidence 0-1."

## Positive notes (3)

- Consistent section taxonomy (`DECISION LOOP` / `REQUIRED ARTIFACTS` / `NEVER` / `APPROVAL GATES` / `RETRIEVAL` / `RUN-COMPLETION` / `FAILURE` / `ESCALATION`) across all 8 `.ts` prompts makes prompt-level auditing tractable and diff-friendly.
- Strong explicit-negation discipline in `NEVER` blocks (e.g., `proposal-engine.ts:32-37` "NEVER Quote T&M for safety-critical delivery" / "Downplay risks to make the quote look cleaner") — this is the right pattern for high-stakes refusal behavior.
- Numeric thresholds are concrete and testable (staffing: `<70%`/`>95%`; contract: `risk score > 70`; self-reflection: `health_score < 40`) — enables regression eval harnesses without prompt-parsing heuristics.
