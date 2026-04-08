/**
 * Release metadata: version tracking, upgrade path validation,
 * and rollback guidance for the Jarvis appliance.
 */

import type { DatabaseSync } from "node:sqlite";
import { JARVIS_PLATFORM_VERSION } from "./plugin-loader.js";
import { RUNTIME_MIGRATIONS } from "./migrations/runner.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReleaseInfo = {
  version: string;
  released_at: string;
  migrations: string[];
  min_upgrade_from?: string;
  changelog_summary: string;
  rollback_safe: boolean;
};

export type UpgradeCheckResult = {
  can_upgrade: boolean;
  current_version: string;
  target_version: string;
  pending_migrations: string[];
  warnings: string[];
  requires_backup: boolean;
};

// ─── Current Release ────────────────────────────────────────────────────────

export const CURRENT_RELEASE: ReleaseInfo = {
  version: JARVIS_PLATFORM_VERSION,
  released_at: "2026-04-08T00:00:00.000Z",
  migrations: RUNTIME_MIGRATIONS.map(m => m.id),
  changelog_summary: "Year 1-3: Channel ingress, execution hardening, core workflows, appliance reliability, provenance, multi-viewpoint, knowledge loop, team mode, platform polish",
  rollback_safe: true,
};

// ─── Persistence ────────────────────────────────────────────────────────────

type PersistedRelease = {
  version: string;
  released_at: string;
  installed_at: string;
};

/**
 * Persist the current release version to the settings table.
 * Call once at daemon startup after migrations have run.
 */
export function persistRelease(db: DatabaseSync): void {
  try {
    const payload: PersistedRelease = {
      version: CURRENT_RELEASE.version,
      released_at: CURRENT_RELEASE.released_at,
      installed_at: new Date().toISOString(),
    };
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)",
    ).run("platform_release", JSON.stringify(payload), payload.installed_at);
  } catch {
    // Best-effort — settings table may not exist in all DB contexts
  }
}

/**
 * Load the installed release version from the settings table.
 * Returns null if no release has been persisted yet.
 */
export function loadInstalledVersion(db: DatabaseSync): PersistedRelease | null {
  try {
    const row = db.prepare(
      "SELECT value_json FROM settings WHERE key = ?",
    ).get("platform_release") as { value_json: string } | undefined;
    if (!row?.value_json) return null;
    return JSON.parse(row.value_json) as PersistedRelease;
  } catch {
    return null;
  }
}

// ─── Upgrade Validation ─────────────────────────────────────────────────────

/**
 * Check if an upgrade from one version to another is safe.
 * When a database is provided, reads the installed version from persistent
 * state rather than relying on the in-memory constant.
 */
export function checkUpgrade(
  currentMigrations: string[],
  targetRelease: ReleaseInfo,
  db?: DatabaseSync,
): UpgradeCheckResult {
  const currentSet = new Set(currentMigrations);
  const pendingMigrations = targetRelease.migrations.filter(m => !currentSet.has(m));
  const warnings: string[] = [];

  const installed = db ? loadInstalledVersion(db) : null;
  const currentVersion = installed?.version ?? JARVIS_PLATFORM_VERSION;

  if (pendingMigrations.length > 3) {
    warnings.push(`${pendingMigrations.length} pending migrations — consider backing up first`);
  }

  return {
    can_upgrade: true,
    current_version: currentVersion,
    target_version: targetRelease.version,
    pending_migrations: pendingMigrations,
    warnings,
    requires_backup: pendingMigrations.length > 0,
  };
}

/**
 * Get the current platform version.
 */
export function getPlatformVersion(): string {
  return JARVIS_PLATFORM_VERSION;
}
