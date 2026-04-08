/**
 * Filesystem policies restrict which paths workers can access.
 * Used by the files bridge to validate paths before fs operations.
 */

import os from "node:os";
import fs from "node:fs";
import { resolve, normalize, sep } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FilesystemPolicy = {
  allowed_roots: string[];
  denied_patterns: string[];
  max_file_size_bytes: number;
  /** Maximum bytes a single read operation may return (default 10 MB). */
  max_read_bytes: number;
  /** Maximum bytes a single write operation may accept (default 5 MB). */
  max_write_bytes: number;
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

/**
 * Hardcoded blocked paths that can never be accessed regardless of allowed_roots.
 * Normalised to lowercase for case-insensitive comparison.
 */
const BLOCKED_PATH_PREFIXES: string[] = [
  // Unix system directories
  "/etc",
  "/var",
  // Windows system directories (cover all drive letters)
  ...(process.platform === "win32"
    ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").flatMap(d => [
        `${d}:\\Windows`,
        `${d}:\\Program Files`,
        `${d}:\\Program Files (x86)`,
      ])
    : []),
  // SSH keys
  resolve(os.homedir(), ".ssh"),
  // Cloud credential stores
  resolve(os.homedir(), ".aws"),
  resolve(os.homedir(), ".gcp"),
  resolve(os.homedir(), ".azure"),
].map(p => normalize(p).toLowerCase());

/**
 * Blocked path substrings -- paths containing any of these (case-insensitive)
 * are denied regardless of allowed_roots.
 */
const BLOCKED_PATH_SUBSTRINGS: string[] = [
  "chrome/user data",
  "chrome\\user data",
  "firefox/profiles",
  "firefox\\profiles",
];

const DEFAULT_MAX_READ_BYTES = 10 * 1024 * 1024;   // 10 MB
const DEFAULT_MAX_WRITE_BYTES = 5 * 1024 * 1024;   //  5 MB

const JARVIS_DIR = resolve(os.homedir(), ".jarvis");

/**
 * Default filesystem policy.
 *
 * Allowed roots: `~/.jarvis`, `os.tmpdir()`, and either the explicit
 * `projectRoot` or `process.cwd()`.  The entire filesystem is **never**
 * implicitly allowed.
 */
export function defaultFilesystemPolicy(projectRoot?: string): FilesystemPolicy {
  const roots = [JARVIS_DIR, os.tmpdir()];
  roots.push(resolve(projectRoot ?? process.cwd()));
  return {
    allowed_roots: roots,
    denied_patterns: [...DEFAULT_DENIED_PATTERNS],
    max_file_size_bytes: 50 * 1024 * 1024, // 50 MB
    max_read_bytes: DEFAULT_MAX_READ_BYTES,
    max_write_bytes: DEFAULT_MAX_WRITE_BYTES,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a path against a filesystem policy.
 * Returns `{ allowed: true }` or `{ allowed: false, reason: "..." }`.
 */
export function validatePath(targetPath: string, policy: FilesystemPolicy): PathValidationResult {
  let absPath = normalizePath(resolve(targetPath));

  // ── Symlink resolution ──────────────────────────────────────────────────
  // Always resolve symlinks BEFORE any allow/deny check so that a symlink
  // inside an allowed root that points outside cannot escape the sandbox.
  try {
    if (fs.existsSync(absPath)) {
      absPath = normalizePath(fs.realpathSync(absPath));
    }
  } catch {
    // If realpathSync fails (e.g., broken symlink) reject the path outright
    // rather than silently allowing a potentially malicious link.
    return {
      allowed: false,
      reason: `Unable to resolve real path for "${absPath}" -- broken or inaccessible symlink`,
    };
  }

  // ── Hardcoded blocked paths (always denied) ─────────────────────────────
  const lowerAbs = absPath.toLowerCase();

  for (const blocked of BLOCKED_PATH_PREFIXES) {
    if (lowerAbs === blocked || lowerAbs.startsWith(blocked + sep.toLowerCase())) {
      return {
        allowed: false,
        reason: `Path "${absPath}" falls under a blocked system/credential directory`,
      };
    }
  }

  for (const sub of BLOCKED_PATH_SUBSTRINGS) {
    if (lowerAbs.includes(sub)) {
      return {
        allowed: false,
        reason: `Path "${absPath}" matches blocked browser-profile pattern`,
      };
    }
  }

  // ── Allowed-root check ──────────────────────────────────────────────────
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

  // ── Denied-pattern check (case-insensitive substring on segments) ───────
  const segments = lowerAbs.split(sep);
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
    max_read_bytes?: number;
    max_write_bytes?: number;
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
  if (overrides.max_read_bytes) {
    base.max_read_bytes = overrides.max_read_bytes;
  }
  if (overrides.max_write_bytes) {
    base.max_write_bytes = overrides.max_write_bytes;
  }

  return base;
}

/** Normalize path separators for consistent comparison. */
function normalizePath(p: string): string {
  return normalize(p);
}
