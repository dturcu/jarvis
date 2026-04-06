/**
 * RT-704: Jarvis restore command.
 *
 * Restores a Jarvis backup created by backup.ts.
 *
 * Usage:
 *   npx tsx scripts/restore.ts ~/.jarvis/backups/jarvis-backup-2024-01-01-120000
 */

import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Paths ──────────────────────────────────────────────────────────────────

const JARVIS_DIR = join(homedir(), ".jarvis");

// ─── Types ──────────────────────────────────────────────────────────────────

interface BackupManifest {
  created_at: string;
  version: string;
  files: string[];
  sizes: Record<string, number>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  console.log("Jarvis Restore");
  console.log("==============\n");

  // Parse arguments
  const backupDir = process.argv[2];
  if (!backupDir) {
    console.error("Usage: npx tsx scripts/restore.ts <backup-path>");
    console.error("Example: npx tsx scripts/restore.ts ~/.jarvis/backups/jarvis-backup-2024-01-01-120000");
    process.exit(1);
  }

  // Verify backup directory exists
  if (!existsSync(backupDir)) {
    console.error(`[FAIL] Backup directory not found: ${backupDir}`);
    process.exit(1);
  }

  // Read manifest
  const manifestPath = join(backupDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`[FAIL] manifest.json not found in backup: ${manifestPath}`);
    process.exit(1);
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  } catch (err) {
    console.error(`[FAIL] Could not parse manifest.json: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`  Backup created: ${manifest.created_at}`);
  console.log(`  Manifest version: ${manifest.version}`);
  console.log(`  Files in backup: ${manifest.files.length}\n`);

  // Validate all files exist in backup
  const missing: string[] = [];
  for (const file of manifest.files) {
    if (!existsSync(join(backupDir, file))) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    console.error("[FAIL] Missing files in backup:");
    for (const f of missing) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  // Verify ~/.jarvis/ exists
  if (!existsSync(JARVIS_DIR)) {
    console.error(`[FAIL] ${JARVIS_DIR} does not exist. Run 'npx tsx scripts/init-jarvis.ts' first.`);
    process.exit(1);
  }

  // Print restore plan
  console.log("  Restoring files (will overwrite current):");
  for (const file of manifest.files) {
    const src = join(backupDir, file);
    const size = statSync(src).size;
    const dest = join(JARVIS_DIR, file);
    const exists = existsSync(dest);
    console.log(`  ${exists ? "[OVERWRITE]" : "[CREATE]   "} ${file} (${formatBytes(size)})`);
  }

  // Perform restore
  console.log("");
  let totalSize = 0;
  for (const file of manifest.files) {
    const src = join(backupDir, file);
    const dest = join(JARVIS_DIR, file);
    copyFileSync(src, dest);
    totalSize += statSync(dest).size;
    console.log(`  [OK] ${file}`);
  }

  // Summary
  console.log("\n── Summary ──────────────────────────────────────────────");
  console.log(`  Restored from: ${backupDir}`);
  console.log(`  Files:         ${manifest.files.length}`);
  console.log(`  Total size:    ${formatBytes(totalSize)}`);
  console.log("  Done.\n");
}

main();
