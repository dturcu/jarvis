# Inference/Runtime Engineer — Red-team review

## Top findings

1. **[critical] No health weighting in runtime preference — a dead llama.cpp wins every tie**
   - Evidence: `packages/jarvis-inference/src/router.ts:73` (`RUNTIME_PREFERENCE = { llamacpp: 0, ollama: 1, lmstudio: 2, openclaw: 3 }`) and `default-adapter.ts:197` (`resolveRuntimeUrl` never probes availability)
   - Impact: If `selectFromRegistry` returns a stale llama.cpp model (registry persisted before the server died), every chat job routes to `:8080` and crashes with `ECONNREFUSED` instead of failing over to a reachable runtime.
   - Recommended fix: Before returning from `selectFromRegistry`, probe the target runtime (reuse `probeUrl` from `runtime.ts`) and fall through to the next candidate in preference order, not to live-discovery as a catch-all.

2. **[critical] No "all runtimes down" failover test and no circuit breaker**
   - Evidence: `tests/llamacpp-integration.test.ts` (608 lines, zero tests for 0/3 reachable, timeout mid-stream, or partial failure); no retry/backoff in `default-adapter.ts:206` (`chatCompletion`) or `runtime.ts:122`
   - Impact: Transient runtime flaps cause instant job failure with no exponential backoff; a single slow model can starve `max_concurrent=2` worker slots because every call retries immediately at the job layer.
   - Recommended fix: Add a per-runtime circuit breaker (3 failures → 30s open) in `default-adapter.ts` and tests covering `detectRuntimes() → []`, timeout mid-SSE, and model-not-loaded (LM Studio returns 404 for unloaded gguf).

3. **[high] Fixed 3s probe timeout is both too short and too long in the wrong places**
   - Evidence: `packages/jarvis-inference/src/runtime.ts:66` (`PROBE_TIMEOUT_MS = 3000`), `registry.ts:21` (5s discovery), `default-adapter.ts:206` (no timeout at all on `chatCompletion` — only the outer 60s worker timeout at `worker-registry.ts:430`)
   - Impact: Cold-start llama.cpp on large GGUF can take 20s+ to probe ready, so `detectRuntimes` declares it unavailable; meanwhile a runaway 70B generation runs for 60s with no per-request budget.
   - Recommended fix: Introduce tiered timeouts (probe 3s, list_models 10s, chat small 30s / medium 90s / large 300s) driven by `classifyModelSize` and expose via `ConfigSchema`.

4. **[high] Config cache never invalidates → `~/.jarvis/config.json` edits silently ignored**
   - Evidence: `scripts/runtime-detect.mjs:152-197` (module-level `_configCache`, populated once, `clearConfigCache()` exported but never called by dashboard or daemon)
   - Impact: Changing `gguf_dirs`, `binary_path`, or `enabled` requires a full `npm start` restart; dashboard `POST /runtimes/llamacpp/load` still scans stale dirs.
   - Recommended fix: Add an `fs.watch` on the config path or read-through with a 30s TTL; at minimum call `clearConfigCache()` from the runtimes router before every request.

5. **[high] `runtime` label hardcoded to "lmstudio" corrupts all governance/cost metrics**
   - Evidence: `packages/jarvis-runtime/src/worker-registry.ts:471` (`const runtime = "lmstudio"; // TODO: detect from actual model selection`)
   - Impact: `inferenceRuntimeTotal{runtime="lmstudio"}`, `inferenceCostUsdTotal`, and `InferenceGovernor.recordUsage` all lie — governance's `min_local_percentage` gate is based on fabricated data, and llama.cpp preference cannot be validated in production.
   - Recommended fix: Read `result.structured_output.runtime` (already returned by `DefaultInferenceAdapter.chat` at `default-adapter.ts:217`) and propagate it into the metrics block.

