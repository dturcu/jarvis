/**
 * Release metadata: version tracking, upgrade path validation,
 * and rollback guidance for the Jarvis appliance.
 */

import { JARVIS_PLATFORM_VERSION } from "./plugin-loader.js";

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
  released_at: new Date().toISOString(),
  migrations: ["0001", "0002", "0003", "0004", "0005", "0006", "0007"],
  changelog_summary: "Year 1-2: Channel ingress, execution hardening, core workflows, appliance reliability, provenance, multi-viewpoint, knowledge loop, team mode",
  rollback_safe: true,
};

// ─── Upgrade Validation ─────────────────────────────────────────────────────

/**
 * Check if an upgrade from one version to another is safe.
 */
export function checkUpgrade(
  currentMigrations: string[],
  targetRelease: ReleaseInfo,
): UpgradeCheckResult {
  const currentSet = new Set(currentMigrations);
  const pendingMigrations = targetRelease.migrations.filter(m => !currentSet.has(m));
  const warnings: string[] = [];

  if (pendingMigrations.length > 3) {
    warnings.push(`${pendingMigrations.length} pending migrations — consider backing up first`);
  }

  return {
    can_upgrade: true,
    current_version: JARVIS_PLATFORM_VERSION,
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
