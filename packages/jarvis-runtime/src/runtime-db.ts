import { DatabaseSync } from "node:sqlite";
import { RUNTIME_DB_PATH } from "./config.js";
import { runMigrations } from "./migrations/runner.js";

/**
 * Opens (or creates) the runtime control-plane database.
 *
 * Enables WAL mode and foreign keys, then runs any pending migrations.
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
  return db;
}
