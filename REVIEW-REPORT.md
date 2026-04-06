# Jarvis Codebase Review Report

**Date:** 2026-04-06
**Scope:** Full codebase (100K+ lines, 45 packages, 29+ test files)
**Reviewers:** 8 parallel analysis agents with fresh eyes

---

## PART 1: BUGS (100)

### Critical (P0) -- Data Loss / Security / Crashes

| # | Location | Bug |
|---|----------|-----|
| 1 | `packages/jarvis-system-worker/src/node-system.ts:549` | **Command injection** -- `execSync(\`taskkill /PID ${input.pid}\`)` interpolates user input directly into shell command. Attacker can inject `; rm -rf /` via pid field. |
| 2 | `packages/jarvis-browser-worker/src/chrome-adapter.ts:151` | **Code injection** -- `new Function(input.script)` executes arbitrary code with no sandboxing, validation, or length limit. |
| 3 | `packages/jarvis-browser/src/index.ts:168-223` | **Context closure bug** -- `browser_extract`, `browser_capture`, `browser_download` tools close over outer `ctx` instead of using per-call `_toolCtx`. Jobs get attributed to wrong session. |
| 4 | `packages/jarvis-agent-framework/src/approval-store.ts` | **Race condition** -- File-based approval store uses read-modify-write without locking. Concurrent writes silently overwrite each other, losing approvals. |
| 5 | `packages/jarvis-telegram/src/relay.ts:11-34` | **Race condition** -- Telegram queue uses file-based read-modify-write with no lock. Concurrent push+process can corrupt JSON. |
| 6 | `packages/jarvis-agent-framework/src/agent-queue.ts` | **Unhandled floating promise** -- Agent queue processes jobs with fire-and-forget `Promise` that silently swallows rejections, can crash the daemon. |
| 7 | `packages/jarvis-agent-framework/src/approval-store.ts` | **Approval ID collision** -- UUIDs truncated to 8 hex chars (4 bytes entropy). In concurrent multi-agent operation, collisions cause wrong approval matched. |
| 8 | `packages/jarvis-dashboard/src/api/godmode.ts:538-586` | **Double tool execution** -- Tool calls are extracted and executed, then the same response is parsed again and tools executed a second time. |
| 9 | `packages/jarvis-dashboard/src/api/entities.ts` | **Column name mismatch** -- API uses `type` but schema defines `entity_type`; uses `source_id` but schema defines `from_entity_id`. All queries silently return empty results. |
| 10 | `packages/jarvis-dashboard/src/api/crm.ts` | **Notes insert missing ID** -- INSERT into notes table omits required `id` column. Insert fails or creates NULL primary key. |

### High (P1) -- Incorrect Behavior / Data Corruption

| # | Location | Bug |
|---|----------|-----|
| 11 | `packages/jarvis-agent-framework/src/sqlite-decision-log.ts` | **Missing table creation** -- `SQLiteDecisionLog` assumes table exists but never runs CREATE TABLE. First write crashes with "no such table". |
| 12 | `packages/jarvis-crm-plugin/src/index.ts:231-257` | **Raw args passthrough** -- Every CRM command case passes entire `args` object (including `operation` field) via `as any` to submit functions. Extraneous fields pollute job inputs. |
| 13 | `packages/jarvis-agent-framework/src/knowledge-store.ts` | **FTS5 injection** -- User-supplied search terms interpolated directly into FTS5 MATCH clause. Special chars (`*`, `OR`, `NEAR`) alter query semantics. |
| 14 | `packages/jarvis-agent-framework/src/knowledge-store.ts` | **SQL LIKE injection** -- Pattern parameter passed to LIKE without escaping `%` and `_` wildcards. |
| 15 | `packages/jarvis-core/src/files-bridge.ts` | **Path traversal** -- No validation that resolved file paths stay within allowed directories. `../../etc/passwd` would be served. |
| 16 | `packages/jarvis-email-plugin/src/index.ts:244-252` | **No send validation** -- `email_send` command handler performs zero validation. Can submit email with no `to`, no `subject`, no `body`, no `draft_id`. |
| 17 | `packages/jarvis-document-plugin/src/index.ts:88-97` | **No input source** -- `document_extract_clauses` accepts neither `file_path` nor `text` without error. Job submitted with no document content. |
| 18 | `packages/jarvis-document-plugin/src/index.ts:105-118` | **No input source** -- `document_analyze_compliance` same issue. Both input sources optional, no at-least-one check. |
| 19 | `packages/jarvis-scheduler/src/evaluator.ts:134` | **Float equality** -- `evaluateThreshold` uses `===` for `eq` operator on floating-point metrics. `90.0000001 !== 90` causes false negatives. |
| 20 | `packages/jarvis-inference/src/runtime.ts:7-46` | **No HTTPS support** -- `httpRequest` uses `http.request` exclusively. HTTPS URLs fail silently or produce confusing errors. |
| 21 | `packages/jarvis-inference/src/runtime.ts:37-39` | **Incomplete timeout** -- Timeout destroys request but not response stream. Partially-streamed data accumulates after timeout fires. |
| 22 | `packages/jarvis-inference/src/streaming.ts:93-118` | **Duplicate done event** -- SSE parser pushes `{type:"done"}` on `data: [DONE]` AND on stream `end`. Consumer sees phantom extra event. |
| 23 | `packages/jarvis-telegram/src/commands.ts:92` | **Short-ID prefix match** -- `/approve` uses `startsWith(shortId)` with no minimum length. User typing 1 char matches wrong approval. |
| 24 | `scripts/validate-contracts.mjs:321` | **20 job types skip validation** -- `skipSchemaTypes` set silently excludes 20 job types from all schema validation. Contract violations go undetected. |
| 25 | `contracts/jarvis/v1/browser-job-types.schema.json` | **5 browser types have no schema** -- `navigate`, `click`, `type`, `evaluate`, `wait_for` exist in catalog/examples but have zero schema definitions. |
| 26 | `contracts/jarvis/v1/` | **15 social/time/drive types have no schema** -- All `social.*`, `time.*`, `drive.*` job types have catalog entries and examples but no schema files at all. |
| 27 | `package.json` | **Missing `concurrently` dep** -- `dashboard:dev` script uses `concurrently` but it's not in devDependencies. Fresh install fails. |
| 28 | `package.json` | **Missing `tsx` dep** -- 6+ scripts use `tsx` but it's not in devDependencies. All scripts fail on fresh install without global tsx. |
| 29 | `scripts/setup-jarvis.ts:17` | **Missing `googleapis` dep** -- Imports `googleapis` but package not in any dependencies list. |
| 30 | `tsconfig.base.json` | **Missing `@jarvis/runtime` path** -- vitest.config.ts has alias but tsconfig.base.json lacks it. Build and test resolve differently. |

