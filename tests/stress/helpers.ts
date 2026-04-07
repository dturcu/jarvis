import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations } from "@jarvis/runtime";

// ── Database factories ──────────────────────────────────────────────────────

export function createStressDb(label = "stress"): { db: DatabaseSync; path: string } {
  const dbPath = join(os.tmpdir(), `jarvis-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return { db, path: dbPath };
}

export function cleanupDb(db: DatabaseSync, dbPath: string): void {
  try { db.close(); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
}

// ── Performance measurement ─────────────────────────────────────────────────

export type StressMetrics = {
  label: string;
  totalOps: number;
  errors: number;
  durations: number[];
  startTime: number;
  endTime: number;
};

export function createMetrics(label: string): StressMetrics {
  return { label, totalOps: 0, errors: 0, durations: [], startTime: 0, endTime: 0 };
}

export async function measureAsync<T>(
  metrics: StressMetrics,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    metrics.durations.push(performance.now() - start);
    metrics.totalOps++;
    return result;
  } catch (e) {
    metrics.durations.push(performance.now() - start);
    metrics.totalOps++;
    metrics.errors++;
    throw e;
  }
}

export function measureSync<T>(
  metrics: StressMetrics,
  fn: () => T,
): T {
  const start = performance.now();
  try {
    const result = fn();
    metrics.durations.push(performance.now() - start);
    metrics.totalOps++;
    return result;
  } catch (e) {
    metrics.durations.push(performance.now() - start);
    metrics.totalOps++;
    metrics.errors++;
    throw e;
  }
}

export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function reportMetrics(metrics: StressMetrics): {
  totalOps: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  throughput: number;
} {
  const elapsed = (metrics.endTime - metrics.startTime) / 1000;
  return {
    totalOps: metrics.totalOps,
    errors: metrics.errors,
    p50: Math.round(percentile(metrics.durations, 50) * 100) / 100,
    p95: Math.round(percentile(metrics.durations, 95) * 100) / 100,
    p99: Math.round(percentile(metrics.durations, 99) * 100) / 100,
    throughput: elapsed > 0 ? Math.round(metrics.totalOps / elapsed) : metrics.totalOps,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
