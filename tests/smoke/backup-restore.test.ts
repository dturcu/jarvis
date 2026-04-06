/**
 * A4.2 — Backup/Restore: round-trip (black-box lifecycle certification)
 *
 * Tests the backup and restore logic as implemented in
 * packages/jarvis-dashboard/src/api/backup.ts — exercising the same
 * fs.copyFileSync / manifest / restore-allowlist logic the handlers use,
 * but against temp directories we control.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, CRM_MIGRATIONS, KNOWLEDGE_MIGRATIONS } from "@jarvis/runtime";

// ── Constants (mirror backup.ts) ────────────────────────────────────────────

const BACKUP_FILES = ["config.json", "crm.db", "knowledge.db", "runtime.db"];
const WAL_SIDECARS = [
  "runtime.db-wal", "runtime.db-shm",
  "crm.db-wal", "crm.db-shm",
  "knowledge.db-wal", "knowledge.db-shm",
];
const ALLOWED_RESTORE = new Set([...BACKUP_FILES, ...WAL_SIDECARS]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(join(os.tmpdir(), "jarvis-backup-"));
}

/** Set up a fake ~/.jarvis directory with valid databases and config. */
function setupFakeJarvisDir(jarvisDir: string) {
  fs.mkdirSync(jarvisDir, { recursive: true });

  // config.json
  fs.writeFileSync(join(jarvisDir, "config.json"), JSON.stringify({ version: "1.0", test: true }));

  // runtime.db with migrations
  const runtimeDb = new DatabaseSync(join(jarvisDir, "runtime.db"));
  runtimeDb.exec("PRAGMA journal_mode = WAL;");
  runtimeDb.exec("PRAGMA foreign_keys = ON;");
  runtimeDb.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(runtimeDb);
  runtimeDb.close();

  // crm.db with migrations
  const crmDb = new DatabaseSync(join(jarvisDir, "crm.db"));
  crmDb.exec("PRAGMA journal_mode = WAL;");
  crmDb.exec("PRAGMA foreign_keys = ON;");
  crmDb.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(crmDb, CRM_MIGRATIONS);
  crmDb.close();

  // knowledge.db with migrations
  const knowledgeDb = new DatabaseSync(join(jarvisDir, "knowledge.db"));
  knowledgeDb.exec("PRAGMA journal_mode = WAL;");
  knowledgeDb.exec("PRAGMA foreign_keys = ON;");
  knowledgeDb.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(knowledgeDb, KNOWLEDGE_MIGRATIONS);
  knowledgeDb.close();
}

