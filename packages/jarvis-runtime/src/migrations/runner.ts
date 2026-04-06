import { DatabaseSync } from "node:sqlite";
import { migration0001 } from "./0001_runtime_core.js";

export type Migration = {
  id: string;        // e.g. "0001"
  name: string;      // e.g. "runtime_core"
  sql: string;       // DDL statements
};

/** All registered migrations in order. Add new migrations to this array. */
const ALL_MIGRATIONS: Migration[] = [
  migration0001,
];

/**
 * Runs pending migrations against the given database.
 *
 * Creates the `schema_migrations` tracking table if it doesn't exist.
 * Each migration runs inside a transaction. If a migration fails, the
 * transaction is rolled back and startup is aborted.
 *
 * Migrations are idempotent: already-applied migrations are skipped.
 */
export function runMigrations(db: DatabaseSync): void {
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

  for (const migration of ALL_MIGRATIONS) {
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
