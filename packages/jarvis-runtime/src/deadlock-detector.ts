import type { DatabaseSync } from "node:sqlite";
import { RunStore } from "./run-store.js";

/**
 * Error code stamped onto the `error` column of a run transitioned to
 * `failed` by the deadlock detector. Callers matching on this string
 * can distinguish deadlock failures from ordinary step errors.
 */
export const DEADLOCK_DETECTED = "DEADLOCK_DETECTED";

export type DeadlockReport = {
  cyclesFound: number;
  runsFailed: string[];
  runsCancelled: string[];
  elapsedMs: number;
};

export type DeadlockOptions = {
  budgetMs?: number;
};

/**
 * Scan the approvals + runs tables for wait-for cycles and break them.
 *
 * A run is "stuck" when its status is `awaiting_approval` and there is a
 * pending approval row with the same `run_id` (the schema encodes the
 * wait-for edge via the approval's `run_id` — an approval blocks the run
 * that requested it, and a self-reference is a 1-node cycle that will
 * never resolve without external action).
 *
 * For each stuck run:
 *   - transition it to `failed` with `DEADLOCK_DETECTED` in the error column
 *   - emit a `run_deadlocked` audit event
 *   - if the approval payload carries a `chain` array (used by the detector
 *     contract to mark partners), cascade the remaining participants to
 *     `cancelled` with `reason="cycle partner failed"`
 *
 * The scan is bounded by `budgetMs` (default 2s); if the budget runs out
 * mid-scan we stop and report what we've handled so far.
 */
export function runDeadlockDetector(
  db: DatabaseSync,
  options: DeadlockOptions = {},
): DeadlockReport {
  const budgetMs = options.budgetMs ?? 2000;
  const start = Date.now();
  const deadline = start + budgetMs;
  const store = new RunStore(db);

  const stuck = db
    .prepare(
      `SELECT r.run_id        AS run_id,
              r.agent_id      AS agent_id,
              a.approval_id   AS approval_id,
              a.payload_json  AS payload_json
       FROM runs r
       INNER JOIN approvals a ON a.run_id = r.run_id
       WHERE r.status = 'awaiting_approval'
         AND a.status = 'pending'`,
    )
    .all() as Array<{
      run_id: string;
      agent_id: string;
      approval_id: string;
      payload_json: string | null;
    }>;

  const runsFailed: string[] = [];
  const runsCancelled: string[] = [];
  let cyclesFound = 0;
  const handledVictims = new Set<string>();

  for (const row of stuck) {
    if (Date.now() > deadline) break;
    if (handledVictims.has(row.run_id)) continue;
    handledVictims.add(row.run_id);
    cyclesFound++;

    const chain = extractChain(row.payload_json);

    store.transition(row.run_id, row.agent_id, "failed", "run_failed", {
      details: {
        error: `${DEADLOCK_DETECTED}: wait-for cycle involving approval ${row.approval_id}`,
        approval_id: row.approval_id,
        chain,
      },
    });
    store.emitEvent(row.run_id, row.agent_id, "run_deadlocked", {
      details: { approval_id: row.approval_id, chain },
    });
    runsFailed.push(row.run_id);

    for (const partnerId of chain) {
      if (partnerId === row.run_id) continue;
      const status = store.getStatus(partnerId);
      if (!status || status === "completed" || status === "failed" || status === "cancelled") {
        continue;
      }
      const partnerRun = store.getRun(partnerId);
      const partnerAgent = partnerRun?.agent_id ?? "unknown";
      try {
        store.transition(partnerId, partnerAgent, "cancelled", "run_cancelled", {
          details: { reason: "cycle partner failed", cycle_victim: row.run_id },
        });
        runsCancelled.push(partnerId);
      } catch {
        // Transition may be rejected if the partner moved to a terminal
        // state between getStatus and transition. That's fine — skip.
      }
    }
  }

  return {
    cyclesFound,
    runsFailed,
    runsCancelled,
    elapsedMs: Date.now() - start,
  };
}

function extractChain(payloadJson: string | null): string[] {
  if (!payloadJson) return [];
  try {
    const raw = JSON.parse(payloadJson) as unknown;
    if (typeof raw === "string") {
      const inner = JSON.parse(raw) as unknown;
      return Array.isArray((inner as { chain?: unknown })?.chain)
        ? ((inner as { chain: unknown[] }).chain.filter(
            (x): x is string => typeof x === "string",
          ))
        : [];
    }
    if (raw && typeof raw === "object" && Array.isArray((raw as { chain?: unknown }).chain)) {
      return (raw as { chain: unknown[] }).chain.filter(
        (x): x is string => typeof x === "string",
      );
    }
  } catch {
    // Malformed payload — no chain info available, treat as single-node cycle.
  }
  return [];
}