### Medium (P2) -- Edge Cases / Partial Failures

| # | Location | Bug |
|---|----------|-----|
| 31 | `packages/jarvis-system-worker/src/node-system.ts:549,560` | **Silent kill failure** -- `execSync(taskkill)` wrapped in `{stdio:"ignore"}` with no error handling. Reports success even when process kill fails. |
| 32 | `packages/jarvis-system-worker/src/node-system.ts:124-125` | **Division by zero** -- `parseDiskWindows` doesn't guard `totalBytes === 0` before computing `percent_used`. |
| 33 | `packages/jarvis-system-worker/src/node-system.ts:454-455` | **Unsafe array access** -- `interfaces[0]!.name` accessed without checking array emptiness after filter. |
| 34 | `packages/jarvis-system-worker/src/node-system.ts:279-288` | **Unsafe type casting** -- GPU info parsing casts `entry["AdapterRAM"]` without type validation. |
| 35 | `packages/jarvis-browser-worker/src/chrome-adapter.ts:170-200` | **waitFor returns success on failure** -- Element not found returns `{found: false}` as success instead of error. |
| 36 | `packages/jarvis-browser-worker/src/chrome-adapter.ts:118-121` | **Incomplete clear** -- `clear_first` uses triple-click + backspace but doesn't verify text was actually cleared before typing. |
| 37 | `packages/jarvis-telegram/src/commands.ts:35-53` | **DB handle leak** -- `getStatus` and `getCrmTop5` never close DatabaseSync on error. No try/finally. |
| 38 | `packages/jarvis-telegram/src/commands.ts:36` | **Ignores config constants** -- Manually constructs DB path instead of using imported `KNOWLEDGE_DB` and `CRM_DB` constants. |
| 39 | `packages/jarvis-telegram/src/bot.ts:91-99` | **Concurrent file access** -- `Promise.all([pollOnce(), checkApprovals()])` reads/writes same approvals file concurrently. |
| 40 | `packages/jarvis-telegram/src/relay.ts` | **Unbounded queue growth** -- Marks entries `sent: true` but never removes them. Queue JSON grows forever. |
| 41 | `packages/jarvis-agent-plugin/src/index.ts:300-314` | **agents command rejects list-all** -- `/agents` without agentId returns error instead of listing all agents. |
| 42 | `packages/jarvis-dashboard/src/api/godmode.ts:256-258` | **Symlink path traversal** -- `resolve(PROJECT_ROOT, filePath)` checked against PROJECT_ROOT but symlinks can bypass. Needs `realpath`. |
| 43 | `packages/jarvis-dashboard/src/api/settings.ts:17-18` | **Weak masking bypass** -- `value.startsWith('****')` check means user can input `****` prefix to bypass secret masking. |
| 44 | `packages/jarvis-dashboard/src/api/chat.ts:247-268` | **No HTTP timeout** -- `llmChat` non-streaming request has no timeout. Unresponsive LMS server hangs forever. |
| 45 | `packages/jarvis-dashboard/src/api/chat.ts:191` | **Silent JSON parse failure** -- Malformed JSON from LLM output silently skipped in catch block with no logging. |
| 46 | `packages/jarvis-dashboard/src/ui/pages/CrmPipeline.tsx:69` | **Silent stage move failure** -- `handleMoveStage` has `.catch(() => {})` -- silently fails with no user feedback. |
| 47 | `packages/jarvis-dashboard/src/ui/pages/CrmPipeline.tsx:82` | **Silent contact add failure** -- `handleAddContact` same issue -- no error feedback to user. |
| 48 | `packages/jarvis-dashboard/src/api/portal.ts:60` | **Unsafe double cast** -- `req as unknown as Record<string,unknown>` attaches portal client via unsafe runtime mutation. |
| 49 | `packages/jarvis-dashboard/src/api/webhooks.ts:52` | **Timing leak** -- Signature length check before `timingSafeEqual` leaks length information. |
| 50 | `packages/jarvis-dashboard/src/ui/pages/Decisions.tsx:59-75` | **Stale closure risk** -- `currentFilterRef` modified in useEffect but ref not tracked properly in dependency arrays. |
| 51 | `contracts/jarvis/v1/document-job-types.schema.json:216-233` | **No required fields** -- `document_extract_clauses_input` has no `required` array. Empty `{}` passes validation. |
| 52 | `contracts/jarvis/v1/document-job-types.schema.json:265-290` | **No source requirement** -- `document_analyze_compliance_input` requires only `framework`, not document content. |
| 53 | `contracts/jarvis/v1/scheduler-job-types.schema.json:71-84` | **No timing requirement** -- `scheduler_create_schedule_input` requires neither `cron_expression` nor `interval_seconds`. Schedule with no timing passes validation. |
| 54 | `contracts/jarvis/v1/device-job-types.schema.json:1053-1063` | **Empty switch input** -- `device_virtual_desktop_switch_input` has no required fields. Empty `{}` is valid but useless. |
| 55 | `tests/agent-definitions.test.ts:198-202` | **Test validates wrong behavior** -- Content engine test asserts `approval_gates === []` but CLAUDE.md requires `publish_post` to always need critical approval. |
| 56 | `packages/jarvis-agent-framework/src/agent-queue.ts` | **No timeout enforcement** -- Workers can run indefinitely with no timeout. A hung worker blocks the entire queue. |
| 57 | `packages/jarvis-agent-framework/src/runs-store.ts` | **Memory leak** -- Runs map grows unboundedly. Completed runs are never evicted. Long-running daemon OOMs. |
| 58 | `packages/jarvis-agent-framework/src/decision-log.ts` | **Memory leak** -- Decisions map same issue. No eviction policy. |
| 59 | `packages/jarvis-core/src/config.ts` | **No config validation** -- Config loaded from JSON with no schema validation. Missing or wrong-typed fields cause cryptic runtime errors. |
| 60 | `packages/jarvis-shared/src/seed-data.ts` | **Duplicate UUIDs** -- Seed data contains duplicate UUID values across entities. |

### Low (P3) -- Cosmetic / Minor