6. **[high] Streaming path has no abort propagation on client disconnect**
   - Evidence: `packages/jarvis-inference/src/streaming.ts:57-144` — no `req.on('close')` handler in caller; `req.destroy()` never called when the consumer stops iterating; queue grows unbounded
   - Impact: If a godmode/SSE client disconnects mid-response, the llama.cpp slot stays busy generating tokens into a dead socket, blocking the next job for up to 60s per cancelled request.
   - Recommended fix: Accept an `AbortSignal` in `StreamChatParams`, wire `signal.addEventListener('abort', () => req.destroy())`, and have `session-chat-adapter.ts` + legacy godmode pass `res.socket`'s close event through.

7. **[high] Custom `http.request` helper throws away status-specific errors and has no keep-alive**
   - Evidence: `packages/jarvis-inference/src/runtime.ts:8-52` (`httpRequest` creates a fresh socket per call, no agent, error body clipped to 200 chars at line 141)
   - Impact: Every inference request pays TCP handshake (~5-15ms local, dominant under load); `503 model loading` (Ollama warm-up) is indistinguishable from `429` or `400 ctx overflow`, so retry-vs-fail decisions are wrong.
   - Recommended fix: Use a shared `http.Agent({ keepAlive: true, maxSockets: 4 })` and surface `{status, body}` typed errors so the worker can classify retryable vs fatal (currently all errors bubble as opaque strings to `worker-registry.ts:537`).

8. **[medium] No tool-call format normalization across Ollama/LM Studio/llama.cpp**
   - Evidence: `packages/jarvis-inference/src/runtime.ts:122` (`chatCompletion` only parses `choices[0].message.content`, ignores `tool_calls`/`function_call`); `default-adapter.ts:359` vision path hand-crafts Ollama `images` field but doesn't account for LM Studio's OpenAI-native `image_url` or llama.cpp's mmproj requirement
   - Impact: Any agent expecting structured tool-calls via local models gets empty strings; vision chat silently drops images when routed to LM Studio.
   - Recommended fix: Add a runtime-specific request/response adapter layer (normalize to OpenAI tool-call schema) and a vision-capability check against the loaded mmproj (llama.cpp `/props`).

9. **[medium] No `gguf_dirs` validation — loading any absolute path is permitted**
   - Evidence: `packages/jarvis-dashboard/src/api/runtimes.ts:244-285` (`llamacppLoadModel` accepts `modelPath` from request body, only checks `fs.existsSync`; no path-traversal guard, no size cap, no allow-list check against `config.runtimes.llamacpp.gguf_dirs`)
   - Impact: Authenticated caller can `POST /runtimes/llamacpp/load {model: "C:\\Windows\\System32\\..."}` — llama-server will fail parsing but the arbitrary read/spawn is a sandbox escape vector; also `-ngl 99` is hardcoded and will OOM on CPU-only hosts.
   - Recommended fix: Require `modelPath` to resolve under one of `getGgufDirs()`, reject otherwise; make `-ngl` configurable per model and fall back to 0 on GPU detection failure.

10. **[medium] Deprecated `/api/godmode/legacy` still spawns its own SSE loop with `FALLBACK_LMS_URL`**
    - Evidence: `packages/jarvis-dashboard/src/api/godmode.ts:59,321,378` — hardcoded LM Studio port 1234, ignores `config.llamacpp_url`, `resolveModel` at L67 only handles `ollama`/`lmstudio` (no `llamacpp` branch)
    - Impact: When llama.cpp is the only reachable runtime, legacy godmode returns `Cannot reach LLM` even though the dashboard/daemon successfully answer via the session adapter — undermines the documented rollback path.
    - Recommended fix: Either route legacy through `detectLlm()` with full three-runtime support, or remove the endpoint now that session mode is default (per `CLAUDE.md` Wave 8).

## Positive notes
- Good separation of primary (registry+benchmarks) vs fallback (live discovery) selection paths in `default-adapter.ts:180-204`; evidence-backed selection at `router.ts:172` correctly prefers measured latency over heuristics.
- `chatCompletion` correctly sets `stream:false` and parses OpenAI-compatible responses uniformly (`runtime.ts:122`), making ollama/lmstudio/llamacpp swap-compatible for non-streaming chat.
- `InferenceGovernor.maybeResetDaily` and the llamacpp-as-local accounting (`governance.ts:82,106`) are correct — budget tracking wouldn't be corrupted if finding #5 were fixed.
