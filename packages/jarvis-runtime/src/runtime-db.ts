import { DatabaseSync } from "node:sqlite";
import { RUNTIME_DB_PATH } from "./config.js";
import { runMigrations } from "./migrations/runner.js";
import { persistRelease, verifyMigrationConsistency } from "./release-metadata.js";

/**
 * Opens (or creates) the runtime control-plane database.
 *
 * Enables WAL mode and foreign keys, runs any pending migrations,
 * persists the current release version, and verifies migration consistency.
 * Throws with a clear message if the DB cannot be opened.
 */
export function openRuntimeDb(dbPath: string = RUNTIME_DB_PATH): DatabaseSync {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath);
  } catch (err) {
    throw new Error(
      `Failed to open runtime database at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  runMigrations(db);
  persistRelease(db);

  const missing = verifyMigrationConsistency(db);
  if (missing.length > 0) {
    console.warn(`Release metadata: ${missing.length} expected migration(s) not applied: ${missing.join(", ")}`);
  }

  return db;
}
