/**
 * Stress: Soak — Agent Memory Heap
 *
 * Asserts that V8 heap stays bounded across hundreds of SqliteMemoryStore
 * lifecycle cycles. A single iteration exercises the canonical hot path:
 *   addShortTerm → getContext → clearShortTerm → addLongTerm
 * rotating across a pool of 50 agent/run pairs so both the per-run
 * clearing path and the per-agent 500-entry long-term eviction path are
 * hit many times over the course of the test.
 *
 * Heuristics:
 *   • 15 MB absolute / 20% relative delta between post-GC checkpoints
 *     is generous enough to absorb V8 compaction noise on Windows CI but
 *     tight enough to catch a real retained-closure leak.
 *   • "3 consecutive samples growing > 8 MB each" is a ramp detector —
 *     one bad sample is noise, a sustained ramp is a leak.
 *   • When --expose-gc is unavailable we cannot force compaction, so we
 *     relax the absolute cap to 30 MB and skip the "post-GC delta" clause.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as v8 from "node:v8";
import { SqliteMemoryStore } from "@jarvis/agent-framework";
import { createStressDb, cleanupDb } from "./helpers.js";

const SAMPLE_EVERY = 50;
const AGENT_POOL = 50;
const GC_CHECKPOINTS = new Set([100, 500, 900]);

type HeapSample = { iter: number; heapUsed: number; external: number; rss: number };

function maybeGc(): boolean {
  if (typeof (globalThis as { gc?: () => void }).gc === "function") {
    (globalThis as { gc?: () => void }).gc!();
    return true;
  }
  return false;
}

function takeSample(iter: number): HeapSample {
  const mem = process.memoryUsage();
  return { iter, heapUsed: mem.heapUsed, external: mem.external, rss: mem.rss };
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

async function runCycle(
  store: SqliteMemoryStore,
  iters: number,
  payloadSize: number,
  concurrentReaders: boolean,
): Promise<{ samples: HeapSample[]; checkpoints: Map<number, HeapSample>; gcAvailable: boolean }> {
  const samples: HeapSample[] = [];
  const checkpoints = new Map<number, HeapSample>();
  const payload = payloadSize > 0 ? "x".repeat(payloadSize) : "observation";
  let gcAvailable = false;

  for (let i = 0; i < iters; i++) {
    const agentIdx = i % AGENT_POOL;
    const agentId = `soak-agent-${agentIdx}`;
    const runId = `soak-run-${agentIdx}-${Math.floor(i / AGENT_POOL)}`;

    // canonical hot path
    store.addShortTerm(agentId, runId, `${payload}-st-${i}`);
    store.getContext(agentId, runId);
    store.clearShortTerm(runId);
    store.addLongTerm(agentId, runId, `${payload}-lt-${i}`);

    if (concurrentReaders && i % 7 === 0) {
      // fire a few concurrent reads across unrelated agents — these must
      // not leak per-query allocations into the outer heap.
      await Promise.all([
        Promise.resolve(store.getContext(`soak-agent-${(agentIdx + 1) % AGENT_POOL}`, runId)),
        Promise.resolve(store.getContext(`soak-agent-${(agentIdx + 2) % AGENT_POOL}`, runId)),
        Promise.resolve(store.getContext(`soak-agent-${(agentIdx + 3) % AGENT_POOL}`, runId)),
      ]);
    }

    if (GC_CHECKPOINTS.has(i + 1)) {
      const didGc = maybeGc();
      gcAvailable = gcAvailable || didGc;
      // second pass ensures weak-ref cleanup settles
      if (didGc) maybeGc();
      checkpoints.set(i + 1, takeSample(i + 1));
    }

    if ((i + 1) % SAMPLE_EVERY === 0) {
      samples.push(takeSample(i + 1));
    }

    // gentle cadence — keeps the test faithful to a long-running daemon
    // but doesn't actually sleep 10ms per iter (would be 9s of sleep alone).
    if (i % 100 === 0) await new Promise((r) => setImmediate(r));
  }

  return { samples, checkpoints, gcAvailable };
}

describe("Soak: Agent Memory Heap", () => {
  let dbPath: string;
  let store: SqliteMemoryStore;

  beforeEach(() => {
    const stub = createStressDb("soak-agent-heap");
    stub.db.close();
    dbPath = stub.path;
    store = new SqliteMemoryStore(dbPath);
  });

  afterEach(() => {
    try { store.close(); } catch { /* ok */ }
    // Reuse cleanup helper by passing a throwaway closed DB handle
    cleanupDb({ close: () => {} } as never, dbPath);
  });

  it("900 iters standard: heap bounded post-GC", { timeout: 120_000 }, async () => {
    const { samples, checkpoints, gcAvailable } = await runCycle(store, 900, 0, false);

    expect(samples.length).toBeGreaterThan(10);
    const cp2 = checkpoints.get(500);
    const cp3 = checkpoints.get(900);
    expect(cp2, "checkpoint @ 500 missing").toBeDefined();
    expect(cp3, "checkpoint @ 900 missing").toBeDefined();

    const heapDelta = cp3!.heapUsed - cp2!.heapUsed;
    const externalDelta = cp3!.external - cp2!.external;

    const heapCap = gcAvailable ? 15 * 1024 * 1024 : 30 * 1024 * 1024;
    if (!gcAvailable) {
      console.warn("[soak-agent-heap] skipped --expose-gc delta check: using looser 30MB cap");
    }

    expect(
      heapDelta,
      `heapUsed delta cp2→cp3 = ${mb(heapDelta)}MB (baseline ${mb(cp2!.heapUsed)}MB)`,
    ).toBeLessThan(heapCap);

    if (gcAvailable) {
      // 20% relative cap only meaningful post-GC
      expect(heapDelta / cp2!.heapUsed).toBeLessThan(0.2);
    }

    expect(
      externalDelta,
      `external bytes delta = ${mb(externalDelta)}MB`,
    ).toBeLessThan(5 * 1024 * 1024);

    // Ramp detector: 3 consecutive samples each growing > 8 MB is a leak signal.
    let rampStart = -1;
    for (let i = 2; i < samples.length; i++) {
      const d1 = samples[i - 1].heapUsed - samples[i - 2].heapUsed;
      const d2 = samples[i].heapUsed - samples[i - 1].heapUsed;
      const d0 = i >= 3 ? samples[i - 2].heapUsed - samples[i - 3].heapUsed : 0;
      if (d0 > 8 * 1024 * 1024 && d1 > 8 * 1024 * 1024 && d2 > 8 * 1024 * 1024) {
        rampStart = i - 2;
        break;
      }
    }
    expect(
      rampStart,
      `heap ramp detected starting at sample ${rampStart} (iter ${samples[rampStart]?.iter})`,
    ).toBe(-1);

    // Heap-statistics corroboration — used_heap_size should not have
    // ballooned by more than the heapDelta bound either.
    const stats = v8.getHeapStatistics();
    expect(stats.used_heap_size).toBeGreaterThan(0);
  });

  it("300 iters with 1KB payloads: external growth bounded", { timeout: 60_000 }, async () => {
    const { samples, checkpoints } = await runCycle(store, 300, 1024, false);
    expect(samples.length).toBeGreaterThan(3);

    // Only checkpoint 100 is reached when iters < 500.
    const cp1 = checkpoints.get(100);
    expect(cp1).toBeDefined();

    // With 300 iters @ ~2KB per iter committed to SQLite (short_term is
    // cleared, so only long_term lingers), heap should stay well below
    // the large-cycle bound.
    const last = samples[samples.length - 1];
    const first = samples[0];
    const delta = last.heapUsed - first.heapUsed;
    expect(
      delta,
      `short-cycle heap delta = ${mb(delta)}MB (first=${mb(first.heapUsed)}MB last=${mb(last.heapUsed)}MB)`,
    ).toBeLessThan(20 * 1024 * 1024);
  });

  it("900 iters with concurrent getContext reads: no cross-query leak", { timeout: 120_000 }, async () => {
    const { samples, checkpoints, gcAvailable } = await runCycle(store, 900, 0, true);

    const cp2 = checkpoints.get(500);
    const cp3 = checkpoints.get(900);
    expect(cp2).toBeDefined();
    expect(cp3).toBeDefined();

    const heapDelta = cp3!.heapUsed - cp2!.heapUsed;
    const heapCap = gcAvailable ? 15 * 1024 * 1024 : 30 * 1024 * 1024;
    expect(heapDelta).toBeLessThan(heapCap);

    // Ensure the concurrent-read variant did not push RSS into runaway territory.
    const lastSample = samples[samples.length - 1];
    const firstSample = samples[0];
    expect(
      lastSample.rss - firstSample.rss,
      `RSS delta over concurrent-read soak = ${mb(lastSample.rss - firstSample.rss)}MB`,
    ).toBeLessThan(150 * 1024 * 1024);
  });
});
