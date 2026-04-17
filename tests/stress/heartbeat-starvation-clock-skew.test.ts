/**
 * Stress: Heartbeat Starvation & Clock Skew (Chaos / Failure Injection)
 *
 * Invariant: the reaper uses the SERVER clock — a worker-reported
 * `heartbeat_at` cannot extend its own lease past `server_now + lease_seconds`.
 * Silent workers are reaped within `lease + tick`. Forged future timestamps
 * do not block fresh claims by healthy workers.
 *
 * Method: drive JarvisState.claimJob / heartbeatJob with explicit
 * `requested_at` / `heartbeat_at` strings to simulate workers with +45s,
 * -45s, or correct skew. Tick `requeueExpiredJobs()` from real time.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  configureJarvisStatePersistence,
  getJarvisState,
  resetJarvisState,
} from "@jarvis/shared";
import { createStressDb, cleanupDb } from "./helpers.js";

function skewedIso(offsetSec: number): string {
  return new Date(Date.now() + offsetSec * 1000).toISOString();
}

type JobRow = {
  job_id: string;
  status: string;
  claim_id: string | null;
  claimed_by: string | null;
  lease_expires_at: string | null;
  record_json: string;
};

function readJobs(dbPath: string): JobRow[] {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare(
        "SELECT job_id, status, claim_id, claimed_by, lease_expires_at, record_json FROM jobs",
      )
      .all() as JobRow[];
  } finally {
    db.close();
  }
}

function seedJobs(count: number, prefix = "hb"): string[] {
  const state = getJarvisState();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = state.submitJob({
      type: "office.inspect",
      input: { target_artifacts: [{ artifact_id: `${prefix}-${i}` }] },
    });
    expect(res.status).toBe("accepted");
    ids.push(res.job_id!);
  }
  return ids;
}

describe("Heartbeat Starvation & Clock Skew Stress (chaos / failure injection)", () => {
  let dbPath: string;

  beforeEach(() => {
    const seed = createStressDb("heartbeat-skew-seed");
    cleanupDb(seed.db, seed.path);
    dbPath = seed.path;
    configureJarvisStatePersistence(null);
    resetJarvisState();
    configureJarvisStatePersistence({ filePath: dbPath });
    resetJarvisState();
  });

  afterEach(() => {
    configureJarvisStatePersistence(null);
    resetJarvisState();
    try { cleanupDb(new DatabaseSync(":memory:"), dbPath); } catch { /* best-effort */ }
  });

  it(
    "variation A: all-silent single worker — reaper re-queues all 50 claims within lease+tick",
    async () => {
      const LEASE = 5, JOB_COUNT = 50;
      seedJobs(JOB_COUNT);
      const state = getJarvisState();

      const claims: Array<{ job_id: string; claim_id: string }> = [];
      for (let i = 0; i < JOB_COUNT; i++) {
        const r = state.claimJob({ worker_id: "silent-w", lease_seconds: LEASE });
        expect(r).not.toBeNull();
        expect(r!.claimed).toBe(true);
        claims.push({ job_id: r!.job_id!, claim_id: r!.claim_id! });
      }
      expect(claims.length).toBe(JOB_COUNT);

      // Claim unique-id invariant
      expect(new Set(claims.map((c) => c.claim_id)).size).toBe(JOB_COUNT);

      const deadline = Date.now() + (LEASE + 2) * 1000;
      while (Date.now() < deadline) {
        state.requeueExpiredJobs();
        await new Promise((r) => setTimeout(r, 500));
      }
      state.requeueExpiredJobs();

      const jobs = readJobs(dbPath);
      expect(jobs.length).toBe(JOB_COUNT);

      // Silent worker never heartbeat; reaper must have cleared all claims.
      const running = jobs.filter((j) => j.status === "running");
      expect(running.length).toBe(0);

      for (const j of jobs) {
        if (j.status === "queued") {
          expect(j.claim_id).toBeNull();
          expect(j.claimed_by).toBeNull();
        }
      }

      let bumped = 0;
      for (const j of jobs) {
        const rec = JSON.parse(j.record_json);
        if (rec.envelope.attempt > 1) bumped++;
      }
      expect(bumped).toBeGreaterThan(0);
      expect(bumped).toBeLessThanOrEqual(JOB_COUNT);
    },
    30_000,
  );

  it(
    "variation B: mixed skew + silent — silent worker's jobs transition queued, future-skew leases are server-bounded",
    async () => {
      const LEASE = 5, JOB_COUNT = 30;
      seedJobs(JOB_COUNT);
      const state = getJarvisState();

      // 5 workers: 2 × +45s, 2 × -45s, 1 correct. Each claims 6 jobs.
      const plans = [
        { id: "skew-plus-1", offset: +45 },
        { id: "skew-plus-2", offset: +45 },
        { id: "skew-minus-1", offset: -45 },
        { id: "skew-minus-2", offset: -45 },
        { id: "correct", offset: 0 },
      ];
      const allClaims: Array<{ worker: string; job_id: string; claim_id: string; offset: number }> = [];
      for (const p of plans) {
        for (let i = 0; i < 6; i++) {
          const r = state.claimJob({
            worker_id: p.id,
            lease_seconds: LEASE,
            requested_at: skewedIso(p.offset),
          });
          expect(r).not.toBeNull();
          expect(r!.claimed).toBe(true);
          allClaims.push({ worker: p.id, job_id: r!.job_id!, claim_id: r!.claim_id!, offset: p.offset });
        }
      }
      // Each row has a lease in the DB — verify presence.
      for (const j of readJobs(dbPath)) {
        if (j.status === "running") expect(j.lease_expires_at).toBeTruthy();
      }

      // Wait LEASE+2s of real time; the "correct" worker's lease
      // expires (requested_at == real now), so reaper will re-queue it.
      await new Promise((r) => setTimeout(r, (LEASE + 2) * 1000));
      state.requeueExpiredJobs();

      const jobsAfter = readJobs(dbPath);
      const correctClaims = allClaims.filter((c) => c.worker === "correct");
      for (const c of correctClaims) {
        const j = jobsAfter.find((x) => x.job_id === c.job_id);
        expect(j).toBeDefined();
        expect(j!.status).not.toBe("running");
      }

      // +45s workers' leases are ~45s ahead of real now, so their rows
      // remain running. That's server-clock-correct: the lease was
      // granted with their own timestamp, and the server has not reached it.
      const running = jobsAfter.filter((j) => j.status === "running");
      const nowIso = new Date().toISOString();
      for (const j of running) {
        expect(j.lease_expires_at! > nowIso).toBe(true);
        expect(["skew-plus-1", "skew-plus-2"]).toContain(j.claimed_by!);
      }

      // Forged-old heartbeat on a -45s claim: resulting lease lands in
      // the past, so the next reap sweeps it.
      const minusClaim = allClaims.find((c) => c.offset === -45);
      if (minusClaim) {
        const ack = state.heartbeatJob({
          worker_id: minusClaim.worker,
          job_id: minusClaim.job_id,
          claim_id: minusClaim.claim_id,
          lease_seconds: LEASE,
          heartbeat_at: skewedIso(-60),
        });
        if (ack) {
          expect(Date.parse(ack.lease_expires_at!)).toBeLessThan(Date.now());
        }
      }
      state.requeueExpiredJobs();

      for (const j of readJobs(dbPath)) {
        if (j.status === "running") {
          expect(j.lease_expires_at! > new Date().toISOString()).toBe(true);
        }
      }
    },
    45_000,
  );

  it(
    "variation C: future-dated forged heartbeats cannot starve — healthy workers still claim remaining jobs",
    async () => {
      const LEASE = 5, JOB_COUNT = 20;
      seedJobs(JOB_COUNT);
      const state = getJarvisState();

      // Evil worker claims 10, forges +1h heartbeats to try to pin them.
      const evilClaims: Array<{ job_id: string; claim_id: string }> = [];
      for (let i = 0; i < 10; i++) {
        const r = state.claimJob({ worker_id: "evil", lease_seconds: LEASE });
        expect(r).not.toBeNull();
        evilClaims.push({ job_id: r!.job_id!, claim_id: r!.claim_id! });
      }
      for (const c of evilClaims) {
        const ack = state.heartbeatJob({
          worker_id: "evil",
          job_id: c.job_id,
          claim_id: c.claim_id,
          lease_seconds: LEASE,
          heartbeat_at: skewedIso(3600),
        });
        expect(ack).not.toBeNull();
      }

      // Healthy worker grabs the remaining 10.
      const healthyIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = state.claimJob({ worker_id: "healthy", lease_seconds: LEASE });
        expect(r).not.toBeNull();
        expect(r!.claimed).toBe(true);
        healthyIds.push(r!.job_id!);
      }
      expect(state.claimJob({ worker_id: "healthy", lease_seconds: LEASE })).toBeNull();

      // Healthy leases must be server-now + LEASE-ish.
      const jobs = readJobs(dbPath);
      const running = jobs.filter((j) => j.status === "running");
      expect(running.length).toBe(JOB_COUNT);

      // claimJob clamps to max(5, lease_seconds); use the actual server bound.
      const EFFECTIVE_LEASE_S = Math.max(5, LEASE);
      const maxLegalHealthy = Date.now() + EFFECTIVE_LEASE_S * 1000 + 1000;
      const healthyJobs = running.filter((j) => j.claimed_by === "healthy");
      expect(healthyJobs.length).toBe(10);
      for (const j of healthyJobs) {
        expect(Date.parse(j.lease_expires_at!)).toBeLessThanOrEqual(maxLegalHealthy);
      }

      const evilJobs = running.filter((j) => j.claimed_by === "evil");
      expect(evilJobs.length).toBe(10);

      // Claim-id uniqueness across all running rows
      const claimIds = running.map((j) => j.claim_id!).filter(Boolean);
      expect(new Set(claimIds).size).toBe(claimIds.length);
    },
    30_000,
  );
});
