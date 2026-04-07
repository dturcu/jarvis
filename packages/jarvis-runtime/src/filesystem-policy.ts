/**
 * Filesystem policies restrict which paths workers can access.
 * Used by the files bridge to validate paths before fs operations.
 */

import os from "node:os";
import { resolve, normalize, sep } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FilesystemPolicy = {
  allowed_roots: string[];
  denied_patterns: string[];
  max_file_size_bytes: number;
};

export type PathValidationResult = {
  allowed: boolean;
  reason?: string;
};

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_DENIED_PATTERNS = [
  ".env",
  "credentials",
  ".pem",
  ".key",
  "id_rsa",
  "id_ed25519",
  ".p12",
  ".pfx",
];

const JARVIS_DIR = resolve(os.homedir(), ".jarvis");

/** Default filesystem policy: allows ~/.jarvis/ and temp dir; denies secrets. */
export function defaultFilesystemPolicy(projectRoot?: string): FilesystemPolicy {
  const roots = [JARVIS_DIR, os.tmpdir()];
  if (projectRoot) roots.push(resolve(projectRoot));
  return {
    allowed_roots: roots,
    denied_patterns: [...DEFAULT_DENIED_PATTERNS],
    max_file_size_bytes: 50 * 1024 * 1024, // 50MB
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a path against a filesystem policy.
 * Returns `{ allowed: true }` or `{ allowed: false, reason: "..." }`.
 */
export function validatePath(targetPath: string, policy: FilesystemPolicy): PathValidationResult {
  const absPath = normalizePath(resolve(targetPath));

  // Check against allowed roots
  const inAllowedRoot = policy.allowed_roots.some(root => {
    const normalizedRoot = normalizePath(resolve(root));
    return absPath.startsWith(normalizedRoot + sep) || absPath === normalizedRoot;
  });

  if (!inAllowedRoot) {
    return {
      allowed: false,
      reason: `Path "${absPath}" is outside all allowed roots: ${policy.allowed_roots.join(", ")}`,
    };
  }

  // Check against denied patterns (case-insensitive substring on segments)
  const lowerPath = absPath.toLowerCase();
  const segments = lowerPath.split(sep);
  for (const pattern of policy.denied_patterns) {
    const lowerPattern = pattern.toLowerCase();
    if (segments.some(seg => seg.includes(lowerPattern))) {
      return {
        allowed: false,
        reason: `Path "${absPath}" matches denied pattern "${pattern}"`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Load filesystem policy from config, merging operator overrides with defaults.
 * Operator can add allowed roots and denied patterns but cannot remove defaults.
 */
export function loadFilesystemPolicy(config: {
  filesystem_policy?: {
    additional_roots?: string[];
    additional_denied_patterns?: string[];
    max_file_size_bytes?: number;
  };
  project_root?: string;
}): FilesystemPolicy {
  const base = defaultFilesystemPolicy(config.project_root);
  const overrides = config.filesystem_policy;
  if (!overrides) return base;

  if (overrides.additional_roots) {
    base.allowed_roots.push(...overrides.additional_roots.map(r => resolve(r)));
  }
  if (overrides.additional_denied_patterns) {
    base.denied_patterns.push(...overrides.additional_denied_patterns);
  }
  if (overrides.max_file_size_bytes) {
    base.max_file_size_bytes = overrides.max_file_size_bytes;
  }

  return base;
}

/** Normalize path separators for consistent comparison. */
function normalizePath(p: string): string {
  return normalize(p);
}