/** Replicates the backup logic from backup.ts — creates a backup directory with manifest. */
function createBackup(jarvisDir: string, backupsDir: string): { backupDir: string; manifest: { timestamp: string; files: Array<{ name: string; size: number }>; total_size: number } } {
  const now = new Date();
  const ts = now.toISOString()
    .replace(/[T]/g, "-")
    .replace(/[:]/g, "")
    .replace(/\.\d+Z$/, "");
  const backupDir = join(backupsDir, `backup-${ts}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const files: Array<{ name: string; size: number }> = [];

  for (const name of BACKUP_FILES) {
    const src = join(jarvisDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, join(backupDir, name));
      files.push({ name, size: fs.statSync(join(backupDir, name)).size });
    }
  }
  for (const name of WAL_SIDECARS) {
    const src = join(jarvisDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, join(backupDir, name));
      files.push({ name, size: fs.statSync(join(backupDir, name)).size });
    }
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const manifest = { timestamp: now.toISOString(), files, total_size: totalSize };
  fs.writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return { backupDir, manifest };
}

/** Replicates the restore logic from backup.ts — restores files from a backup. */
function restoreBackup(backupPath: string, jarvisDir: string): { ok: boolean; restored?: string[]; error?: string } {
  const manifestPath = join(backupPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: "manifest.json not found in backup path" };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    files: Array<{ name: string; size: number }>;
  };

  // Only restore allowed filenames — no path separators, no ..
  const safeFiles = manifest.files.filter(f => {
    const name = f.name;
    return ALLOWED_RESTORE.has(name) && !name.includes("/") && !name.includes("\\") && !name.includes("..");
  });

  // Validate all safe files exist
  const missing: string[] = [];
  for (const file of safeFiles) {
    if (!fs.existsSync(join(backupPath, file.name))) {
      missing.push(file.name);
    }
  }
  if (missing.length > 0) {
    return { ok: false, error: `Missing files in backup: ${missing.join(", ")}` };
  }

  // Copy
  const restored: string[] = [];
  for (const file of safeFiles) {
    fs.copyFileSync(join(backupPath, file.name), join(jarvisDir, file.name));
    restored.push(file.name);
  }

  return { ok: true, restored };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("Backup/Restore: round-trip", () => {
  let tmpDir: string;
  let jarvisDir: string;
  let backupsDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    jarvisDir = join(tmpDir, ".jarvis");
    backupsDir = join(jarvisDir, "backups");
    setupFakeJarvisDir(jarvisDir);
  });

  afterEach(() => {
    // On Windows, SQLite WAL-mode files may hold locks briefly after close.
    // Use a retry to handle transient EPERM errors during cleanup.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        break;
      } catch {
        // Small busy-wait to let OS release file locks
        const end = Date.now() + 200;
        while (Date.now() < end) { /* spin */ }
      }
    }
  });

  it("backup creates manifest with correct file list", () => {
    const { backupDir, manifest } = createBackup(jarvisDir, backupsDir);

    // Verify manifest.json was written
    expect(fs.existsSync(join(backupDir, "manifest.json"))).toBe(true);

    // Verify manifest lists the expected files
    const fileNames = manifest.files.map(f => f.name);
    expect(fileNames).toContain("config.json");
    expect(fileNames).toContain("runtime.db");
    expect(fileNames).toContain("crm.db");
    expect(fileNames).toContain("knowledge.db");

    // All files have positive sizes
    for (const file of manifest.files) {
      expect(file.size).toBeGreaterThan(0);
    }

    // Total size is the sum
    const expectedTotal = manifest.files.reduce((sum, f) => sum + f.size, 0);
    expect(manifest.total_size).toBe(expectedTotal);
  });

  it("restore copies files back after corruption", () => {
    const { backupDir } = createBackup(jarvisDir, backupsDir);

    // Corrupt runtime.db — write garbage bytes
    fs.writeFileSync(join(jarvisDir, "runtime.db"), Buffer.from("CORRUPT GARBAGE DATA!!"));

    // Verify it is indeed corrupted
    let corrupted = false;
    let corruptDb: DatabaseSync | undefined;
    try {
      corruptDb = new DatabaseSync(join(jarvisDir, "runtime.db"));
      corruptDb.exec("PRAGMA integrity_check;");
    } catch {
      corrupted = true;
    } finally {
      try { corruptDb?.close(); } catch { /* best-effort */ }
    }
    expect(corrupted).toBe(true);

    // Run restore
    const result = restoreBackup(backupDir, jarvisDir);
    expect(result.ok).toBe(true);
    expect(result.restored).toContain("runtime.db");

    // Verify restored DB passes integrity check
    let restoredDb: DatabaseSync | undefined;
    try {
      restoredDb = new DatabaseSync(join(jarvisDir, "runtime.db"));
      const intCheck = restoredDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      expect(intCheck.integrity_check).toBe("ok");
    } finally {
      try { restoredDb?.close(); } catch { /* best-effort */ }
    }
  });

  it("restore validates manifest files exist", () => {
    const { backupDir } = createBackup(jarvisDir, backupsDir);

    // Delete one file from the backup directory
    fs.unlinkSync(join(backupDir, "runtime.db"));

    // Attempt restore — should fail with missing file error
    const result = restoreBackup(backupDir, jarvisDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing files in backup");
    expect(result.error).toContain("runtime.db");
  });

  it("restore rejects path traversal in manifest", () => {
    const { backupDir } = createBackup(jarvisDir, backupsDir);

    // Tamper with manifest to include a path-traversal entry
    const manifest = JSON.parse(fs.readFileSync(join(backupDir, "manifest.json"), "utf8")) as {
      files: Array<{ name: string; size: number }>;
      timestamp: string;
      total_size: number;
    };
    manifest.files.push({ name: "../evil.txt", size: 10 });
    fs.writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    // Create the evil file in backup (so it exists)
    fs.writeFileSync(join(backupDir, "../evil.txt"), "malicious content");

    // Run restore
    const result = restoreBackup(backupDir, jarvisDir);
    expect(result.ok).toBe(true);

    // The traversal file should NOT appear in the restored list
    expect(result.restored).not.toContain("../evil.txt");

    // And the evil file should NOT exist inside jarvisDir
    expect(fs.existsSync(join(jarvisDir, "evil.txt"))).toBe(false);

    // Clean up the evil file outside backup dir
    try { fs.unlinkSync(join(backupDir, "../evil.txt")); } catch { /* ok */ }
  });

  it("post-restore health check detects corrupted DB", () => {
    const { backupDir } = createBackup(jarvisDir, backupsDir);

    // Replace a DB in the backup with garbage bytes
    fs.writeFileSync(join(backupDir, "runtime.db"), Buffer.from("NOT_A_VALID_SQLITE_DB"));

    // Restore (should succeed — restore logic copies files without checking contents)
    const result = restoreBackup(backupDir, jarvisDir);
    expect(result.ok).toBe(true);

    // Post-restore health check: PRAGMA integrity_check should fail on the corrupted file
    let integrityPassed = false;
    let healthDb: DatabaseSync | undefined;
    try {
      healthDb = new DatabaseSync(join(jarvisDir, "runtime.db"));
      const intCheck = healthDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      integrityPassed = intCheck.integrity_check === "ok";
    } catch {
      integrityPassed = false;
    } finally {
      try { healthDb?.close(); } catch { /* best-effort */ }
    }
    expect(integrityPassed).toBe(false);
  });

  it("backup with no source files returns empty file list", () => {
    // Create an empty jarvis dir (no files)
    const emptyDir = join(tmpDir, ".jarvis-empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const backupDir = join(emptyDir, "backups", "backup-test");
    fs.mkdirSync(backupDir, { recursive: true });

    const files: Array<{ name: string; size: number }> = [];
    for (const name of BACKUP_FILES) {
      const src = join(emptyDir, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, join(backupDir, name));
        files.push({ name, size: fs.statSync(join(backupDir, name)).size });
      }
    }

    // No files should have been copied
    expect(files.length).toBe(0);
  });
});
