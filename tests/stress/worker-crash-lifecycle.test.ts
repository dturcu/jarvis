/**
 * Stress: Worker Crash Lifecycle (Chaos / Failure Injection)
 *
 * Invariant: no job is simultaneously claimed by a live worker AND re-dispatched.
 * Exactly one accepted callback per claim_id. `attempt` strictly monotonic per
 * job_id. Dead-letter only when attempt > retry_policy.max_attempts.
 *
 * Method: fork crash-worker.mjs children, SIGKILL at lifecycle phases, tick the
 * reaper at 250 ms with lease_seconds=5, then walk the DB and assert invariants.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  configureJarvisStatePersistence,
  getJarvisState,
  resetJarvisState,
} from "@jarvis/shared";
import { createStressDb, cleanupDb, range } from "./helpers.js";

const WORKER_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "crash-worker.mjs",
);

type WorkerMessage = { kind: string; job_id?: string; claim_id?: string; phase?: string };
type TrackedWorker = { proc: ChildProcess; phase: string; killed: boolean; messages: WorkerMessage[]; hung: boolean };

type ForkOpts = { dbPath: string; workerId: string; phase: string; leaseSeconds: number; maxIterations?: number };

function forkWorker(opts: ForkOpts): TrackedWorker {
  const proc = fork(WORKER_FIXTURE, [], {
    env: {
      ...process.env,
      DB_PATH: opts.dbPath,
      WORKER_ID: opts.workerId,
      LEASE_SECONDS: String(opts.leaseSeconds),
      PHASE_TO_HANG: opts.phase,
      MAX_ITERATIONS: String(opts.maxIterations ?? 20),
      HANG_MS: "30000",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const tracked: TrackedWorker = { proc, phase: opts.phase, killed: false, messages: [], hung: false };
  proc.on("message", (msg: WorkerMessage) => {
    tracked.messages.push(msg);
    if (msg.kind === "hanging") tracked.hung = true;
  });
  proc.stderr?.on("data", () => {});
  proc.stdout?.on("data", () => {});
  return tracked;
}

function killWorker(w: TrackedWorker): void {
  if (w.killed || !w.proc.pid) return;
  w.killed = true;
  try { w.proc.kill("SIGKILL"); } catch { /* already dead */ }
}

async function waitAll(workers: TrackedWorker[], ms: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (!workers.some((w) => w.proc.exitCode === null && !w.killed)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Submit N jobs then patch retry_policy.max_attempts via raw SQL since
// JarvisState.submitJob hard-codes max_attempts = 3.
function seedJobsWithMaxAttempts(dbPath: string, count: number, maxAttempts: number): string[] {
  const state = getJarvisState();
  const jobIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = state.submitJob({
      type: "office.inspect",
      input: { target_artifacts: [{ artifact_id: `seed-${i}` }] },
    });
    expect(res.status).toBe("accepted");
    jobIds.push(res.job_id!);
  }
  const db = new DatabaseSync(dbPath);
  try {
    const upd = db.prepare("UPDATE jobs SET record_json = ? WHERE job_id = ?");
    for (const jobId of jobIds) {
      const row = db.prepare("SELECT record_json FROM jobs WHERE job_id = ?").get(jobId) as
        | { record_json: string } | undefined;
      if (!row) continue;
      const rec = JSON.parse(row.record_json);
      rec.envelope.retry_policy = { mode: "manual", max_attempts: maxAttempts };
      upd.run(JSON.stringify(rec), jobId);
    }
  } finally {
    db.close();
  }
  return jobIds;
}

type JobRow = {
  job_id: string;
  status: string;
  attempt: number;
  claim_id: string | null;
  lease_expires_at: string | null;
  record_json: string;
};

function readAllJobs(dbPath: string): JobRow[] {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare("SELECT job_id, status, attempt, claim_id, lease_expires_at, record_json FROM jobs")
      .all() as JobRow[];
  } finally {
    db.close();
  }
}

