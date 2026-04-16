import type { DatabaseSync } from "node:sqlite";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

export function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare(
    "SELECT 1 as found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(tableName) as { found: number } | undefined;
  return row?.found === 1;
}

export function indexExists(db: DatabaseSync, indexName: string): boolean {
  const row = db.prepare(
    "SELECT 1 as found FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1",
  ).get(indexName) as { found: number } | undefined;
  return row?.found === 1;
}

export function columnExists(db: DatabaseSync, tableName: string, columnName: string): boolean {
  if (!tableExists(db, tableName)) return false;
  const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}
