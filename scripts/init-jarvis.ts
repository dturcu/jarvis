/**
 * Jarvis initialization script — production bootstrap.
 *
 * Creates ~/.jarvis/ directory and initializes the CRM, Knowledge, and Runtime
 * SQLite databases via the migration runner. Also initializes the state
 * persistence database.
 *
 * No demo data is seeded here. For demo data, run:
 *   npx tsx scripts/seed-demo.ts
 *
 * Idempotent — if databases already exist, applies any pending migrations.
 *
 * Usage:
 *   npx tsx scripts/init-jarvis.ts
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  runMigrations,
  RUNTIME_MIGRATIONS,
  CRM_MIGRATIONS,
  KNOWLEDGE_MIGRATIONS,
  type Migration,
} from "../packages/jarvis-runtime/src/migrations/runner.js";
import { configureJarvisStatePersistence } from "../packages/jarvis-shared/src/state.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

export const JARVIS_DIR = join(homedir(), ".jarvis");
export const CRM_DB_PATH = join(JARVIS_DIR, "crm.db");
export const KNOWLEDGE_DB_PATH = join(JARVIS_DIR, "knowledge.db");
export const RUNTIME_DB_PATH = join(JARVIS_DIR, "runtime.db");
export const STATE_DB_PATH = join(JARVIS_DIR, "state.sqlite");

// ─── Database Initialization ────────────────────────────────────────────────

export function initDatabase(
  label: string,
  dbPath: string,
  migrations: Migration[],
): boolean {
  const isNew = !existsSync(dbPath);

  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");

    runMigrations(db, migrations);

    const applied = db.prepare("SELECT COUNT(*) as n FROM schema_migrations").get() as { n: number };
    console.log(`  [${isNew ? "created" : "updated"}] ${label} database: ${dbPath} (${applied.n} migration(s))`);
  } finally {
    db.close();
  }
  return isNew;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  console.log("Jarvis initialization");
  console.log("=====================\n");

  // Ensure ~/.jarvis/ exists
  if (!existsSync(JARVIS_DIR)) {
    mkdirSync(JARVIS_DIR, { recursive: true });
    console.log(`  [created] ${JARVIS_DIR}\n`);
  } else {
    console.log(`  [exists]  ${JARVIS_DIR}\n`);
  }

  const crmCreated = initDatabase("CRM", CRM_DB_PATH, CRM_MIGRATIONS);
  const knowledgeCreated = initDatabase("Knowledge", KNOWLEDGE_DB_PATH, KNOWLEDGE_MIGRATIONS);
  const runtimeCreated = initDatabase("Runtime", RUNTIME_DB_PATH, RUNTIME_MIGRATIONS);

  // Initialize state persistence database
  configureJarvisStatePersistence({ databasePath: STATE_DB_PATH });
  const stateIsNew = !existsSync(STATE_DB_PATH);
  console.log(`  [${stateIsNew ? "created" : "updated"}] State database: ${STATE_DB_PATH}`);

  console.log("\n── Summary ──────────────────────────────────────────────");
  console.log(`  Directory:    ${JARVIS_DIR}`);
  console.log(`  CRM DB:       ${crmCreated ? "CREATED" : "already existed"}`);
  console.log(`  Knowledge DB: ${knowledgeCreated ? "CREATED" : "already existed"}`);
  console.log(`  Runtime DB:   ${runtimeCreated ? "CREATED" : "already existed"}`);
  console.log(`  State DB:     ${STATE_DB_PATH}`);
  console.log("  Done.\n");
}

main();