| # | Location | Bug |
|---|----------|-----|
| 61 | `packages/jarvis-agent-framework/src/planner.ts` | **Retry doesn't back off** -- Planner retry logic retries immediately with no exponential backoff. Can hammer failing service. |
| 62 | `packages/jarvis-shared/src/types.ts` | **RequestedBy type mismatch** -- `requested_by` field typed as `string` in some places, `{user:string}` in others. |
| 63 | `packages/jarvis-inference/src/router.ts:14-28` | **Missing model tiers** -- `classifyModelTier` doesn't handle 34b/40b models. They default to "sonnet" instead of "opus". |
| 64 | `packages/jarvis-inference/src/rag.ts:67-77` | **Silent overwrite** -- `indexDocuments` replaces entire collection on re-index with no warning. |
| 65 | `packages/jarvis-scheduler/src/store.ts:156` | **String date comparison** -- `r.next_fire_at <= nowIso` does lexicographic comparison. Works for ISO 8601 but fragile. |
| 66 | `packages/jarvis-scheduler/src/evaluator.ts:85-89` | **UTC-only cron** -- `getNextFireTime` uses UTC but API gives no timezone indication. Users will enter local times. |
| 67 | `packages/jarvis-files/src/index.ts:343-378` | **No file size limit** -- `searchFiles` reads entire files into memory with no size cap. 1GB file = OOM. |
| 68 | `packages/jarvis-files/src/index.ts:219-257` | **No depth limit** -- `inspectFiles` with `recursive: true` reads previews of every file in tree. `node_modules` = hang. |
| 69 | `packages/jarvis-dashboard/src/ui/components/JarvisChat.tsx:79` | **Dead code** -- `const _noop = useCallback` assigned but never used. |
| 70 | `packages/jarvis-dashboard/src/api/server.ts:57-67` | **Silent startup failures** -- Multiple try/catch blocks catch and silently discard errors during server startup. |
| 71 | `packages/jarvis-crm-worker/src/execute.ts:107` | **Inconsistent error conversion** -- `toJobError` takes 1 param unlike other workers which also pass jobType. |
| 72 | `packages/jarvis-inference-worker/src/mock.ts:83` | **Unsafe fallback model** -- Falls back to `"llama3.1:8b"` without checking if it exists in MOCK_MODELS. |
| 73 | `contracts/jarvis/v1/job-envelope.schema.json:96-98` | **Out-of-order enum** -- `device.focus_mode` and `device.app_usage` inserted between scheduler types, breaking alphabetical grouping. |
| 74 | `contracts/jarvis/v1/files-job-types.schema.json:7-10` | **Duplicated definition** -- Redefines `non_empty_string` locally instead of `$ref`-ing common.schema.json. |
| 75 | `contracts/jarvis/v1/security-job-types.schema.json:108-123` | **Empty update allowed** -- `security_whitelist_update_input` requires only `action` but no items to add/remove. |
| 76 | `packages/jarvis-dashboard/src/ui/stores/godmode-store.ts:231-232` | **Greedy URL regex** -- `\S+` in URL extraction captures trailing punctuation and brackets. |
| 77 | `packages/jarvis-dashboard/src/ui/pages/Home.tsx:148-156` | **No loading timeout** -- Loading spinner shows forever if API never responds. |
| 78 | `.claude/skills/*.md` (all 8) | **Broken Telegram placeholder** -- All skill files push literal string `[replace with actual summary variable]` instead of actual content. |
| 79 | `packages/jarvis-agents/src/definitions/` | **Content engine missing approval gate** -- No `publish_post` approval gate despite CLAUDE.md requiring critical approval for publishing. |
| 80 | `packages/jarvis-agents/src/definitions/` | **Social engagement missing approval gate** -- Same issue: no `post_comment` approval gate. |
| 81 | `packages/jarvis-agents/src/definitions/` | **Email-campaign downgrades email.send** -- Changes `email.send` from "critical" to "warning", contradicting CLAUDE.md policy. |
| 82 | `packages/jarvis-agents/src/definitions/` | **Staffing-monitor downgrades email.send** -- Same downgrade. |
| 83 | `packages/jarvis-agents/src/definitions/` | **Contract-reviewer empty approval_gates** -- Definition has `[]` but prompt explicitly defines two gates. |
| 84 | `packages/jarvis-agents/src/data/garden-beds.json` | **Bed count conflict** -- Zone A is 12 beds in JSON but 14 in prompt/skill. Zone B same discrepancy. |
| 85 | `CLAUDE.md` | **Claims 8 agents** -- Actually 14 agent definitions exist. 6 agents undocumented. |
| 86 | `CLAUDE.md` | **Claims 29 test files** -- Actually 33 test files exist. |
| 87 | `CLAUDE.md` | **Claims 769 tests** -- Count is stale and likely different. |
| 88 | `packages/jarvis-agents/src/definitions/` | **6 agents have no skill files** -- email-campaign, social-engagement, market-scanner, health-wellness, client-portal, and financial-tracker have definitions but no `.claude/skills/*.md` files. |
| 89 | `packages/jarvis-agents/src/prompts/` | **Hardcoded dates in prompts** -- Several prompts reference specific dates that become stale. Should use dynamic `{current_date}` placeholder. |
| 90 | `packages/jarvis-agents/src/prompts/` | **Mixed currency references** -- Some prompts use EUR, others USD, without configuration. |
| 91 | `packages/jarvis-agents/src/prompts/` | **Relative file paths** -- Prompts reference `~/.jarvis/` which may not resolve on Windows. |
| 92 | `packages/jarvis-telegram/src/push.ts:6-21` | **Top-level side effects** -- Entire file is a script with side effects at import time. Untestable. |
| 93 | `packages/jarvis-telegram/src/index.ts:37` | **Top-level side effects** -- `main().catch(console.error)` runs at module load. Untestable. |
| 94 | `packages/jarvis-supervisor/src/` | **Callback error propagation** -- Supervisor callbacks don't propagate errors to callers. Failures silently swallowed. |
| 95 | `packages/jarvis-agent-framework/src/vector-store.ts` | **Loads all chunks into RAM** -- Vector store loads entire corpus into memory. No pagination or lazy loading. |
| 96 | `packages/jarvis-jobs/src/` | **Global mutable state** -- Job registry uses module-level mutable Map. No isolation between test runs. |
| 97 | `packages/jarvis-scheduler/src/store.ts` | **No cron validation** -- Accepts arbitrary strings as cron expressions without parsing/validating format. |
| 98 | `packages/jarvis-agent-framework/src/` | **No recursion depth limit** -- Agent can spawn sub-agents recursively with no depth cap. Infinite loop possible. |
| 99 | `packages/jarvis-core/src/` | **Unguarded setInterval async** -- Async callback in setInterval can overlap if previous tick hasn't completed. |
| 100 | `packages/jarvis-dashboard/src/api/plugins.ts:93-94` | **Unsafe file copy** -- `copyFileSync` copies plugin files without validating source path. Compromised plugin dir = arbitrary file read. |

