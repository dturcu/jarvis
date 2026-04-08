import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import {
  CRM_MIGRATIONS,
  KNOWLEDGE_MIGRATIONS,
  runMigrations,
} from "@jarvis/runtime";
import {
  createBackupSnapshot,
  getBackupStatus,
  restoreBackupDirectory,
} from "../packages/jarvis-dashboard/src/api/backup.ts";

function createTempDir(): string {
  return fs.mkdtempSync(join(os.tmpdir(), "jarvis-backup-api-"));
}

function setupDatabase(dbPath: string, migrations?: Parameters<typeof runMigrations>[1]): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db, migrations);
  } finally {
    db.close();
  }
}

function setupFakeJarvisDir(jarvisDir: string): void {
  fs.mkdirSync(jarvisDir, { recursive: true });
  fs.writeFileSync(join(jarvisDir, "config.json"), JSON.stringify({ lmstudio_url: "http://localhost:1234" }));
  setupDatabase(join(jarvisDir, "runtime.db"));
  setupDatabase(join(jarvisDir, "crm.db"), CRM_MIGRATIONS);
  setupDatabase(join(jarvisDir, "knowledge.db"), KNOWLEDGE_MIGRATIONS);
}

describe("backup API helpers", () => {
  let tempDir: string;
  let jarvisDir: string;
  let backupsDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    jarvisDir = join(tempDir, ".jarvis");
    backupsDir = join(jarvisDir, "backups");
    setupFakeJarvisDir(jarvisDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates sqlite snapshots and reports normalized backup status", () => {
    const { backupDir, files } = createBackupSnapshot(jarvisDir, backupsDir, new Date("2026-04-08T10:00:00.000Z"));

    expect(files.map((file) => file.name)).toEqual(
      expect.arrayContaining(["config.json", "runtime.db", "crm.db", "knowledge.db"]),
    );
    expect(fs.existsSync(join(backupDir, "runtime.db-wal"))).toBe(false);
    expect(fs.existsSync(join(backupDir, "runtime.db-shm"))).toBe(false);

    const status = getBackupStatus(backupsDir);
    expect(status).toMatchObject({
      last_backup: "2026-04-08T10:00:00.000Z",
      last_backup_at: "2026-04-08T10:00:00.000Z",
      last_backup_path: backupDir,
    });
    expect(status.size_mb).not.toBeNull();
  });

  it("clears stale WAL sidecars when restoring snapshot backups", () => {
    const { backupDir } = createBackupSnapshot(jarvisDir, backupsDir, new Date("2026-04-08T11:00:00.000Z"));

    fs.writeFileSync(join(jarvisDir, "runtime.db-wal"), "stale wal");
    fs.writeFileSync(join(jarvisDir, "runtime.db-shm"), "stale shm");
    fs.writeFileSync(join(jarvisDir, "runtime.db"), Buffer.from("corrupt runtime db"));

    const restored = restoreBackupDirectory(backupDir, jarvisDir);
    expect(restored.restored).toContain("runtime.db");
    expect(fs.existsSync(join(jarvisDir, "runtime.db-wal"))).toBe(false);
    expect(fs.existsSync(join(jarvisDir, "runtime.db-shm"))).toBe(false);

    const restoredDb = new DatabaseSync(join(jarvisDir, "runtime.db"));
    try {
      const integrity = restoredDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      expect(integrity.integrity_check).toBe("ok");
    } finally {
      restoredDb.close();
    }
  });
});