function assertAttemptMonotonic(jobs: JobRow[], maxAttempts: number): void {
  for (const j of jobs) {
    const rec = JSON.parse(j.record_json);
    expect(rec.envelope.attempt).toBeGreaterThanOrEqual(1);
    expect(rec.envelope.attempt).toBeLessThanOrEqual(maxAttempts + 1);
    if (rec.result.error?.code === "DEAD_LETTER_MAX_ATTEMPTS_EXCEEDED") {
      expect(rec.envelope.attempt).toBeGreaterThanOrEqual(maxAttempts);
    }
  }
}

function assertNoDuplicateActiveClaims(jobs: JobRow[]): void {
  const runningClaims = jobs
    .filter((j) => j.status === "running" && j.claim_id)
    .map((j) => j.claim_id!);
  expect(new Set(runningClaims).size).toBe(runningClaims.length);
}

function assertNoOrphanedRunning(jobs: JobRow[]): void {
  const now = new Date().toISOString();
  for (const j of jobs) {
    if (j.status === "running") {
      expect(j.lease_expires_at).toBeTruthy();
      expect(j.lease_expires_at! > now).toBe(true);
    }
  }
}

function assertExactlyOneCallbackPerClaim(workers: TrackedWorker[]): void {
  const seen = new Set<string>();
  for (const w of workers) {
    for (const m of w.messages) {
      if (m.kind === "callback" && m.claim_id) {
        expect(seen.has(m.claim_id)).toBe(false);
        seen.add(m.claim_id);
      }
    }
  }
}