---

## PART 2: IMPROVEMENTS (100)

### Code Quality & DRY

| # | Location | Improvement |
|---|----------|-------------|
| 1 | 9 plugin files | **Extract `asLiteralUnion`** -- Identical helper copy-pasted across 9 plugins. Move to `@jarvis/shared`. |
| 2 | All plugin files | **Extract `formatJobReply`** -- Same function duplicated in every plugin. Move to shared module. |
| 3 | All plugin files | **Extract `parseJsonArgs`** -- Same function duplicated in every plugin. |
| 4 | All plugin files | **Extract `toToolContext`** -- Same function duplicated in every plugin. |
| 5 | All plugin files | **Extract `invalidJsonReply`** -- Same function duplicated in every plugin. |
| 6 | 10 plugin files | **Remove unused `getJarvisState` import** -- Imported but never called in at least 10 files. |
| 7 | `packages/jarvis-agent-framework/src/approval-store.ts` | **Replace file-based store with SQLite** -- System already uses SQLite. File JSON is the source of race conditions. |
| 8 | `packages/jarvis-telegram/src/relay.ts` | **Replace file-based queue with SQLite** -- Same issue. Use the existing DB infrastructure. |
| 9 | `packages/jarvis-core/src/files-bridge.ts` | **Add path traversal protection** -- Validate resolved paths stay within allowed root directories using `realpath`. |
| 10 | `packages/jarvis-agent-framework/src/knowledge-store.ts` | **Parameterize FTS5 queries** -- Sanitize search terms before passing to MATCH clause. Escape special characters. |

### Error Handling & Resilience

| # | Location | Improvement |
|---|----------|-------------|
| 11 | `packages/jarvis-agent-framework/src/agent-queue.ts` | **Add worker timeouts** -- Enforce configurable max execution time per worker. Kill and report failure on timeout. |
| 12 | `packages/jarvis-agent-framework/src/agent-queue.ts` | **Await all promises** -- Replace fire-and-forget with proper await + error handling. |
| 13 | `packages/jarvis-agent-framework/src/planner.ts` | **Add exponential backoff** -- Retry with increasing delays: 1s, 2s, 4s, 8s... |
| 14 | `packages/jarvis-system-worker/src/node-system.ts` | **Sanitize shell inputs** -- Use parameterized commands or `execFile` instead of string interpolation in `execSync`. |
| 15 | `packages/jarvis-dashboard/src/api/chat.ts` | **Add HTTP request timeouts** -- Set configurable timeout on all outbound HTTP calls. |
| 16 | `packages/jarvis-dashboard/src/api/server.ts` | **Log startup errors** -- Replace silent catch blocks with proper logging. |
| 17 | `packages/jarvis-dashboard/src/ui/pages/CrmPipeline.tsx` | **Show error feedback** -- Replace `.catch(() => {})` with toast/snackbar notifications. |
| 18 | `packages/jarvis-telegram/src/commands.ts` | **Use try/finally for DB** -- Ensure `db.close()` always called even on error. |
| 19 | `packages/jarvis-inference/src/runtime.ts` | **Support HTTPS** -- Check URL protocol and use `https.request` for HTTPS URLs. |
| 20 | `packages/jarvis-inference/src/runtime.ts` | **Clean up response on timeout** -- Track `res` object and destroy it alongside request on timeout. |

### Type Safety

| # | Location | Improvement |
|---|----------|-------------|
| 21 | `packages/jarvis-crm-plugin/src/index.ts` | **Remove `as any` casts** -- Destructure and forward only expected params per operation instead of `args as any`. |
| 22 | `packages/jarvis-system-worker/src/node-system.ts` | **Validate type assertions** -- Add runtime type checks before casting GPU info, network addresses, etc. |
| 23 | `packages/jarvis-dashboard/src/api/godmode.ts` | **Validate DB query results** -- Add runtime validation instead of blind `as Array<Record<string, unknown>>` casts. |
| 24 | `packages/jarvis-shared/src/types.ts` | **Unify RequestedBy type** -- Define single canonical type and use it everywhere. |
| 25 | `packages/jarvis-dashboard/src/api/portal.ts` | **Type-safe request extension** -- Use Express middleware typing instead of `req as unknown as Record<>`. |

### Validation

| # | Location | Improvement |
|---|----------|-------------|
| 26 | `packages/jarvis-email-plugin/src/index.ts` | **Validate email.send** -- Require either `draft_id` OR (`to` + `subject` + `body`). |
| 27 | `packages/jarvis-document-plugin/src/index.ts` | **Validate extract_clauses** -- Require at least one of `file_path` or `text`. |
| 28 | `packages/jarvis-document-plugin/src/index.ts` | **Validate analyze_compliance** -- Same: require at least one document source. |
| 29 | `packages/jarvis-scheduler/src/store.ts` | **Validate cron expressions** -- Parse and validate format before storing. Reject malformed patterns. |
| 30 | `packages/jarvis-core/src/config.ts` | **Add config schema validation** -- Validate config JSON against a schema on load. Fail fast with clear errors. |
| 31 | `packages/jarvis-telegram/src/commands.ts` | **Minimum approval ID length** -- Require at least 6 chars in `/approve` and `/reject` to prevent ambiguous matching. |
| 32 | `packages/jarvis-files/src/index.ts` | **Add file size limit** -- Skip files larger than configurable max (default 10MB) in `searchFiles`. |
| 33 | `packages/jarvis-files/src/index.ts` | **Add recursion depth limit** -- Cap `inspectFiles` recursive depth to prevent runaway traversal. |
| 34 | `contracts/jarvis/v1/document-job-types.schema.json` | **Add `anyOf` constraint** -- Require at least `file_path` or `text` in extract/analyze schemas. |
| 35 | `contracts/jarvis/v1/scheduler-job-types.schema.json` | **Add `anyOf` constraint** -- Require at least `cron_expression` or `interval_seconds`. |

### Memory & Resources

