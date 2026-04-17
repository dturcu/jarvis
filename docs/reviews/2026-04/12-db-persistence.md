# Database/Persistence Engineer — Red-team review

Scope: runtime.db / crm.db / knowledge.db schema, migration runner, transaction discipline, connection handling, backup/restore, retention. Based on `packages/jarvis-runtime/src/migrations/*`, `runtime-db.ts`, `sqlite-*.ts`, `dashboard/src/api/backup.ts`, `scripts/init-jarvis.ts`.

## Top findings

1. **[high] Connection fan-out: dozens of new `DatabaseSync` handles per request, most without WAL/busy_timeout**
   - Evidence: 40+ `new DatabaseSync(...)` call sites in `packages/jarvis-dashboard/src/api/*.ts` (e.g. `approvals.ts:11`, `entities.ts:8`, `crm.ts:9`, `knowledge.ts:8`, `analytics.ts:7`, `eval.ts:9`, `middleware/audit.ts:14`). Only a handful (`runs.ts:9-13`, `backup.ts:189`, `safemode.ts`) set `PRAGMA busy_timeout`; none re-enable `foreign_keys = ON` per handle (it is connection-scoped, not persisted).
   - Impact: under light concurrency (daemon writes + dashboard reads), readers hit `SQLITE_BUSY` with a 0 ms default timeout → flaky 500s; FK constraints silently skipped on dashboard-initiated writes.
   - Fix: centralize a `getRuntimeDb()/getCrmDb()/getKnowledgeDb()` helper that sets `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON` once per handle and is reused across routes.

2. **[high] Hot backup produces an inconsistent set across the three databases**
   - Evidence: `backup.ts:39-54` runs `VACUUM INTO` sequentially on runtime.db → crm.db → knowledge.db with no coordinating snapshot boundary. A run that writes to runtime.db (`run_events`) *and* knowledge.db (`decisions`) between the two `VACUUM INTO` calls produces a backup where the decision exists but its originating run does not.
   - Impact: restores cannot reconstruct cross-DB invariants (run → decision → entity → provenance). Silent partial integrity loss.
   - Fix: either (a) quiesce writes via a lease/pause signal on the daemon before snapshotting, or (b) collapse to a single DB and use one `VACUUM INTO` / `sqlite3_backup_init` per backup. Document cross-DB consistency as best-effort until then.

3. **[high] Migration 0001 is not idempotent on partially-initialized DBs**
   - Evidence: `0001_runtime_core.ts:15,33,50,…` uses bare `CREATE TABLE` (no `IF NOT EXISTS`, no `isApplied` predicate). `crm_0001_core.ts` and `knowledge_0001_core.ts` do use `IF NOT EXISTS`. If `schema_migrations` is ever lost, truncated, or the DB file is replaced out-of-band, re-running 0001 aborts the entire boot sequence.
   - Impact: recovery from a corrupted tracking table requires manual SQL; every rerun blocks daemon startup.
   - Fix: add `IF NOT EXISTS` to every `CREATE TABLE/INDEX` in 0001 (matching the convention already used in 0003+), or add an `isApplied` that checks for `approvals` table presence.

4. **[high] API token is stored in plaintext JSON with no OS-level protection on Windows**
   - Evidence: `scripts/init-jarvis.ts:87-95` writes `config.api_token = randomBytes(32)` to `~/.jarvis/config.json` with default fs permissions. `doctor.ts:448-451` explicitly skips permission checks on `win32` ("not meaningful on Windows"). No DPAPI / keychain integration anywhere in the tree.
   - Impact: any local process/user on the Windows appliance reads the admin bearer token; also ends up in backup archives and in `config.json`-style diagnostic dumps.
   - Fix: on Windows use DPAPI (`CryptProtectData`) or Credential Manager; on POSIX call `fs.chmodSync(configPath, 0o600)` on write and verify on read. Redact `api_token` / `api_tokens` / `*_secret` / `refresh_token` fields before writing to backups.

5. **[medium] Foreign-key design is inconsistent — integrity enforcement is partial at best**
   - Evidence: `0011_jobs_table.ts:20` declares `FOREIGN KEY (run_id) REFERENCES runs(run_id)` but `run_events`, `approvals`, `agent_commands`, `artifact_deliveries`, `audit_log`, `provenance_traces` have `run_id`/`agent_id` columns with **no FK**. Cross-DB references (decisions.run_id → runtime.runs) cannot be FK-enforced by SQLite anyway. No `ON DELETE` clauses anywhere — a deleted run leaves orphan events, approvals, jobs.
   - Impact: orphaned rows accumulate; dashboard shows approvals pointing to runs that no longer exist; cascade behavior is undocumented.
   - Fix: pick a policy per table (`ON DELETE SET NULL` for audit-preservation tables, `ON DELETE CASCADE` for derived tables like `run_events`) and apply uniformly; document cross-DB references as logical-only with a periodic reconciliation job.

