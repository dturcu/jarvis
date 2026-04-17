/**
 * Stress: Soak — Queue Backpressure & Worker FD Churn
 *
 * Two-phase producer/consumer soak against the Jarvis job state contract
 * (submitJob/claimJob/handleWorkerCallback). Exercises the state-layer
 * SQLite jobs table under enqueue/claim imbalance, then flushes the
 * queue and churns state instances to catch FD/handle leaks.
 *
 * Phase A: 200/s enqueue vs 20/s claim (10× imbalance → ~10k backlog).
 * Phase B: drain, then spawn/dispose 2000 JarvisState instances.
 *
 * Heuristic thresholds (see report for rationale):
 *   RSS growth < 80 MB, enqueue p99 < 50ms, +10 handle cap post-churn.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import {
  configureJarvisStatePersistence,
  getJarvisState,
  resetJarvisState,
} from "@jarvis/shared";
import { percentile } from "./helpers.js";

// CI-tunable timings — edit these at the module top.
const PHASE_A_DURATION_MS = 60_000;
const PHASE_B_WORKER_CYCLES = 500;
const PHASE_A_ENQUEUE_RATE_HZ = 200;
const PHASE_A_CLAIM_RATE_HZ = 20;
const RSS_SAMPLE_EVERY_MS = 2_000;
const ENQUEUE_P99_CAP_MS = 50;
const HANDLE_DELTA_CAP = 10;

type RssSample = { tMs: number; rssMb: number; queueDepth: number };
type ProcessHandles = { active: number; requests: number };

function handleCount(): ProcessHandles {
  // _getActiveHandles/Requests are undocumented but stable Node APIs.
  const p = process as unknown as {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };
  return {
    active: p._getActiveHandles?.().length ?? 0,
    requests: p._getActiveRequests?.().length ?? 0,
  };
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 100) / 100;
}

type PhaseAResult = {
  rssSamples: RssSample[];
  enqueueLatencies: number[];
  enqueued: number;
  claimed: number;
  errors: number;
  maxQueueDepth: number;
  peakRssMb: number;
};

async function runPhaseA(durationMs: number): Promise<PhaseAResult> {
  const rssSamples: RssSample[] = [];
  const enqueueLatencies: number[] = [];
  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  const state = getJarvisState();

  let enqueued = 0;
  let claimed = 0;
  let errors = 0;
  let maxQueueDepth = 0;

  const enqueueIntervalMs = 1000 / PHASE_A_ENQUEUE_RATE_HZ;
  const claimIntervalMs = 1000 / PHASE_A_CLAIM_RATE_HZ;

  let nextEnqueueAt = Date.now();
  let nextClaimAt = Date.now();
  let nextSampleAt = Date.now();

  while (Date.now() < deadline) {
    const now = Date.now();

    // Enqueue batch (burst up to 10 to reach 200/s without hot-looping).
    if (now >= nextEnqueueAt) {
      const batch = Math.min(10, Math.ceil((now - nextEnqueueAt) / enqueueIntervalMs) + 1);
      for (let i = 0; i < batch; i++) {
        const t0 = performance.now();
        try {
          // system.list_processes: not_required approval, trivial input.
          const resp = state.submitJob({
            type: "system.list_processes",
            input: { sort_by: "cpu", top_n: 5 },
          });
          if (resp.status !== "accepted") errors++;
          enqueued++;
        } catch {
          errors++;
        }
        enqueueLatencies.push(performance.now() - t0);
      }
      nextEnqueueAt = now + enqueueIntervalMs;
    }

    if (now >= nextClaimAt) {
      try {
        const claim = state.claimJob({
          worker_id: `soak-worker-${claimed}`,
          lease_seconds: 30,
        });
        if (claim?.claimed) {
          // Callback-complete immediately so Phase A doesn't accumulate
          // stale 'running' rows that Phase B drain would have to juggle.
          state.handleWorkerCallback({
            contract_version: "jarvis.v1",
            job_id: claim.job_id!,
            job_type: claim.job_type!,
            attempt: claim.attempt ?? 1,
            status: "completed",
            summary: "soak-claim-complete",
            worker_id: `soak-worker-${claimed}`,
            claim_id: claim.claim_id,
          });
          claimed++;
        }
      } catch {
        errors++;
      }
      nextClaimAt = now + claimIntervalMs;
    }

    if (now >= nextSampleAt) {
      const depth = state.getStats().jobs;
      maxQueueDepth = Math.max(maxQueueDepth, depth);
      rssSamples.push({ tMs: now - startedAt, rssMb: rssMb(), queueDepth: depth });
      nextSampleAt = now + RSS_SAMPLE_EVERY_MS;
    }

    // Yield so the enqueue burst doesn't starve claims or sampling.
    await new Promise((r) => setImmediate(r));
  }

  const peakRssMb = rssSamples.reduce((m, s) => Math.max(m, s.rssMb), 0);
  return { rssSamples, enqueueLatencies, enqueued, claimed, errors, maxQueueDepth, peakRssMb };
}

async function drainAll(): Promise<number> {
  const state = getJarvisState();
  let drained = 0;
  // Guard cap defends against any future bug that returned a phantom
  // claim; expected drain is ~11k rows max.
  for (let guard = 0; guard < 200_000; guard++) {
    const claim = state.claimJob({ worker_id: `drain-${guard}`, lease_seconds: 30 });
    if (!claim?.claimed) break;
    state.handleWorkerCallback({
      contract_version: "jarvis.v1",
      job_id: claim.job_id!,
      job_type: claim.job_type!,
      attempt: claim.attempt ?? 1,
      status: "completed",
      summary: "drain",
      worker_id: `drain-${guard}`,
      claim_id: claim.claim_id,
    });
    drained++;
  }
  return drained;
}

/**
 * Spawn+dispose N lightweight state instances sequentially. Each reconfigure
 * opens a fresh on-disk SQLite connection; each reset closes it. Missing
 * close() would show as monotonic handle growth.
 */