| # | Location | Improvement |
|---|----------|-------------|
| 36 | `packages/jarvis-agent-framework/src/runs-store.ts` | **Add LRU eviction** -- Cap runs map size. Evict completed runs older than N hours. |
| 37 | `packages/jarvis-agent-framework/src/decision-log.ts` | **Add LRU eviction** -- Same: cap decisions map, prune old entries. |
| 38 | `packages/jarvis-agent-framework/src/vector-store.ts` | **Add lazy loading** -- Don't load entire corpus into RAM. Use pagination or mmap. |
| 39 | `packages/jarvis-inference/src/rag.ts` | **Add collection size limit** -- Cap max chunks per collection and total memory. Add LRU eviction. |
| 40 | `packages/jarvis-scheduler/src/store.ts:69` | **Prune habit entries** -- Drop entries older than 90 days to prevent unbounded growth. |
| 41 | `packages/jarvis-telegram/src/relay.ts` | **Prune sent messages** -- Remove `sent: true` entries after processing to prevent file growth. |

### Testing

| # | Location | Improvement |
|---|----------|-------------|
| 42 | `tests/contract-alignment.test.ts` | **Cover all 19 plugins** -- Currently validates only 7 of 19 plugins against frozen surface. |
| 43 | `tests/` | **Add CRM integration tests** -- Test actual SQLite CRM operations (CRUD, stage history, digest). |
| 44 | `tests/` | **Add Knowledge DB integration tests** -- Test document/playbook/entity operations against real SQLite. |
| 45 | `tests/agent-definitions.test.ts:239-251` | **Strengthen garden agent tests** -- Add specific assertions (agent_id, trigger types, crons) matching other agent test patterns. |
| 46 | `tests/agent-definitions.test.ts:198-202` | **Fix content engine approval test** -- Should assert `publish_post` gate exists per CLAUDE.md policy. |
| 47 | `tests/` | **Add worker timeout tests** -- Test that workers respect and enforce execution timeouts. |
| 48 | `tests/` | **Add approval race condition tests** -- Concurrent approval read/write with assertion on data integrity. |
| 49 | `tests/` | **Add path traversal tests** -- Test that `../` sequences are blocked in file operations. |
| 50 | `tests/` | **Add command injection tests** -- Test that shell metacharacters in inputs are sanitized. |
| 51 | `vitest.config.ts` | **Sync aliases with tsconfig** -- Add missing `@jarvis/runtime`, `@jarvis/time-worker`, `@jarvis/drive-worker`, `@jarvis/telegram` aliases. |

### Schema & Contract

| # | Location | Improvement |
|---|----------|-------------|
| 52 | `contracts/jarvis/v1/` | **Create social-job-types.schema.json** -- Define schemas for all 7 `social.*` job types. |
| 53 | `contracts/jarvis/v1/` | **Create time-job-types.schema.json** -- Define schemas for all 4 `time.*` job types. |
| 54 | `contracts/jarvis/v1/` | **Create drive-job-types.schema.json** -- Define schemas for all 4 `drive.*` job types. |
| 55 | `contracts/jarvis/v1/browser-job-types.schema.json` | **Add 5 missing browser schemas** -- Define input/output for navigate, click, type, evaluate, wait_for. |
| 56 | `scripts/validate-contracts.mjs` | **Remove skipSchemaTypes** -- After adding missing schemas, remove the 20-type skip set. |
| 57 | `scripts/validate-contracts.mjs` | **Validate input payloads** -- Validate example `input` fields against job-type-specific input schemas, not just envelope. |
| 58 | `contracts/jarvis/v1/job-envelope.schema.json` | **Add missing type enums** -- Add all 20 skipped types to the `type` enum. |
| 59 | `contracts/jarvis/v1/plugin-surface.json` | **Validate catalog coverage** -- Add automated check that every catalog job type maps to a plugin tool. |

### Build & Dependencies

| # | Location | Improvement |
|---|----------|-------------|
| 60 | `package.json` | **Add `concurrently` to devDeps** -- Required by `dashboard:dev` script. |
| 61 | `package.json` | **Add `tsx` to devDeps** -- Required by 6+ scripts. |
| 62 | `package.json` | **Add `googleapis` to devDeps** -- Required by setup script. |
| 63 | `package.json` | **Add `vite` to devDeps** -- Required by dashboard scripts (or ensure hoisting). |
| 64 | `scripts/init-jarvis.ts` | **Document Node.js requirement** -- `node:sqlite` requires Node >= 22.5 with experimental flag. |
| 65 | `scripts/init-jarvis.ts` | **Add try/finally for DB close** -- Ensure database handles closed on error. |

### Agent Definitions & Skills

| # | Location | Improvement |
|---|----------|-------------|
| 66 | `.claude/skills/*.md` | **Fix Telegram placeholder** -- Replace `[replace with actual summary variable]` with actual content template. |
| 67 | `packages/jarvis-agents/src/definitions/` | **Add missing approval gates** -- content-engine needs `publish_post`, social-engagement needs `post_comment`. |
| 68 | `packages/jarvis-agents/src/definitions/` | **Fix email.send severity** -- email-campaign and staffing-monitor should use "critical" not "warning". |
| 69 | `packages/jarvis-agents/src/definitions/` | **Add contract-reviewer gates** -- Populate `approval_gates` from the 2 gates defined in prompt. |
| 70 | `.claude/skills/` | **Create 6 missing skill files** -- email-campaign, social-engagement, market-scanner, health-wellness, client-portal, financial-tracker. |
| 71 | `CLAUDE.md` | **Update agent count** -- Document all 14 agents, not just 8. |
| 72 | `CLAUDE.md` | **Update test counts** -- Reflect actual 33 files and current test count. |
| 73 | `packages/jarvis-agents/src/prompts/` | **Use dynamic date placeholder** -- Replace hardcoded dates with `{current_date}` variable. |
| 74 | `packages/jarvis-agents/src/prompts/` | **Standardize currency** -- Use configurable currency setting, not mixed EUR/USD. |
| 75 | `packages/jarvis-agents/src/data/garden-beds.json` | **Reconcile bed counts** -- Align Zone A/B bed counts across JSON, definition, prompt, and skill. |

### Architecture & Performance

| # | Location | Improvement |
|---|----------|-------------|
| 76 | `packages/jarvis-agent-framework/src/` | **Add recursion depth limit** -- Cap agent-spawns-agent depth to prevent infinite loops. |
| 77 | `packages/jarvis-core/src/` | **Guard setInterval callbacks** -- Prevent async callback overlap using a running flag. |
| 78 | `packages/jarvis-jobs/src/` | **Isolate module state** -- Use factory function instead of global Map for test isolation. |
| 79 | `packages/jarvis-scheduler/src/evaluator.ts` | **Use epsilon comparison** -- Replace `===` with `Math.abs(a-b) < epsilon` for float thresholds. |
| 80 | `packages/jarvis-scheduler/src/evaluator.ts` | **Add timezone support** -- Accept timezone parameter or document UTC behavior in API. |

### Dashboard

