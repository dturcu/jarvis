// @ts-check
/**
 * Minimal worker fixture for stress tests that spawn workers via
 * `child_process.fork`. Operates directly on the Jarvis state DB via
 * `node:sqlite` so the parent can kill the worker mid-lifecycle without
 * waiting for a higher-level worker harness to boot.
 *
 * Contract with parent (IPC messages on process.send):
 *   { kind: "ready" }                      — worker booted and started its loop
 *   { kind: "claimed",  job_id, claim_id } — SQL claim committed
 *   { kind: "heartbeat", job_id, claim_id }— heartbeat row update committed
 *   { kind: "callback",  job_id, claim_id }— completion update committed
 *   { kind: "no_work" }                    — no queued jobs found this tick
 *
 * Environment variables:
 *   DB_PATH          — absolute path to the Jarvis state SQLite file
 *   WORKER_ID        — string identifier for this worker
 *   LEASE_SECONDS    — integer lease to request (default 5)
 *   PHASE_TO_HANG    — "pre_heartbeat" | "mid_heartbeat" | "pre_callback" | "none"
 *   MAX_ITERATIONS   — safety cap on loop iterations (default 200)
 *   HANG_MS          — how long to hang before auto-exit (default 60000)
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const DB_PATH = process.env.DB_PATH;
const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const LEASE_SECONDS = Math.max(1, Number.parseInt(process.env.LEASE_SECONDS ?? "5", 10));
const PHASE_TO_HANG = process.env.PHASE_TO_HANG ?? "none";
const MAX_ITERATIONS = Math.max(1, Number.parseInt(process.env.MAX_ITERATIONS ?? "200", 10));
const HANG_MS = Math.max(100, Number.parseInt(process.env.HANG_MS ?? "60000", 10));

if (!DB_PATH) {
  console.error("[crash-worker] DB_PATH env var is required");
  process.exit(2);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 2000;");

function nowIso() {
  return new Date().toISOString();
}

function addSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function hangForever(ms) {
  // Block the event loop long enough for the parent to SIGKILL us.
  // We use setTimeout + resolve to keep the process alive but idle.
  return new Promise(() => {
    setTimeout(() => process.exit(0), ms);
  });
}

function notify(payload) {
  if (typeof process.send === "function") {
    try { process.send(payload); } catch { /* parent detached */ }
  }
}

/**
 * Mirror of JarvisState.claimJob for a single queued job, using the
 * BEGIN IMMEDIATE pattern to ensure two concurrent workers cannot both
 * claim the same row. Returns the record_json (parsed) + claim_id on
 * success, or null when no queued work is available.
 */
function claimOne() {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "SELECT record_json FROM jobs WHERE status = 'queued' ORDER BY updated_at ASC LIMIT 1",
      )
      .get();
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    const record = JSON.parse(row.record_json);
    const retryAfter = record.result?.metrics?.retry_after_at;
    if (retryAfter && retryAfter > nowIso()) {
      db.exec("COMMIT");
      return null;
    }
    const claimedAt = nowIso();
    const claim = {
      claim_id: randomUUID(),
      claimed_by: WORKER_ID,
      lease_expires_at: addSeconds(claimedAt, LEASE_SECONDS),
      last_heartbeat_at: claimedAt,
    };
    record.claim = claim;
    record.result = {
      ...record.result,
      status: "running",
      summary: `Running ${record.envelope.type}.`,
      metrics: {
        ...(record.result.metrics ?? {}),
        started_at: claimedAt,
        worker_id: WORKER_ID,
        attempt: record.envelope.attempt,
      },
    };
    db.prepare(
      `UPDATE jobs SET status = 'running', claim_id = ?, claimed_by = ?,
         lease_expires_at = ?, last_heartbeat_at = ?, updated_at = ?,
         record_json = ? WHERE job_id = ?`,
    ).run(
      claim.claim_id,
      claim.claimed_by,
      claim.lease_expires_at,
      claim.last_heartbeat_at,
      claimedAt,
      JSON.stringify(record),
      record.envelope.job_id,
    );
    db.exec("COMMIT");
    return { record, claim };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }
}

