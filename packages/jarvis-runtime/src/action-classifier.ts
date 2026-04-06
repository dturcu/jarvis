/**
 * Explicit action classification for maturity enforcement.
 *
 * Actions are classified as read-only or mutating based on their suffix
 * (the part after the last dot). Unknown suffixes default to mutating
 * (safe default — err on the side of requiring approval).
 */

const READ_ONLY_SUFFIXES = new Set([
  // Query operations
  "search", "list", "get", "find", "query", "count",
  // Inspection
  "check", "scan", "read", "fetch", "inspect", "lookup",
  // Analysis (no side effects)
  "analyze", "extract", "classify", "summarize", "validate",
  // Monitoring
  "monitor", "stats", "status", "health",
  // Preview (dry-run style)
  "preview", "estimate", "compare", "diff",
]);

/**
 * Returns true if the action is classified as read-only.
 * Read-only actions have no side effects and don't require approval
 * under maturity-based enforcement.
 *
 * Classification uses the action suffix (e.g., "crm.search" → "search").
 * Unknown suffixes default to mutating (requiring approval).
 */
export function isReadOnlyAction(action: string): boolean {
  const parts = action.split(".");
  const suffix = parts[parts.length - 1]?.toLowerCase();
  return suffix ? READ_ONLY_SUFFIXES.has(suffix) : false;
}

/**
 * Returns the set of all recognized read-only suffixes.
 * Useful for testing and documentation.
 */
export function getReadOnlySuffixes(): ReadonlySet<string> {
  return READ_ONLY_SUFFIXES;
}