| # | Location | Improvement |
|---|----------|-------------|
| 81 | `packages/jarvis-dashboard/src/api/entities.ts` | **Fix column names** -- Align API column names with actual schema (entity_type, from_entity_id). |
| 82 | `packages/jarvis-dashboard/src/api/crm.ts` | **Fix notes insert** -- Include `id` column in INSERT statement. |
| 83 | `packages/jarvis-dashboard/src/api/godmode.ts` | **Fix double execution** -- Remove redundant second tool-call extraction and execution pass. |
| 84 | `packages/jarvis-dashboard/src/api/godmode.ts` | **Use `realpath` for path check** -- Resolve symlinks before validating against PROJECT_ROOT. |
| 85 | `packages/jarvis-dashboard/src/api/settings.ts` | **Strengthen mask detection** -- Use a more robust check than `startsWith('****')`. |
| 86 | `packages/jarvis-dashboard/src/api/chat.ts` | **Log parse failures** -- Add structured logging when LLM JSON parsing fails. |
| 87 | `packages/jarvis-dashboard/src/ui/components/JarvisChat.tsx` | **Remove dead code** -- Delete unused `_noop` callback. |

### Documentation

| # | Location | Improvement |
|---|----------|-------------|
| 88 | `CLAUDE.md` | **Document all scheduled tasks** -- List which agents run on cron and their schedules. |
| 89 | `CLAUDE.md` | **Document Windows path handling** -- Note that `~/.jarvis/` prompts need Windows-compatible paths. |
| 90 | `CLAUDE.md` | **Document Node.js version** -- Specify Node >= 22.5 requirement for experimental sqlite. |
| 91 | `package.json` | **Add `engines` field** -- Specify minimum Node.js version. |
| 92 | Root | **Add CONTRIBUTING.md** -- Guide for adding new agents, workers, plugins, and schemas. |

### Developer Experience

| # | Location | Improvement |
|---|----------|-------------|
| 93 | `packages/jarvis-telegram/src/push.ts` | **Wrap in main()** -- Prevent side effects at import time. Make testable. |
| 94 | `packages/jarvis-telegram/src/index.ts` | **Wrap in main()** -- Same: prevent side effects at module load. |
| 95 | `packages/jarvis-telegram/src/config.ts` | **Validate bot token format** -- Check token matches Telegram's `NNNNNNNNN:XXXXXXXXX` pattern on startup. |
| 96 | `packages/jarvis-files/src/index.ts` | **Add session context** -- Pass `PluginToolContext` to file tools for write audit trails. |
| 97 | `packages/jarvis-inference/src/rag.ts` | **Document in-memory limitation** -- Clearly note that RAG store is ephemeral and memory-bounded. |
| 98 | `packages/jarvis-inference/src/streaming.ts` | **Fix duplicate done event** -- Track `doneSent` flag, skip redundant push in `end` handler. |
| 99 | `packages/jarvis-dashboard/src/ui/pages/Home.tsx` | **Add loading timeout** -- Show error state if API doesn't respond within N seconds. |
| 100 | `scripts/validate-contracts.mjs` | **Validate plugin-surface completeness** -- Check that every job type in catalog has a matching plugin tool. |

---

## PART 3: NEW FEATURES (100)

### Core Infrastructure

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Structured logging system** | Replace console.log/error with structured JSON logging (winston/pino). Log levels, correlation IDs, agent context. Essential for debugging multi-agent workflows. |
| 2 | **Metrics collection** | Add Prometheus-compatible metrics: job throughput, latency histograms, queue depth, error rates per agent. Export via `/metrics` endpoint. |
| 3 | **Health check endpoint** | `/health` endpoint returning component status (DB connectivity, worker health, queue depth, memory usage). Used by monitoring and dashboard. |
| 4 | **Circuit breaker pattern** | Wrap external calls (LLM, browser, email API) in circuit breakers. Open after N consecutive failures, half-open after cooldown, auto-close on success. |
| 5 | **Rate limiter** | Token-bucket rate limiter for external API calls (Gmail, LinkedIn, LLM). Prevent quota exhaustion and account bans. |
| 6 | **Job retry with dead-letter queue** | Failed jobs retry with exponential backoff (configurable per job type). After max retries, move to DLQ for manual review. |
| 7 | **Job priority queue** | Priority levels (critical/high/normal/low) for jobs. Approval-required jobs get priority. Background scanning is low priority. |
| 8 | **Event bus** | Pub/sub event bus for cross-agent communication. Agents publish events (new_lead, proposal_sent, contract_signed), other agents subscribe and react. |
| 9 | **Audit trail** | Immutable append-only log of all actions: who triggered, what changed, when, approval status. Required for ISO 26262 compliance. |
| 10 | **Configuration management** | Environment-based config (dev/staging/prod) with validation, secrets encryption at rest, hot-reload without restart. |

### Agent Capabilities

| # | Feature | Description |
|---|---------|-------------|
| 11 | **Agent dependency graph** | Define dependencies between agents (e.g., bd-pipeline feeds proposal-engine). Visualize in dashboard. Auto-trigger downstream agents. |
| 12 | **Agent versioning** | Version agent definitions. Roll back to previous version if new one produces poor results. A/B test agent strategies. |
| 13 | **Agent memory persistence** | Long-term memory store per agent. Remember past decisions, learn from outcomes. "Last time we quoted X client, they negotiated down 15%." |
| 14 | **Multi-agent collaboration** | Agents can request help from other agents mid-workflow. Contract-reviewer asks evidence-auditor for compliance context. |
| 15 | **Agent performance scoring** | Track agent effectiveness: proposal win rate, content engagement, audit accuracy. Surface in dashboard with trends. |
| 16 | **Conditional agent triggers** | Trigger agents based on compound conditions: "Run staffing-monitor IF utilization > 85% AND pipeline has 3+ qualified leads." |
| 17 | **Agent dry-run mode** | Execute agent workflow without side effects. Preview what it would do. Essential for testing new agent configurations. |
| 18 | **Agent rollback** | If an agent's actions cause problems, one-click rollback of all changes it made (CRM updates, emails drafted, etc.). |
| 19 | **Human-in-the-loop workflows** | Pause agent at configurable checkpoints. Wait for human review/edit before continuing. Not just approve/reject but edit-and-continue. |
| 20 | **Agent templates** | Create new agents from templates with pre-configured triggers, approval gates, and prompt structures. Reduce boilerplate. |

### Business Development