function heartbeatOnce(record, claim) {
  const heartbeatAt = nowIso();
  const newExpiry = addSeconds(heartbeatAt, LEASE_SECONDS);
  db.prepare(
    `UPDATE jobs SET last_heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
       WHERE job_id = ? AND claim_id = ?`,
  ).run(heartbeatAt, newExpiry, heartbeatAt, record.envelope.job_id, claim.claim_id);
  notify({ kind: "heartbeat", job_id: record.envelope.job_id, claim_id: claim.claim_id });
}

function callbackComplete(record, claim) {
  // Only finalize if our claim is still active — mirrors state.ts.handleWorkerCallback
  const existing = db
    .prepare("SELECT claim_id, status FROM jobs WHERE job_id = ?")
    .get(record.envelope.job_id);
  if (!existing || existing.claim_id !== claim.claim_id || existing.status !== "running") {
    // Stale callback — would be rejected. Record that we attempted and stop.
    notify({
      kind: "callback_rejected",
      job_id: record.envelope.job_id,
      claim_id: claim.claim_id,
      reason: "claim_mismatch_or_not_running",
    });
    return;
  }
  const finishedAt = nowIso();
  const nextResult = {
    ...record.result,
    status: "completed",
    summary: `Completed ${record.envelope.type}.`,
    metrics: {
      ...(record.result.metrics ?? {}),
      finished_at: finishedAt,
      worker_id: WORKER_ID,
      attempt: record.envelope.attempt,
    },
  };
  const nextRecord = { ...record, claim: null, result: nextResult };
  db.prepare(
    `UPDATE jobs SET status = 'completed', claim_id = NULL, claimed_by = NULL,
       lease_expires_at = NULL, last_heartbeat_at = NULL, updated_at = ?,
       record_json = ? WHERE job_id = ? AND claim_id = ?`,
  ).run(finishedAt, JSON.stringify(nextRecord), record.envelope.job_id, claim.claim_id);
  notify({ kind: "callback", job_id: record.envelope.job_id, claim_id: claim.claim_id });
}

async function runOne(iteration) {
  const claimed = claimOne();
  if (!claimed) {
    notify({ kind: "no_work", iteration });
    return false;
  }
  const { record, claim } = claimed;
  notify({ kind: "claimed", job_id: record.envelope.job_id, claim_id: claim.claim_id });

  if (PHASE_TO_HANG === "pre_heartbeat") {
    notify({ kind: "hanging", phase: "pre_heartbeat" });
    await hangForever(HANG_MS);
    return false;
  }

  // Emit one heartbeat tick, with optional mid-heartbeat hang
  if (PHASE_TO_HANG === "mid_heartbeat") {
    notify({ kind: "hanging", phase: "mid_heartbeat" });
    await hangForever(HANG_MS);
    return false;
  }
  heartbeatOnce(record, claim);

  if (PHASE_TO_HANG === "pre_callback") {
    notify({ kind: "hanging", phase: "pre_callback" });
    await hangForever(HANG_MS);
    return false;
  }

  // Second heartbeat to simulate an in-flight worker, then complete.
  heartbeatOnce(record, claim);
  callbackComplete(record, claim);
  return true;
}

async function main() {
  notify({ kind: "ready", worker_id: WORKER_ID, pid: process.pid });
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let workDone = false;
    try {
      workDone = await runOne(i);
    } catch (e) {
      notify({ kind: "error", message: String(e?.message ?? e) });
    }
    if (!workDone) {
      // No work (or we hung): short backoff before the next iteration
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  notify({ kind: "exhausted" });
  process.exit(0);
}

main().catch((e) => {
  console.error("[crash-worker] fatal", e);
  process.exit(1);
});
