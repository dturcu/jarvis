# RAG/Knowledge Engineer — Red-team review

Scope: `packages/jarvis-agent-framework/src/*` retrieval/knowledge layer, `scripts/init-jarvis.ts`, knowledge schema at `packages/jarvis-runtime/src/migrations/knowledge_0001_core.ts`, curator prompt, eval harness at `tests/eval/retrieval/retrieval-benchmark.test.ts`.

## Top findings

1. **[High] Brute-force cosine scan over every chunk in the DB — no vector index.**
   - Evidence: `packages/jarvis-agent-framework/src/vector-store.ts:71-121` loads **all** rows and computes cosine in JS on each query; `deserializeEmbedding` copies byte-by-byte (line 268-277).
   - Impact: O(N) per query with per-chunk buffer copy; the file's own comment caps this at ~50k chunks — a single year of meeting minutes will blow through it.
   - Recommended fix: switch to `sqlite-vss`/`sqlite-vec` or pgvector; at minimum use typed-array slicing and do the scan on `Float32Array` directly.

2. **[High] Cross-encoder "re-ranker" is an LLM-per-candidate parse-a-float prompt.**
   - Evidence: `packages/jarvis-agent-framework/src/hybrid-retriever.ts:201-254` sends one chat call per candidate (up to `topK*2`, ~10), parses `parseFloat(result.content.trim())` and silently defaults to `5` on NaN.
   - Impact: slow (serial `await`), expensive, and the default-to-5 fallback means a malformed LLM response quietly pins a bad passage near the top; no true cross-encoder (bge-reranker) is ever called despite `rerankerModel` naming it.
   - Recommended fix: call a real reranker endpoint (Ollama bge-reranker-base or an HTTP rerank service), batch scoring, drop rather than neutralize unparseable scores.

3. **[High] Fire-and-forget auto-embed silently swallows all ingestion failures.**
   - Evidence: `packages/jarvis-agent-framework/src/sqlite-knowledge.ts:99-103` — `.catch(() => {})` on `ingestDocument`.
   - Impact: a document row exists in `documents` but zero chunks in `embedding_chunks`/`fts_chunks`; dense search will never find it and there is no observability to detect the gap. Classic silent-corruption RAG bug.
   - Recommended fix: write a `doc_embed_status` row (pending/failed/ok), emit a metric, and have curator re-queue on startup.