| # | Feature | Description |
|---|---------|-------------|
| 21 | **LinkedIn Sales Navigator integration** | Scrape/API integration with LinkedIn Sales Navigator for advanced lead filtering, InMail tracking, and connection request management. |
| 22 | **Email sequence automation** | Multi-step email sequences with delays, branching based on opens/replies. "If no reply in 3 days, send follow-up B." |
| 23 | **Proposal template library** | Manage proposal templates by client type (OEM, Tier-1, Tier-2), service type (ISO 26262, ASPICE, AUTOSAR). Auto-select best template. |
| 24 | **Win/loss analysis** | When deals close (won or lost), prompt for reasons. Analyze patterns: which proposal styles win, which objections arise, seasonal trends. |
| 25 | **Competitor intelligence** | Track competitor activity: job postings (hiring = growing), press releases, conference presentations. Alert on relevant moves. |
| 26 | **RFQ/RFI parser** | Auto-parse incoming RFQ/RFI documents. Extract requirements, deadlines, evaluation criteria. Pre-populate proposal structure. |
| 27 | **Client health score** | Composite score per client: engagement frequency, payment timeliness, project satisfaction, expansion signals. Alert on declining health. |
| 28 | **Revenue forecasting** | Pipeline-weighted revenue forecast. Factor in stage probabilities, historical close rates, average deal size by segment. |
| 29 | **Meeting prep brief** | Before any client meeting, auto-generate brief: contact history, open proposals, recent communications, talking points, risks. |
| 30 | **Referral tracking** | Track which clients/contacts refer new business. Calculate referral ROI. Auto-send thank-you notes on referral close. |

### Compliance & Quality (ISO 26262 / ASPICE)

| # | Feature | Description |
|---|---------|-------------|
| 31 | **ASPICE assessment tracker** | Track ASPICE assessment status per project: current level, target level, gap analysis, improvement actions, timeline to next assessment. |
| 32 | **Work product traceability matrix** | Automated traceability from requirements through design, implementation, verification. Flag broken trace links. |
| 33 | **Safety case generator** | Generate safety case structure from project data: safety goals, ASIL allocation, verification evidence, residual risk. |
| 34 | **Compliance dashboard** | Visual dashboard showing compliance status across all active projects. Heat map of gap areas. Drill down to specific work products. |
| 35 | **FMEA assistant** | Help build/review Failure Mode and Effects Analysis. Suggest failure modes based on component type. Calculate RPN. |
| 36 | **DFA/DFMEA template engine** | Generate Design FMEA templates pre-populated with common automotive failure modes, detection methods, and severity ratings. |
| 37 | **Audit finding tracker** | Track findings from internal/external audits. Assign owners, deadlines. Auto-escalate overdue items. |
| 38 | **ISO 26262 part navigator** | Quick reference to relevant ISO 26262 parts/clauses for any work product. "What does Part 6 say about unit testing for ASIL C?" |
| 39 | **AUTOSAR compliance checker** | Verify AUTOSAR architecture compliance: layer violations, port interface mismatches, runnable scheduling conflicts. |
| 40 | **Cybersecurity compliance (ISO 21434)** | Track cybersecurity work products per ISO/SAE 21434. TARA analysis, threat models, cybersecurity goals. |

### Content & Marketing

| # | Feature | Description |
|---|---------|-------------|
| 41 | **Content calendar** | Visual calendar of planned LinkedIn posts mapped to content pillars. Drag-and-drop rescheduling. Gap detection. |
| 42 | **Engagement analytics** | Track post performance: impressions, likes, comments, shares, profile views. Identify best-performing topics and formats. |
| 43 | **Comment response drafts** | Auto-draft replies to comments on your posts. Maintain conversation. Flag negative sentiment for personal attention. |
| 44 | **Thought leadership tracker** | Track industry conferences, webinars, publications. Suggest speaking opportunities. Draft abstracts aligned with content strategy. |
| 45 | **Content repurposing** | Auto-generate blog posts from LinkedIn content, slide decks from blog posts, email newsletters from top-performing content. |
| 46 | **Hashtag optimization** | Analyze hashtag performance. Suggest optimal hashtag mix per post. Track trending hashtags in automotive safety space. |
| 47 | **Competitor content analysis** | Monitor competitor LinkedIn activity. Identify content gaps you can fill. Alert on trending topics in your space. |
| 48 | **Article draft generation** | Generate long-form articles from outlines. Include relevant case studies, standards references, and industry data. |

### Staffing & Resource Management

| # | Feature | Description |
|---|---------|-------------|
| 49 | **Skills matrix** | Detailed skills inventory per consultant: certifications, tools, domains, ASIL experience levels. Auto-match to RFQ requirements. |
| 50 | **Capacity planning** | Visual timeline of consultant allocations. Identify upcoming gaps 2-3 months ahead. Suggest hiring/contracting needs. |
| 51 | **Timesheet integration** | Connect to time-tracking system. Auto-calculate utilization. Flag consultants at risk of burnout (>90% utilization for 3+ weeks). |
| 52 | **Training recommendations** | Based on pipeline demands and skill gaps, recommend training/certifications for team members. Track completion. |
| 53 | **Contractor marketplace** | Database of vetted subcontractors with skills, rates, availability. Quick-match for surge capacity needs. |
| 54 | **Project staffing optimizer** | Given a set of projects and available people, suggest optimal staffing allocation. Consider skills, utilization targets, client preferences. |

### Financial

| # | Feature | Description |
|---|---------|-------------|
| 55 | **Invoice generator** | Generate invoices from timesheet data + rate cards. Apply client-specific terms. Track payment status. |
| 56 | **Expense tracking** | Track project expenses. Compare actuals to budget. Alert on overruns. Generate expense reports. |
| 57 | **Profitability analysis** | Per-project and per-client profitability. Factor in consultant costs, overhead, travel, tools. Identify most/least profitable work. |
| 58 | **Tax preparation assistant** | Organize financial data for tax preparation. Track deductible expenses. Generate summary reports for accountant. |
| 59 | **Crypto DCA automation** | Automated dollar-cost averaging for crypto portfolio. Execute scheduled buys according to allocation targets. |
| 60 | **Multi-exchange portfolio** | Aggregate portfolio across multiple exchanges (Binance, Coinbase, Kraken). Unified view with total P&L. |

### Integration

