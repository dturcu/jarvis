/**
 * Jarvis initialization script.
 *
 * Creates ~/.jarvis/ directory and initializes the CRM, Knowledge, and Runtime
 * SQLite databases via the migration runner. Does NOT seed demo data.
 *
 * Idempotent — if databases already exist, applies any pending migrations.
 *
 * Usage:
 *   npx tsx scripts/init-jarvis.ts
 *
 * To populate demo data after initialization:
 *   npm run seed:demo
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
} from "../packages/jarvis-runtime/src/migrations/runner.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

const JARVIS_DIR = join(homedir(), ".jarvis");
const CRM_DB_PATH = join(JARVIS_DIR, "crm.db");
const KNOWLEDGE_DB_PATH = join(JARVIS_DIR, "knowledge.db");
const RUNTIME_DB_PATH = join(JARVIS_DIR, "runtime.db");

// ─── Database Initialization ────────────────────────────────────────────────

function initDatabase(
  label: string,
  dbPath: string,
  migrations: import("../packages/jarvis-runtime/src/migrations/runner.js").Migration[],
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

async function main(): Promise<void> {
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

  // Generate API token if none exists — secure by default
  const configPath = join(JARVIS_DIR, "config.json");
  let tokenGenerated = false;
  try {
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      const { readFileSync } = await import("node:fs");
      config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    }
    if (!config.api_token && !config.api_tokens && !process.env.JARVIS_API_TOKEN) {
      const { randomBytes } = await import("node:crypto");
      const { writeFileSync } = await import("node:fs");
      const token = randomBytes(32).toString("hex");
      config.api_token = token;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      tokenGenerated = true;
      console.log(`\n  [created] API token: ${token.slice(0, 8)}...${token.slice(-4)}`);
      console.log(`  Saved to ${configPath}`);
      console.log(`  Use as: Authorization: Bearer ${token}`);
    }
  } catch (e) {
    console.warn(`  [warning] Could not generate API token: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log("\n── Summary ──────────────────────────────────────────────");
  console.log(`  Directory:    ${JARVIS_DIR}`);
  console.log(`  CRM DB:       ${crmCreated ? "CREATED" : "already existed"}`);
  console.log(`  Knowledge DB: ${knowledgeCreated ? "CREATED" : "already existed"}`);
  console.log(`  Runtime DB:   ${runtimeCreated ? "CREATED" : "already existed"}`);
  console.log(`  API Token:    ${tokenGenerated ? "GENERATED (saved to config.json)" : "already configured"}`);
  console.log(`\n  Databases initialized. Run 'npm run seed:demo' to populate demo data.\n`);
}

main().catch(e => {
  console.error("Init error:", e);
  process.exitCode = 1;
});
