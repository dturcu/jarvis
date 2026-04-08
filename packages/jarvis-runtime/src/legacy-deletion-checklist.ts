/**
 * legacy-deletion-checklist.ts — Codified deletion list for Epic 12.
 *
 * Enumerates every deprecated file, route, and env var that should be
 * removed once all convergence exit conditions show "Pass" and the
 * preconditions from RELEASE-GATE-CONVERGENCE.md are met.
 *
 * This module is informational — it does NOT perform deletions.
 * Use it for pre-deletion verification and release-gate audits.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---- Types ----------------------------------------------------------------

export interface DeletionCandidate {
  /** Relative path from project root. */
  path: string
  /** What this file/route is. */
  description: string
  /** Which epic this deletion belongs to. */
  epic: string
  /** Whether the file currently exists. */
  exists?: boolean
  /** Whether the file has @deprecated marker. */
  marked_deprecated?: boolean
}

export interface EnvVarDeletion {
  name: string
  description: string
  replacement: string
}

export interface RouteDeletion {
  route: string
  file: string
  description: string
}

// ---- Deletion lists -------------------------------------------------------

export const FILE_DELETIONS: DeletionCandidate[] = [
  {
    path: "packages/jarvis-dashboard/src/api/godmode.ts",
    description: "Legacy LLM loop (direct LM Studio orchestration)",
    epic: "Epic 12",
  },
  {
    path: "packages/jarvis-dashboard/src/api/chat.ts",
    description: "Legacy direct chat surface",
    epic: "Epic 12",
  },
  {
    path: "packages/jarvis-telegram/src/chat-handler.ts",
    description: "Legacy Telegram chat handler",
    epic: "Epic 12",
  },
  {
    path: "packages/jarvis-telegram/src/bot.ts",
    description: "Legacy Telegram bot (direct API)",
    epic: "Epic 12",
  },
  {
    path: "packages/jarvis-telegram/src/relay.ts",
    description: "Legacy Telegram relay queue",
    epic: "Epic 12",
  },
  {
    path: "packages/jarvis-browser-worker/src/chrome-adapter.ts",
    description: "Legacy browser adapter (direct Puppeteer/CDP)",
    epic: "Epic 12",
  },
]

export const ROUTE_DELETIONS: RouteDeletion[] = [
  {
    route: "/api/godmode/legacy",
    file: "packages/jarvis-dashboard/src/api/server.ts",
    description: "Legacy godmode route mount",
  },
  {
    route: "/api/webhooks",
    file: "packages/jarvis-dashboard/src/api/server.ts",
    description: "Dashboard webhook route (replaced by OpenClaw webhook plugin)",
  },
  {
    route: "/api/webhooks-v2",
    file: "packages/jarvis-dashboard/src/api/server.ts",
    description: "Dashboard webhook v2 route (replaced by OpenClaw webhook plugin)",
  },
]

export const ENV_VAR_DELETIONS: EnvVarDeletion[] = [
  {
    name: "JARVIS_TELEGRAM_MODE",
    description: "Legacy mode selector (session/legacy)",
    replacement: "Only session mode remains after deletion",
  },
  {
    name: "JARVIS_BROWSER_MODE",
    description: "Legacy mode selector (openclaw/legacy)",
    replacement: "Only openclaw mode remains after deletion",
  },
  {
    name: "JARVIS_WEBHOOK_LEGACY",
    description: "Legacy webhook mount toggle",
    replacement: "OpenClaw webhook plugin handles all ingress",
  },
]

/**
 * Pre-deletion verification from RELEASE-GATE-CONVERGENCE.md.
 */
export const PRE_DELETION_CHECKS = [
  "All 4 primary paths converged",
  "Session mode running >= 1 full schedule cycle",
  "No operator reports missing functionality vs legacy",
  "No production deployments using legacy env vars",
  "All deprecated files marked @deprecated",
  "jarvis doctor convergence checks pass",
  "npm run check:convergence exits 0",
  "All external callers migrated from legacy endpoints",
  "Browser tasks produce equivalent artifacts through OpenClaw bridge",
] as const

// ---- Verification ---------------------------------------------------------

/**
 * Check the current state of the deletion candidates.
 * Returns each candidate with exists/marked_deprecated status.
 */
export function verifyDeletionCandidates(projectRoot: string): DeletionCandidate[] {
  return FILE_DELETIONS.map((candidate) => {
    const fullPath = resolve(projectRoot, candidate.path)
    const exists = existsSync(fullPath)
    let marked_deprecated = false

    if (exists) {
      try {
        const source = readFileSync(fullPath, "utf8")
        marked_deprecated = source.includes("@deprecated")
      } catch { /* can't read */ }
    }

    return { ...candidate, exists, marked_deprecated }
  })
}