| # | Feature | Description |
|---|---------|-------------|
| 61 | **Jira/Linear integration** | Sync project tasks with Jira or Linear. Create issues from audit findings. Track resolution status. |
| 62 | **Confluence/SharePoint sync** | Push generated reports and compliance documentation to Confluence or SharePoint. Keep client-facing docs current. |
| 63 | **Slack integration** | Send notifications to Slack channels. Allow slash commands from Slack to trigger agents. |
| 64 | **Microsoft Teams integration** | Same as Slack but for Teams. Many automotive clients use Teams exclusively. |
| 65 | **Google Calendar integration** | Sync meetings, auto-generate pre-meeting briefs, block focus time, detect scheduling conflicts. |
| 66 | **DocuSign/Adobe Sign integration** | Track contract signing status. Auto-send reminders for unsigned contracts. Alert on expiring agreements. |
| 67 | **Stripe/Wise payment integration** | Track incoming payments against invoices. Auto-reconcile. Alert on overdue payments. |
| 68 | **GitHub/GitLab integration** | Monitor repos for compliance artifacts. Track PR reviews on safety-critical code. Link commits to requirements. |
| 69 | **SAP integration** | For clients using SAP: sync project data, timesheets, expenses. Common in automotive OEMs. |
| 70 | **Zoom/Teams meeting summarizer** | Auto-join meetings, transcribe, generate summary with action items. Push action items to task tracker. |

### Dashboard & UI

| # | Feature | Description |
|---|---------|-------------|
| 71 | **Real-time agent activity feed** | Live feed showing what each agent is doing right now. Click to see details. Filter by agent. |
| 72 | **Pipeline Kanban board** | Drag-and-drop Kanban view of BD pipeline. Move deals between stages. Quick-add contacts. |
| 73 | **Agent workflow visualizer** | Visual flowchart of each agent's decision tree. Show current execution point during runs. |
| 74 | **Approval queue UI** | Web-based approval queue (not just Telegram). One-click approve/reject with context preview. |
| 75 | **Custom dashboard widgets** | User-configurable dashboard with drag-and-drop widgets: pipeline, utilization, compliance, content calendar, portfolio. |
| 76 | **Dark mode** | Dashboard dark mode for late-night operations. |
| 77 | **Mobile-responsive dashboard** | Responsive design for phone/tablet access. Approve actions on the go. |
| 78 | **Notification center** | Centralized notification inbox in dashboard. Filter by agent, severity, type. Mark read/unread. Snooze. |
| 79 | **Search across all data** | Global search across CRM, knowledge base, decisions, proposals, content. Full-text with filters. |
| 80 | **Export to PDF/PPTX** | One-click export of any dashboard view, report, or analysis to PDF or PowerPoint for client presentations. |

### Operations & Reliability

| # | Feature | Description |
|---|---------|-------------|
| 81 | **Database backup/restore** | Scheduled backups of CRM and knowledge databases. One-click restore to any point. Off-site backup option. |
| 82 | **Database migration system** | Version-controlled schema migrations. Auto-run on startup. Rollback support. Never manual ALTER TABLE. |
| 83 | **Graceful shutdown** | On SIGTERM: finish current jobs, flush queues, close DB connections, save state. No data loss on restart. |
| 84 | **Health monitoring alerts** | Email/Telegram alerts when agents fail, queues back up, DB unreachable, or disk space low. |
| 85 | **Agent execution history** | Full history of every agent run: trigger, inputs, decisions, outputs, duration, errors. Filterable and searchable. |
| 86 | **Configuration drift detection** | Alert when agent definitions, skills, or schemas change without corresponding test updates. |
| 87 | **Canary deployments** | Run new agent version on 10% of triggers. Compare results with production version. Auto-promote or rollback. |
| 88 | **Cost tracking** | Track LLM API costs per agent, per run. Budget alerts. Optimize expensive agents. |

### Knowledge & Learning

| # | Feature | Description |
|---|---------|-------------|
| 89 | **Knowledge base web UI** | Browse, search, and edit the knowledge base from the dashboard. Add documents, tag entities, view relations. |
| 90 | **Automatic knowledge extraction** | When reading emails, proposals, or documents, auto-extract and store key facts, decisions, and relationships. |
| 91 | **Decision replay** | Replay any past decision with updated context. "What would bd-pipeline recommend today for this lead?" |
| 92 | **Lesson learned capture** | After project completion, prompt for lessons learned. Store structured data: what worked, what didn't, recommendations. |
| 93 | **Client knowledge graph** | Visual graph of client relationships: contacts, projects, proposals, meetings, contracts. Navigate by clicking. |

### Automotive-Specific

| # | Feature | Description |
|---|---------|-------------|
| 94 | **OEM program tracker** | Track vehicle programs at each OEM client: SOP dates, development phases, your involvement. Alert on phase transitions. |
| 95 | **Standards update monitor** | Monitor ISO, SAE, AUTOSAR for new publications, amendments, and drafts. Alert when relevant standards change. |
| 96 | **Tool qualification assistant** | Help qualify tools per ISO 26262 Part 8. Generate tool qualification plans, evaluate tool confidence levels. |
| 97 | **Functional safety concept generator** | From system description and hazard analysis, draft functional safety concept with safety goals and ASIL allocation. |
| 98 | **SOTIF analysis helper** | Support ISO 21448 (SOTIF) analysis: identify triggering conditions, functional insufficiencies, known/unknown scenarios. |
| 99 | **Supplier assessment agent** | Evaluate supplier capability for safety-critical development. Score against ASPICE/ISO 26262 criteria. Generate assessment reports. |
| 100 | **Regulatory horizon scanner** | Monitor UNECE, EU, NHTSA for upcoming regulations affecting automotive safety (cyber regulations, AI act, type approval changes). |

---

## SUMMARY

| Category | Count | Critical/High |
|----------|-------|---------------|
| Bugs | 100 | 10 critical, 20 high |
| Improvements | 100 | -- |
| New Features | 100 | -- |
| **Total** | **300** | |

### Top 10 Priority Fixes

1. **Command injection in node-system.ts** (Bug #1) -- Use `execFile` instead of `execSync` with interpolation
2. **Code injection via `new Function`** (Bug #2) -- Sandbox or remove dynamic code execution
3. **Browser context closure bug** (Bug #3) -- Fix `_toolCtx` to `toolCtx` in 3 tools
4. **File-based race conditions** (Bugs #4, #5) -- Migrate to SQLite
5. **20 job types skip validation** (Bug #24) -- Define missing schemas
6. **Missing dependencies** (Bugs #27-29) -- Add concurrently, tsx, googleapis to package.json
7. **Missing approval gates** (Bugs #79-82) -- Align with CLAUDE.md policy
8. **Double tool execution in godmode** (Bug #8) -- Remove redundant extraction pass
9. **Column name mismatches in entities API** (Bug #9) -- Align with schema
10. **No worker timeouts** (Bug #56) -- Add configurable execution time limits
