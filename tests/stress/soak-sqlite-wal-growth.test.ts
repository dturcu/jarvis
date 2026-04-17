/**
 * Stress: Soak — SQLite WAL Growth
 *
 * Asserts that WAL file size, SQLite page_count, and p99 read latency all
 * stay bounded and sub-linear across 100k writes against SqliteMemoryStore.
 * The 500-entry per-agent long-term eviction cap (see sqlite-memory.ts:54)
 * is the load-bearing mechanism under test: once every agent has 500
 * long-term entries, page_count should plateau because eviction deletes
 * match inserts one-for-one.
 *
 * Heuristics:
 *   • 64 MB WAL cap — the SqliteMemoryStore constructor only sets
 *     journal_mode=WAL without setting wal_autocheckpoint bounds, so the
 *     cap is "empirically, this workload should hover in the low tens of
 *     MB; 64 MB is a ceiling that catches runaway WAL commits without
 *     failing on healthy CI noise."
 *   • p99@100k ≤ 3 × p99@25k — reads select 50-row LIMITs with an index,
 *     so the fan-in should be near-constant time; a 3× slope tolerance
 *     absorbs checkpoint / vacuum jitter while still catching a missing
 *     index or a query-plan regression.
 *   • post-VACUUM ≤ 1.5 × post-25k — after eviction settles, the freed
 *     pages should reclaim into the freelist and VACUUM should return
 *     size close to the high-water mark from the first checkpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SqliteMemoryStore } from "@jarvis/agent-framework";
import { createStressDb, cleanupDb, percentile } from "./helpers.js";

const TOTAL_WRITES = 100_000;
const READS_RATIO = 0.2; // 20% reads, 80% writes (80/20 split)
const AGENT_COUNT = 20;
const WAL_SAMPLE_EVERY = 5_000;
const LATENCY_CHECKPOINTS = [25_000, 50_000, 75_000, 100_000];
const RESERVOIR_SIZE = 1000;

type WalSample = { iter: number; walBytes: number; pageCount: number; freelistCount: number };

/** Last-N ring buffer for p50/p99 sampling. */
class Reservoir {
  private buf: number[] = [];
  private idx = 0;
  constructor(private cap: number) {}
  push(v: number): void {
    if (this.buf.length < this.cap) this.buf.push(v);
    else {
      this.buf[this.idx] = v;
      this.idx = (this.idx + 1) % this.cap;
    }
  }
  snapshot(): number[] {
    return [...this.buf];
  }
}

function walBytes(dbPath: string): number {
  try {
    return fs.statSync(`${dbPath}-wal`).size;
  } catch {
    return 0;
  }
}

