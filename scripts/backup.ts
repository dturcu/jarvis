/**
 * RT-703: Jarvis backup command.
 *
 * Creates a timestamped backup of all Jarvis state files into
 * ~/.jarvis/backups/jarvis-backup-{YYYY-MM-DD-HHmmss}/.
 *
 * Backed up: config.json, crm.db, knowledge.db, runtime.sqlite, approvals.json (if exists).
 * Excluded:  daemon-status.json (ephemeral), plugins/ (reinstallable), telegram-queue.json (ephemeral).
 *
 * Usage:
 *   npx tsx scripts/backup.ts
 */

import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// ─── Paths ──────────────────────────────────────────────────────────────────

const JARVIS_DIR = join(homedir(), ".jarvis");
const BACKUPS_DIR = join(JARVIS_DIR, "backups");

/** Files to back up (relative to ~/.jarvis/). */
const REQUIRED_FILES = ["config.json", "crm.db", "knowledge.db", "runtime.sqlite"];
/** Optional files — backed up only if they exist. */
const OPTIONAL_FILES = ["approvals.json"];

// ─── Helpers ────────────────────────────────────────────────────────────────

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  console.log("Jarvis Backup");
  console.log("=============\n");

  // Verify ~/.jarvis/ exists
  if (!existsSync(JARVIS_DIR)) {
    console.error(`[FAIL] ${JARVIS_DIR} does not exist. Run 'npx tsx scripts/init-jarvis.ts' first.`);
    process.exit(1);
  }

  // Create backup directory
  const backupName = `jarvis-backup-${timestamp()}`;
  const backupDir = join(BACKUPS_DIR, backupName);
  mkdirSync(backupDir, { recursive: true });

  const backedUp: string[] = [];
  const sizes: Record<string, number> = {};
  let totalSize = 0;

  // Copy required files
  for (const file of REQUIRED_FILES) {
    const src = join(JARVIS_DIR, file);
    if (!existsSync(src)) {
      console.warn(`  [SKIP] ${file} — not found`);
      continue;
    }
    const dest = join(backupDir, file);
    copyFileSync(src, dest);
    const size = statSync(dest).size;
    sizes[file] = size;
    totalSize += size;
    backedUp.push(file);
    console.log(`  [OK]   ${file} (${formatBytes(size)})`);
  }

  // Copy optional files
  for (const file of OPTIONAL_FILES) {
    const src = join(JARVIS_DIR, file);
    if (!existsSync(src)) continue;
    const dest = join(backupDir, file);
    copyFileSync(src, dest);
    const size = statSync(dest).size;
    sizes[file] = size;
    totalSize += size;
    backedUp.push(file);
    console.log(`  [OK]   ${file} (${formatBytes(size)})`);
  }

  if (backedUp.length === 0) {
    console.error("\n[FAIL] No files to back up.");
    process.exit(1);
  }

  // Write manifest
  const manifest = {
    created_at: new Date().toISOString(),
    version: "1",
    files: backedUp,
    sizes,
  };
  writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // Summary
  console.log("\n── Summary ──────────────────────────────────────────────");
  console.log(`  Backup:     ${backupDir}`);
  console.log(`  Files:      ${backedUp.length}`);
  console.log(`  Total size: ${formatBytes(totalSize)}`);
  console.log("  Done.\n");
}

main();