6. **[medium] Retention is implemented for run_events but missing for audit_log, decisions, provenance_traces, notifications, entity_provenance, embedding_chunks**
   - Evidence: `run-store.ts:285-291` compacts `run_events` at 90 days (called from `daemon.ts:602`). `doctor.ts:502-524` merely *warns* at 500 MB. No retention for `audit_log` (written from 6+ sites), `notifications`, `decisions`, `embedding_chunks`, `entity_provenance`, `provenance_traces`, or `canonical_aliases`.
   - Impact: unbounded growth; `audit_log` and `embedding_chunks` are write-heavy and will dominate the DB within months.
   - Fix: add configurable retention per table with sane defaults (audit_log 365d, notifications 30d delivered, provenance retained indefinitely but moved to archive DB > 1yr, decisions keep indefinitely but cap `entity_provenance` at 180d).

7. **[medium] `PRAGMA integrity_check` and `VACUUM` are never run on a schedule**
   - Evidence: `integrity_check` appears only in `backup.ts:254` (post-restore) and `repair.ts:94`. `daemon.ts:610` runs `PRAGMA incremental_vacuum(100)` daily — but that only frees pages if `auto_vacuum=INCREMENTAL` was set at DB creation, and no migration sets `auto_vacuum`. Full `VACUUM` is only mentioned as a suggestion in doctor output.
   - Impact: fragmentation unbounded; latent corruption goes undetected until a restore.
   - Fix: enable `PRAGMA auto_vacuum = INCREMENTAL` at DB creation (requires VACUUM on existing DBs — do it as a one-shot maintenance migration), add a weekly `integrity_check` job that writes results to `settings`.

8. **[medium] Restore allowlist includes WAL/SHM sidecars but backup intentionally omits them — restore can mix states**
   - Evidence: `backup.ts:15` defines `WAL_SIDECARS`; `backup.ts:55-56` correctly skips them (because `VACUUM INTO` produces standalone files). But `backup.ts:158` puts them back in `ALLOWED_RESTORE`, and `backup.ts:167-172` marks them as "missing" only if a manifest entry names them. An old backup that *did* include WAL files would be accepted and restored, pairing a fresh DB with a stale WAL.
   - Impact: rare but catastrophic — post-restore DB returns stale rows or throws malformed-database errors.
   - Fix: remove WAL/SHM from the restore allowlist entirely; the `VACUUM INTO` output never needs them. Delete any stray `*-wal`/`*-shm` in `JARVIS_DIR` before copying the snapshot in.

9. **[low] Migration checksum is never verified — hash stored but not checked**
   - Evidence: `runner.ts:121-127` computes `simpleChecksum(sql)` and stores it (`insertMigrationRow`). Nothing ever reads it back to detect in-place edits to applied migrations. A dev who edits `0005_knowledge_links.ts` after deploy gets silently different DBs across environments.
   - Fix: on boot, compare `schema_migrations.checksum` to current migration SQL; log/fail if drifted.

10. **[low] No downgrade/rollback path; `release-metadata.rollback_safe = true` is aspirational**
    - Evidence: `release-metadata.ts:37` hard-codes `rollback_safe: true` with no per-migration `down` SQL anywhere in the tree. Migration 0002 drops `model_registry` after copying to `_v2` — unrecoverable without a backup.
    - Impact: a botched production upgrade has no procedure except "restore from backup"; roadmap implies rollback capability that does not exist.
    - Fix: either add `down` SQL per migration and document the path, or change `rollback_safe` to `false` and document backup-then-restore as the only rollback.

## Positive notes

- **Transactional write paths in `run-store.ts` are exemplary**: `BEGIN IMMEDIATE` around compound writes (`run-store.ts:62-81, 102-153`) with explicit rollback on error, re-reading status inside the transaction to close TOCTOU windows. This discipline should be the template for `approval-bridge`, `campaign-store`, and dashboard routes that currently do bare prepares.
- **Clean schema-ownership split** (`runner.ts:17-32`): runtime/knowledge/CRM separation is documented at the top of the runner and enforced by separate migration arrays — makes the eventual Postgres/multi-user migration tractable.
- **Post-restore health validation with rollback** (`backup.ts:244-305`) is better than most hobby projects — integrity check, pre-restore snapshot, automatic rollback on failure, audit log of the rollback. Wire the same path into scheduled integrity checks and this becomes production-grade.
