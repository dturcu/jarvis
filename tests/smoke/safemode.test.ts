/**
 * A4.1 — Safe Mode: detection logic (black-box lifecycle certification)
 *
 * Tests the safe-mode checks as implemented in
 * packages/jarvis-dashboard/src/api/safemode.ts — exercising the same
 * DatabaseSync queries and fs checks the handler uses, but against
 * temp directories and databases we control.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations } from "@jarvis/runtime";

// ── Helpers (mirror the logic in safemode.ts) ───────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(join(os.tmpdir(), "jarvis-safemode-"));
}

/**
 * Reproduces the three checks from safemode.ts against arbitrary paths
 * so we can test them without touching the real ~/.jarvis directory.
 */
function runSafeModeChecks(jarvisDir: string) {
  const runtimeDbPath = join(jarvisDir, "runtime.db");
  const configPath = join(jarvisDir, "config.json");

  const checks = {
    databases_ok: true,
    config_ok: true,
    daemon_running: true,
  };
  let reason: string | null = null;

  // Check 1 — runtime.db exists and has required tables
  if (!fs.existsSync(runtimeDbPath)) {
    checks.databases_ok = false;
    reason = "Runtime database missing";
  } else {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(runtimeDbPath);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA busy_timeout = 5000;");
      const tables = db.prepare(
        "SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name IN ('runs', 'approvals', 'daemon_heartbeats')",
      ).get() as { n: number };
      if (tables.n < 3) {
        checks.databases_ok = false;
        reason = "Runtime database is missing required tables";
      }
    } catch {
      checks.databases_ok = false;
      reason = "Runtime database cannot be opened";
    } finally {
      try { db?.close(); } catch { /* best-effort */ }
    }
  }

  // Check 2 — config.json is valid
  if (!fs.existsSync(configPath)) {
    checks.config_ok = false;
    if (!reason) reason = "Configuration file missing";
  } else {
    try {
      JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      checks.config_ok = false;
      if (!reason) reason = "Configuration file is invalid JSON";
    }
  }

  // Check 3 — daemon heartbeat staleness
  if (checks.databases_ok && fs.existsSync(runtimeDbPath)) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(runtimeDbPath);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA busy_timeout = 5000;");
      const heartbeat = db.prepare(
        "SELECT last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1",
      ).get() as { last_seen_at: string } | undefined;

      if (!heartbeat) {
        checks.daemon_running = false;
        if (!reason) reason = "No daemon heartbeat found";
      } else {
        const staleness = Date.now() - new Date(heartbeat.last_seen_at).getTime();
        if (staleness > 30_000) {
          checks.daemon_running = false;
          if (!reason) reason = "Daemon heartbeat is stale";
        }
      }
    } catch {
      checks.daemon_running = false;
      if (!reason) reason = "Cannot check daemon heartbeat";
    } finally {
      try { db?.close(); } catch { /* best-effort */ }
    }
  } else {
    checks.daemon_running = false;
    if (!reason) reason = "Cannot check daemon — database unavailable";
  }

  const safe_mode = !checks.databases_ok || !checks.config_ok || !checks.daemon_running;
  return { safe_mode, reason: safe_mode ? reason : null, checks };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("Safe Mode: detection logic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns safe_mode=false when all checks pass", () => {
    // Create a fully migrated runtime.db
    const dbPath = join(tmpDir, "runtime.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db);

    // Insert a fresh daemon heartbeat
    db.prepare(
      "INSERT INTO daemon_heartbeats (daemon_id, pid, host, version, status, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("daemon-1", 12345, "localhost", "1.0.0", "running", new Date().toISOString());
    db.close();

    // Create valid config.json
    fs.writeFileSync(join(tmpDir, "config.json"), JSON.stringify({ version: "1.0" }));

    const result = runSafeModeChecks(tmpDir);
    expect(result.safe_mode).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.checks.databases_ok).toBe(true);
    expect(result.checks.config_ok).toBe(true);
    expect(result.checks.daemon_running).toBe(true);
  });

  it("returns safe_mode=true when runtime DB is missing required tables", () => {
    // Create an empty DB — no migrations applied
    const dbPath = join(tmpDir, "runtime.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.close();

    // Valid config
    fs.writeFileSync(join(tmpDir, "config.json"), JSON.stringify({ version: "1.0" }));

    const result = runSafeModeChecks(tmpDir);
    expect(result.safe_mode).toBe(true);
    expect(result.checks.databases_ok).toBe(false);
    expect(result.reason).toBe("Runtime database is missing required tables");
  });

  it("returns safe_mode=true when daemon heartbeat is stale", () => {
    // Create migrated DB with stale heartbeat
    const dbPath = join(tmpDir, "runtime.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db);

    // Insert heartbeat 60 seconds ago (> 30s threshold)
    const staleTime = new Date(Date.now() - 60_000).toISOString();
    db.prepare(
      "INSERT INTO daemon_heartbeats (daemon_id, pid, host, version, status, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("daemon-1", 12345, "localhost", "1.0.0", "running", staleTime);
    db.close();

    // Valid config
    fs.writeFileSync(join(tmpDir, "config.json"), JSON.stringify({ version: "1.0" }));

    const result = runSafeModeChecks(tmpDir);
    expect(result.safe_mode).toBe(true);
    expect(result.checks.daemon_running).toBe(false);
    expect(result.reason).toBe("Daemon heartbeat is stale");
  });

  it("returns safe_mode=true when no heartbeat exists", () => {
    // Create migrated DB — no heartbeat rows
    const dbPath = join(tmpDir, "runtime.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db);
    db.close();

    // Valid config
    fs.writeFileSync(join(tmpDir, "config.json"), JSON.stringify({ version: "1.0" }));

    const result = runSafeModeChecks(tmpDir);
    expect(result.safe_mode).toBe(true);
    expect(result.checks.daemon_running).toBe(false);
    expect(result.reason).toBe("No daemon heartbeat found");
  });

  it("returns safe_mode=false with fresh heartbeat", () => {
    // Create migrated DB with fresh heartbeat (just now)
    const dbPath = join(tmpDir, "runtime.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db);

    db.prepare(
      "INSERT INTO daemon_heartbeats (daemon_id, pid, host, version, status, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("daemon-1", 99999, "localhost", "1.0.0", "running", new Date().toISOString());
    db.close();

    // Valid config
    fs.writeFileSync(join(tmpDir, "config.json"), JSON.stringify({ version: "1.0" }));

    const result = runSafeModeChecks(tmpDir);
    expect(result.safe_mode).toBe(false);
    expect(result.checks.daemon_running).toBe(true);
  });

  it("returns safe_mode=true when runtime.db does not exist", () => {
    // Only config, no DB
    fs.writeFileSync(join(tmpDir, "config.json"), JSON.stringify({ version: "1.0" }));

    const result = runSafeModeChecks(tmpDir);
    expect(result.safe_mode).toBe(true);
    expect(result.checks.databases_ok).toBe(false);
    expect(result.reason).toBe("Runtime database missing");
  });

  it("returns safe_mode=true when config.json is missing", () => {
    // Create migrated DB with fresh heartbeat but no config
    const dbPath = join(tmpDir, "runtime.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db);

    db.prepare(
      "INSERT INTO daemon_heartbeats (daemon_id, pid, host, version, status, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("daemon-1", 12345, "localhost", "1.0.0", "running", new Date().toISOString());
    db.close();

    const result = runSafeModeChecks(tmpDir);
    expect(result.safe_mode).toBe(true);
    expect(result.checks.config_ok).toBe(false);
  });

  it("returns safe_mode=true when config.json is invalid JSON", () => {
    // Create migrated DB with fresh heartbeat
    const dbPath = join(tmpDir, "runtime.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db);

    db.prepare(
      "INSERT INTO daemon_heartbeats (daemon_id, pid, host, version, status, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("daemon-1", 12345, "localhost", "1.0.0", "running", new Date().toISOString());
    db.close();

    // Write invalid JSON
    fs.writeFileSync(join(tmpDir, "config.json"), "{ broken json !!!");

    const result = runSafeModeChecks(tmpDir);
    expect(result.safe_mode).toBe(true);
    expect(result.checks.config_ok).toBe(false);
  });
});