4. **[High] No re-embed on `updateDocument`; stale embeddings persist forever.**
   - Evidence: `packages/jarvis-agent-framework/src/sqlite-knowledge.ts:108-131` updates `documents` but never calls `embeddingPipeline.deleteDocument` + `ingestDocument`. FTS5 row is also never updated.
   - Impact: an ISO 26262 doc edited to reflect an amendment still retrieves the old content via BM25 and old vectors via dense — regulatory-watch's core use case.
   - Recommended fix: on update, delete and re-ingest chunks + FTS row inside the same transaction; version the doc (see #10).

5. **[High] No provenance from retrieved chunk back to source offset — citations impossible.**
   - Evidence: `embedding_chunks` schema at `knowledge_0001_core.ts:115-123` stores only `chunk_text` + `chunk_index`; no `char_start/char_end`, `page_no`, or `source_uri`. `PageExtractor` (`page-extractor.ts`) produces page-level text but the page number is **discarded** before reaching the pipeline — `ingestDocument(docId, text)` takes a single flat string.
   - Impact: agents cannot produce "per ISO 26262 Part 6 clause 6-8, p.42" citations. Evidence-auditor and contract-reviewer (both high-stakes) effectively hallucinate locations.
   - Recommended fix: extend chunk schema with `page_no`, `char_start`, `char_end`, `source_uri`; change `ingestDocument` to accept `PageContent[]`.

6. **[High] FTS5 query rewrite uses `OR` across every term, killing precision.**
   - Evidence: `packages/jarvis-agent-framework/src/sparse-store.ts:55-59` — `.split(/\s+/).join(" OR ")` (note: `SqliteKnowledgeStore.search` at `sqlite-knowledge.ts:165` does the same). BM25 then ranks anything that matches any term.
   - Impact: a query like `ASIL-D MC/DC coverage` matches any doc containing "coverage" — explains why sparse hit_rate thresholds in the benchmark are only 0.15 (`retrieval-benchmark.test.ts:101-117`).
   - Recommended fix: use FTS5 implicit AND (no operator), optionally fall back to OR only when zero results; add `NEAR`/phrase handling and support for hyphenated ISO terms.

7. **[High] RRF fusion key is first-80-chars of text, not chunk ID — dense and sparse never correlate.**
   - Evidence: `sparse-store.ts:131,143`: `const key = '${item.docId}::${item.text.slice(0, 80)}'`. Chunk text is identical only if both stores return literally the same first 80 chars; the pipeline generates separate `chunkIds` for the two stores (`embedding-pipeline.ts:90,101-107`) and vector search returns untrimmed text vs FTS returning the stored snippet — collisions are accidental.
   - Impact: RRF degrades to "union" rather than "fusion"; the claimed cross-signal boost rarely fires, hybrid gains little over sparse.
   - Recommended fix: share a single `chunk_id` across both stores and key RRF on `docId::chunk_id`.

8. **[Medium] Entity resolution is case-insensitive name match only; no fuzzy/embed-based merge, no confidence threshold.**
   - Evidence: `sqlite-entity-graph.ts:83-84` — `LOWER(name) = LOWER(?)`. No Levenshtein, no domain aliases (e.g. "Volvo AB" vs "Volvo Cars"), no German umlaut normalization. `canonical_key` is the only dedup lever but nothing populates it systematically — `lesson-capture.ts`, `sqlite-knowledge.ts` never compute one.
   - Impact: "Bosch GmbH", "Bosch", "bosch" become three entities; the advertised graph boost (`hybrid-retriever.ts:287 GRAPH_BOOST=1.2`) misses half its targets.
   - Recommended fix: NFKC normalize, strip legal suffixes, optional embedding-based alias merge with a ≥0.9 cosine threshold; record merges to `canonical_aliases`.

9. **[Medium] Chunking is word-count approximation ignoring token boundaries and headings.**
   - Evidence: `vector-store.ts:166-220` — 500 "tokens" via `words * 0.75`; no Markdown/heading awareness, no table preservation, no chunk-boundary at section breaks. Sentence split uses `/(?<=[.!?])\s+/` which breaks on "ISO 26262." and "HARA. "
   - Impact: mid-clause splits on regulatory text; ASPICE/ISO section structure lost. German sentences with abbreviations ("z.B.", "Abs.") also mis-split.
   - Recommended fix: use a real tokenizer (tiktoken wasm / `@xenova/transformers` tokenizer) sized to the actual embedding model; preserve Markdown headings as chunk prefixes.

10. **[Medium] "Never delete knowledge — mark as superseded" is policy, not implemented.**
    - Evidence: curator prompt at `packages/jarvis-agents/src/prompts/knowledge-curator-system.md:23` states the rule; `sqlite-knowledge.ts:219-230` hard-deletes rows; no `superseded_by` / `valid_from` / `valid_to` columns in `knowledge_0001_core.ts:13-23`.
    - Impact: regulatory-watch captures an ISO update → old version is destroyed → cannot answer "what did the standard say when we signed the NDA in 2024?" — a hard requirement for ISO 26262 tool qualification.
    - Recommended fix: add `version`, `superseded_by`, `status`; make "delete" a soft tombstone; restrict hard-delete to curator admin only.

11. **[Medium] `LessonCapture` writes a lesson for every completed step — unbounded and low-signal.**
    - Evidence: `lesson-capture.ts:109-128` emits one `addDocument` call per non-pending `decision` per run. No dedup, no quality gate, no `use_count` feedback loop.
    - Impact: `lessons` collection floods with "Step 3: query_db — outcome: ok" entries; LessonInjector (`lesson-injector.ts:90-118`) retrieves noise; the 500-entry memory cap in `memory.ts:62-69` is per-process so nothing actually bounds the lesson DB.
    - Recommended fix: capture only `severity != observation` by default; add a periodic LLM-based summarizer that merges lessons and demotes stale ones; wire `playbook.use_count` into retrieval scoring.

12. **[Medium] Vision processor returns hard-coded confidence 0.8/0.7; OCR text never flows into the chunk index.**
    - Evidence: `vision-processor.ts:127,170` — `confidence: 0.8` / `0.7` literals; `PageExtractor` flags `needsVision` (`page-extractor.ts:105-108`) but no call site wires the OCR output back into `ingestDocument`.
    - Impact: scanned ISO 26262 PDFs are "detected" as needing vision but content stays unsearchable; compliance-marker JSON is parsed via regex `/\[[\s\S]*\]/` which is brittle against markdown code fences.
    - Recommended fix: wire `PageExtractor.needsVision → VisionProcessor.ocrPage → EmbeddingPipeline.ingestDocument` in the document plugin; compute confidence from log-probs or length heuristics; use JSON-mode or a schema-constrained parser.

13. **[Low] No dimension check between query embedding and stored chunks.**
    - Evidence: `vector-store.ts:228-233` throws on dim mismatch inside the loop; but there is no startup assertion that the configured `embeddingModel` matches what was used at ingest. Switching models silently corrupts results per-chunk until everything is re-indexed.
    - Recommended fix: store `embedding_model` and `dim` on each chunk row; refuse retrieval if mismatch, surface a migration task.

14. **[Low] Retrieval eval harness only measures sparse, never hybrid or dense.**
    - Evidence: `tests/eval/retrieval/retrieval-benchmark.test.ts` — entire file indexes BM25 only; the comment at line 127 admits "Hybrid target: MRR ≥ 0.7" but no test enforces it. No NDCG, no MAP, no per-domain regression gate.
    - Impact: changes to chunking/fusion can regress hybrid quality undetected. Benchmark thresholds (`hit_rate ≥ 0.15`) are so low they rubber-stamp almost anything.
    - Recommended fix: mock `EmbedFn` with a deterministic hash embedding for CI (small but consistent); add NDCG@10; raise thresholds per domain with a hybrid target of 0.7+ hit_rate.

## Positive notes

- **Entity provenance table is real.** `entity_provenance` (`knowledge_0001_core.ts:72-83`) + atomic upsert+provenance in `sqlite-entity-graph.ts:38-47` is the single strongest piece of the stack — most shops skip this.
- **Collection/wiki firewall for compliance data is explicit and correct.** `wiki-bridge.ts:67-71` hard-blocks `contracts/iso26262/aspice/cybersecurity/signed_records` from ever reaching the wiki surface, with a thrown error on misuse.
- **RRF with sensible k=60 default and dual-store design** (`sparse-store.ts:121-156`) is the right architectural choice; the implementation bugs above are fixable without reshuffling the pipeline.
- **HMAC-chained provenance traces for high-stakes jobs** (`0009_provenance.ts`) give tool-qualification auditors something real to point at.