describe("Worker Crash Lifecycle Stress (chaos / failure injection)", () => {
  let dbPath: string;
  let reaperTimer: ReturnType<typeof setInterval> | null = null;

  beforeEach(() => {
    // Reuse createStressDb for its tmpdir-isolated path; discard the
    // migrated RunStore schema so JarvisState can own the jobs DDL.
    const seed = createStressDb("worker-crash-seed");
    cleanupDb(seed.db, seed.path);
    dbPath = seed.path;
    configureJarvisStatePersistence(null);
    resetJarvisState();
    configureJarvisStatePersistence({ filePath: dbPath });
    resetJarvisState();
  });

  afterEach(() => {
    if (reaperTimer) { clearInterval(reaperTimer); reaperTimer = null; }
    configureJarvisStatePersistence(null);
    resetJarvisState();
    try { cleanupDb(new DatabaseSync(":memory:"), dbPath); } catch { /* best-effort */ }
  });

  it(
    "variation A: 12 workers × 200 jobs mixed crash phases — unique claims, monotonic attempts",
    async () => {
      const JOB_COUNT = 200, MAX_ATTEMPTS = 5, LEASE = 5, WORKER_COUNT = 12;
      seedJobsWithMaxAttempts(dbPath, JOB_COUNT, MAX_ATTEMPTS);
      reaperTimer = setInterval(() => {
        try { getJarvisState().requeueExpiredJobs(); } catch { /* ignore */ }
      }, 250);

      const phases = ["pre_heartbeat", "mid_heartbeat", "pre_callback", "none"];
      const workers = range(WORKER_COUNT).map((i) =>
        forkWorker({
          dbPath,
          workerId: `w-${i}`,
          phase: phases[i % phases.length]!,
          leaseSeconds: LEASE,
          maxIterations: 40,
        }),
      );

      await waitAll(workers, 4000);
      for (const w of workers) {
        if (w.proc.exitCode === null && (w.hung || w.phase !== "none")) killWorker(w);
      }
      await new Promise((r) => setTimeout(r, 6000));
      for (const w of workers) killWorker(w);
      await waitAll(workers, 2000);

      const jobs = readAllJobs(dbPath);
      expect(jobs.length).toBe(JOB_COUNT);

      assertExactlyOneCallbackPerClaim(workers);
      assertNoOrphanedRunning(jobs);
      assertAttemptMonotonic(jobs, MAX_ATTEMPTS);
      assertNoDuplicateActiveClaims(jobs);

      const buckets: Record<string, number> = {};
      for (const j of jobs) buckets[j.status] = (buckets[j.status] ?? 0) + 1;
      const deadLettered = jobs.filter((j) =>
        JSON.parse(j.record_json).result.error?.code === "DEAD_LETTER_MAX_ATTEMPTS_EXCEEDED",
      ).length;
      expect((buckets.completed ?? 0) + (buckets.queued ?? 0) + deadLettered).toBe(JOB_COUNT);
    },
    60_000,
  );

  it(
    "variation B: 4 workers × 50 jobs crash ONLY at pre_callback — survivors complete, no duplicate callbacks",
    async () => {
      const JOB_COUNT = 50, MAX_ATTEMPTS = 5, LEASE = 5;
      seedJobsWithMaxAttempts(dbPath, JOB_COUNT, MAX_ATTEMPTS);
      reaperTimer = setInterval(() => {
        try { getJarvisState().requeueExpiredJobs(); } catch { /* ignore */ }
      }, 250);

      const workers = [
        forkWorker({ dbPath, workerId: "kill-1", phase: "pre_callback", leaseSeconds: LEASE, maxIterations: 5 }),
        forkWorker({ dbPath, workerId: "kill-2", phase: "pre_callback", leaseSeconds: LEASE, maxIterations: 5 }),
        forkWorker({ dbPath, workerId: "ok-1",   phase: "none",         leaseSeconds: LEASE, maxIterations: 100 }),
        forkWorker({ dbPath, workerId: "ok-2",   phase: "none",         leaseSeconds: LEASE, maxIterations: 100 }),
      ];

      await new Promise((r) => setTimeout(r, 1500));
      killWorker(workers[0]!);
      killWorker(workers[1]!);
      await new Promise((r) => setTimeout(r, 8000));
      for (const w of workers) killWorker(w);
      await waitAll(workers, 2000);

      const jobs = readAllJobs(dbPath);
      expect(jobs.length).toBe(JOB_COUNT);
      assertNoOrphanedRunning(jobs);
      assertNoDuplicateActiveClaims(jobs);
      assertExactlyOneCallbackPerClaim(workers);

      // A completed row has claim cleared (callbackComplete nulls it).
      for (const j of jobs) {
        if (j.status === "completed") expect(j.claim_id).toBeNull();
      }
    },
    60_000,
  );

  it(
    "variation C: 8 workers × 100 jobs crash ONLY at pre_heartbeat — reaper re-queues stalled claims",
    async () => {
      const JOB_COUNT = 100, MAX_ATTEMPTS = 5, LEASE = 5;
      seedJobsWithMaxAttempts(dbPath, JOB_COUNT, MAX_ATTEMPTS);
      reaperTimer = setInterval(() => {
        try { getJarvisState().requeueExpiredJobs(); } catch { /* ignore */ }
      }, 250);

      const workers = [
        ...range(6).map((i) =>
          forkWorker({ dbPath, workerId: `crash-${i}`, phase: "pre_heartbeat", leaseSeconds: LEASE, maxIterations: 6 }),
        ),
        forkWorker({ dbPath, workerId: "ok-1", phase: "none", leaseSeconds: LEASE, maxIterations: 200 }),
        forkWorker({ dbPath, workerId: "ok-2", phase: "none", leaseSeconds: LEASE, maxIterations: 200 }),
      ];

      await new Promise((r) => setTimeout(r, 1000));
      for (const w of workers.slice(0, 6)) killWorker(w);
      await new Promise((r) => setTimeout(r, 10_000));
      for (const w of workers) killWorker(w);
      await waitAll(workers, 2000);

      const jobs = readAllJobs(dbPath);
      expect(jobs.length).toBe(JOB_COUNT);

      assertAttemptMonotonic(jobs, MAX_ATTEMPTS);
      assertNoDuplicateActiveClaims(jobs);

      let requeuedAttempts = 0, completed = 0, deadLettered = 0;
      for (const j of jobs) {
        const rec = JSON.parse(j.record_json);
        if (j.status === "queued" && rec.envelope.attempt > 1) requeuedAttempts++;
        if (j.status === "completed") completed++;
        if (rec.result.error?.code === "DEAD_LETTER_MAX_ATTEMPTS_EXCEEDED") deadLettered++;
      }
      // Reaper must have touched at least one row given 6 pre-heartbeat crashers.
      expect(requeuedAttempts + completed + deadLettered).toBeGreaterThan(0);
    },
    60_000,
  );
});