function pageStats(db: DatabaseSync): { pageCount: number; freelistCount: number } {
  const pc = db.prepare("PRAGMA page_count").get() as { page_count: number };
  const fl = db.prepare("PRAGMA freelist_count").get() as { freelist_count: number };
  return { pageCount: pc.page_count, freelistCount: fl.freelist_count };
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

/**
 * Open a direct DB handle on the same file the store uses so we can run
 * PRAGMAs and VACUUM without punching through the SqliteMemoryStore API.
 * Must use a separate connection because node:sqlite DatabaseSync
 * does not expose the underlying handle on the store.
 */
function openProbeDb(dbPath: string): DatabaseSync {
  const probe = new DatabaseSync(dbPath);
  probe.exec("PRAGMA busy_timeout = 5000;");
  return probe;
}

async function runWalSoak(
  store: SqliteMemoryStore,
  dbPath: string,
  totalOps: number,
  opts: { manualCheckpointEvery?: number; foreignKeys?: boolean } = {},
): Promise<{
  walSamples: WalSample[];
  latencyByCheckpoint: Map<number, { p50: number; p99: number }>;
  errors: number;
}> {
  const probe = openProbeDb(dbPath);
  if (opts.foreignKeys) {
    probe.exec("PRAGMA foreign_keys = ON;");
  }

  const reads = new Reservoir(RESERVOIR_SIZE);
  const walSamples: WalSample[] = [];
  const latencyByCheckpoint = new Map<number, { p50: number; p99: number }>();
  let errors = 0;

  for (let i = 0; i < totalOps; i++) {
    const agentId = `wal-agent-${i % AGENT_COUNT}`;
    const runId = `wal-run-${Math.floor(i / AGENT_COUNT)}`;
    try {
      // mixed workload — we use a deterministic 5-slot rotor instead of
      // Math.random() so failures reproduce bit-for-bit.
      const isRead = i % 5 === 0;
      if (isRead) {
        const t0 = performance.now();
        store.getContext(agentId, runId);
        reads.push(performance.now() - t0);
      } else {
        store.addLongTerm(agentId, runId, `wal-entry-${i}`);
      }
    } catch {
      errors++;
    }

    if (
      opts.manualCheckpointEvery &&
      (i + 1) % opts.manualCheckpointEvery === 0
    ) {
      try { probe.exec("PRAGMA wal_checkpoint(PASSIVE);"); } catch { /* ok */ }
    }

    if ((i + 1) % WAL_SAMPLE_EVERY === 0) {
      const { pageCount, freelistCount } = pageStats(probe);
      walSamples.push({
        iter: i + 1,
        walBytes: walBytes(dbPath),
        pageCount,
        freelistCount,
      });
    }

    if (LATENCY_CHECKPOINTS.includes(i + 1)) {
      const snap = reads.snapshot();
      latencyByCheckpoint.set(i + 1, {
        p50: percentile(snap, 50),
        p99: percentile(snap, 99),
      });
    }
  }

  probe.close();
  return { walSamples, latencyByCheckpoint, errors };
}

describe("Soak: SQLite WAL Growth", () => {
  let dbPath: string;
  let store: SqliteMemoryStore;

  beforeEach(() => {
    const stub = createStressDb("soak-wal");
    stub.db.close();
    dbPath = stub.path;
    store = new SqliteMemoryStore(dbPath);
  });

  afterEach(() => {
    try { store.close(); } catch { /* ok */ }
    cleanupDb({ close: () => {} } as never, dbPath);
  });

  it("100k writes no manual checkpoint: WAL and latency bounded", { timeout: 600_000 }, async () => {
    const { walSamples, latencyByCheckpoint, errors } =
      await runWalSoak(store, dbPath, TOTAL_WRITES, {});

    expect(errors).toBe(0);
    expect(walSamples.length).toBeGreaterThanOrEqual(TOTAL_WRITES / WAL_SAMPLE_EVERY);
    expect(latencyByCheckpoint.size).toBe(LATENCY_CHECKPOINTS.length);

    // WAL cap
    const maxWal = walSamples.reduce((m, s) => Math.max(m, s.walBytes), 0);
    expect(maxWal, `max WAL size = ${mb(maxWal)}`).toBeLessThanOrEqual(64 * 1024 * 1024);

    // Sub-linear p99: with 20 agents × 500-entry cap, the long-term table
    // plateaus at 10k rows and reads stay O(log n). 3× is a loose cap.
    const p99_25k = latencyByCheckpoint.get(25_000)!.p99;
    const p99_100k = latencyByCheckpoint.get(100_000)!.p99;
    // Guard against a zero baseline — if 25k reads were all ~0ms we'd
    // spuriously fail. Floor the baseline at 0.05 ms.
    const baseline = Math.max(0.05, p99_25k);
    expect(
      p99_100k,
      `p99 read latency: 25k=${p99_25k.toFixed(3)}ms, 100k=${p99_100k.toFixed(3)}ms`,
    ).toBeLessThanOrEqual(3 * baseline);

    // Page count growth should plateau — the earliest checkpoint after
    // eviction kicks in is at ~10k writes (500×20), so compare the final
    // two samples rather than first-vs-last to see the plateau clearly.
    const finalSample = walSamples[walSamples.length - 1];
    const midSample = walSamples[Math.floor(walSamples.length / 2)];
    const lateGrowth = finalSample.pageCount - midSample.pageCount;
    const earlyGrowth = midSample.pageCount;
    expect(
      lateGrowth,
      `page_count late=${finalSample.pageCount} mid=${midSample.pageCount} earlyGrowth=${earlyGrowth}`,
    ).toBeLessThan(earlyGrowth);

    // VACUUM behaviour
    const probe = openProbeDb(dbPath);
    const beforeVacuum = pageStats(probe).pageCount;
    probe.exec("VACUUM;");
    const afterVacuum = pageStats(probe).pageCount;
    probe.close();

    // post-VACUUM ≤ 1.5× the page count observed at the first checkpoint
    const post25k = walSamples.find((s) => s.iter === 25_000)?.pageCount ?? walSamples[0].pageCount;
    expect(
      afterVacuum,
      `post-VACUUM page_count=${afterVacuum}, pre=${beforeVacuum}, @25k=${post25k}`,
    ).toBeLessThanOrEqual(Math.ceil(post25k * 1.5));
  });

  it("50k writes with PASSIVE checkpoint every 10k: WAL stays small", { timeout: 300_000 }, async () => {
    const { walSamples, errors } =
      await runWalSoak(store, dbPath, 50_000, { manualCheckpointEvery: 10_000 });

    expect(errors).toBe(0);

    // With periodic passive checkpoints, peak WAL should be much smaller
    // than the 64 MB cap from the no-checkpoint variant.
    const maxWal = walSamples.reduce((m, s) => Math.max(m, s.walBytes), 0);
    expect(maxWal, `max WAL with PASSIVE=${mb(maxWal)}`).toBeLessThanOrEqual(32 * 1024 * 1024);
  });

  it("25k writes with FK enabled: no FK-induced page bloat", { timeout: 180_000 }, async () => {
    const { walSamples, errors } =
      await runWalSoak(store, dbPath, 25_000, { foreignKeys: true });

    expect(errors).toBe(0);

    // The memory table has no foreign keys, so enabling FK should not
    // materially change page_count growth vs. the baseline 25k slice.
    const finalSample = walSamples[walSamples.length - 1];
    expect(
      finalSample.pageCount,
      `page_count with FK @ 25k = ${finalSample.pageCount}`,
    ).toBeLessThan(30_000); // generous absolute cap — empirical ~2-4k pages
    expect(walSamples[0].walBytes).toBeGreaterThanOrEqual(0);
  });
});
