/**
 * Run pending database migrations.
 *
 * Usage: jarvis migrate
 */

import { openRuntimeDb } from "./runtime-db.js";

function main() {
  console.log("Running pending migrations...");
  try {
    const db = openRuntimeDb();
    const rows = db.prepare(
      "SELECT name, applied_at FROM schema_migrations ORDER BY applied_at",
    ).all() as Array<{ name: string; applied_at: string }>;

    console.log(`\n  ${rows.length} migration(s) applied:\n`);
    for (const row of rows) {
      console.log(`    ${row.name} — ${row.applied_at}`);
    }
    console.log("");

    db.close();
  } catch (e) {
    console.error(`Migration error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

main();