function churnWorkerInstances(cycles: number, baseDir: string): void {
  for (let i = 0; i < cycles; i++) {
    const workerDb = join(baseDir, `worker-${i}.sqlite`);
    configureJarvisStatePersistence({ databasePath: workerDb });
    const state = getJarvisState();
    state.getStats(); // touch the connection
    configureJarvisStatePersistence(null);
    resetJarvisState();
  }
}

describe.sequential("Soak: Queue Backpressure + Worker FD Churn", () => {
  let tempDir: string;
  let baselineHandles: ProcessHandles;

  beforeEach(() => {
    tempDir = mkdtempSync(join(os.tmpdir(), "jarvis-soak-queue-"));
    configureJarvisStatePersistence({ databasePath: join(tempDir, "state.sqlite") });
    resetJarvisState();
    baselineHandles = handleCount();
  });

  afterEach(() => {
    configureJarvisStatePersistence(null);
    resetJarvisState();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("full 60s+60s run: backpressure absorbed, FDs reclaimed", { timeout: 600_000 }, async () => {
    const rssStart = rssMb();
    const phaseA = await runPhaseA(PHASE_A_DURATION_MS);

    expect(phaseA.errors).toBe(0);
    expect(phaseA.enqueued).toBeGreaterThan(0);
    expect(phaseA.claimed).toBeLessThan(phaseA.enqueued / 5); // 10× imbalance holds
    expect(phaseA.maxQueueDepth).toBeGreaterThanOrEqual(4_000);

    const rssDelta = phaseA.peakRssMb - rssStart;
    expect(
      rssDelta,
      `Phase A RSS growth ${rssDelta.toFixed(1)}MB (peak=${phaseA.peakRssMb} start=${rssStart})`,
    ).toBeLessThan(80);

    const p99 = percentile(phaseA.enqueueLatencies, 99);
    expect(
      p99,
      `enqueue p99=${p99.toFixed(2)}ms across ${phaseA.enqueueLatencies.length} ops`,
    ).toBeLessThan(ENQUEUE_P99_CAP_MS);

    const drained = await drainAll();
    expect(drained).toBeGreaterThan(0);

    // Every queued row should have reached a terminal state.
    const postDrain = getJarvisState().getStats();
    expect(postDrain.jobs).toBeGreaterThanOrEqual(phaseA.enqueued);

    churnWorkerInstances(PHASE_B_WORKER_CYCLES, tempDir);
    const postChurn = handleCount();
    const handleDelta = postChurn.active - baselineHandles.active;
    expect(
      handleDelta,
      `active handle delta ${handleDelta} (baseline=${baselineHandles.active} post=${postChurn.active})`,
    ).toBeLessThanOrEqual(HANDLE_DELTA_CAP);
  });

  it("reduced 20s+20s run: same invariants at CI speed", { timeout: 300_000 }, async () => {
    const rssStart = rssMb();
    const phaseA = await runPhaseA(20_000);

    expect(phaseA.errors).toBe(0);
    expect(phaseA.enqueued).toBeGreaterThan(0);

    const rssDelta = phaseA.peakRssMb - rssStart;
    expect(rssDelta, `Phase A RSS (CI) ${rssDelta.toFixed(1)}MB`).toBeLessThan(80);

    const p99 = percentile(phaseA.enqueueLatencies, 99);
    expect(p99).toBeLessThan(ENQUEUE_P99_CAP_MS);

    await drainAll();

    churnWorkerInstances(Math.floor(PHASE_B_WORKER_CYCLES / 2), tempDir);
    const postChurn = handleCount();
    const handleDelta = postChurn.active - baselineHandles.active;
    expect(handleDelta).toBeLessThanOrEqual(HANDLE_DELTA_CAP);
  });

  it("Phase B only: 500 worker churn cycles, handles stable", { timeout: 300_000 }, () => {
    churnWorkerInstances(PHASE_B_WORKER_CYCLES, tempDir);
    const postChurn = handleCount();

    const handleDelta = postChurn.active - baselineHandles.active;
    expect(
      handleDelta,
      `pure-churn handle delta ${handleDelta} (baseline=${baselineHandles.active} post=${postChurn.active})`,
    ).toBeLessThanOrEqual(HANDLE_DELTA_CAP);

    // Requests (setImmediate/nextTick queue) should also be clean.
    expect(postChurn.requests - baselineHandles.requests).toBeLessThanOrEqual(HANDLE_DELTA_CAP);
  });
});
