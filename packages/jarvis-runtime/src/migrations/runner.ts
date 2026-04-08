import { DatabaseSync } from "node:sqlite";
import { migration0001 } from "./0001_runtime_core.js";
import { migration0002 } from "./0002_production_fixes.js";
import { migration0003 } from "./0003_channel_persistence.js";
import { migration0004 } from "./0004_channel_fixes.js";
import { migration0005 } from "./0005_knowledge_links.js";
import { migration0006 } from "./0006_team_mode.js";
import { migration0007 } from "./0007_channel_full_content.js";
import { migration0008 } from "./0008_channel_model.js";
import { crmMigration0001 } from "./crm_0001_core.js";
import { knowledgeMigration0001 } from "./knowledge_0001_core.js";

// ─── Schema Ownership (#56) ─────────────────────────────────────────────────
// Tables are split across three SQLite databases, each owning a distinct plane.
//
// Control plane — runtime.db
//   runs, run_events, agent_commands, approvals, notifications,
//   daemon_heartbeats, schedules, settings, model_registry, model_benchmarks,
//   plugin_installs, audit_log, schema_migrations, channel_threads,
//   channel_messages, artifact_deliveries, delivery_attempts
//
// Knowledge plane — knowledge.db
//   documents, playbooks, entities, relations, decisions,
//   entity_provenance, memory, embedding_chunks
//
// CRM plane — crm.db
//   contacts, notes, pipeline_stages, campaigns
// ─────────────────────────────────────────────────────────────────────────────

export type Migration = {
  id: string;        // e.g. "0001"
  name: string;      // e.g. "runtime_core"
  sql: string;       // DDL statements
};

/** Runtime DB migrations — control plane tables. */
export const RUNTIME_MIGRATIONS: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
];

/** CRM DB migrations — contacts, notes, stages, campaigns. */
export const CRM_MIGRATIONS: Migration[] = [
  crmMigration0001,
];

/** Knowledge DB migrations — documents, playbooks, entities, decisions, memory, vectors. */
export const KNOWLEDGE_MIGRATIONS: Migration[] = [
  knowledgeMigration0001,
];

/**
 * Runs pending migrations against the given database.
 *
 * Creates the `schema_migrations` tracking table if it doesn't exist.
 * Each migration runs inside a transaction. If a migration fails, the
 * transaction is rolled back and startup is aborted.
 *
 * Migrations are idempotent: already-applied migrations are skipped.
 *
 * @param db - The database to migrate.
 * @param migrations - Migration list to apply. Defaults to RUNTIME_MIGRATIONS for backward compat.
 */
export function runMigrations(db: DatabaseSync, migrations: Migration[] = RUNTIME_MIGRATIONS): void {
  // Create tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      checksum TEXT
    )
  `);

  const applied = new Set<string>();
  const rows = db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>;
  for (const row of rows) {
    applied.add(row.id);
  }

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (id, name, applied_at, checksum) VALUES (?, ?, ?, ?)",
      ).run(
        migration.id,
        migration.name,
        new Date().toISOString(),
        simpleChecksum(migration.sql),
      );
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* best-effort rollback */ }
      throw new Error(
        `Migration ${migration.id}_${migration.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** Simple hash for migration checksum — not cryptographic, just change detection. */
function simpleChecksum(sql: string): string {
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    hash = ((hash << 5) - hash + sql.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}
