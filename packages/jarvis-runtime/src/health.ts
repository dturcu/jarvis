/**
 * Reusable health check logic for Jarvis runtime.
 *
 * Used by both the dashboard API /api/health endpoint and `jarvis doctor`.
 */

import fs from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JARVIS_DIR, CRM_DB_PATH, KNOWLEDGE_DB_PATH, RUNTIME_DB_PATH } from "./config.js";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export type HealthReport = {
  status: HealthStatus;
  uptime_seconds: number;
  crm: { ok: boolean; contacts: number };
  knowledge: { ok: boolean; documents: number; playbooks: number; decisions: number };
  runtime: { ok: boolean; pending_approvals: number; pending_commands: number; recent_runs: number };
  daemon: { running: boolean; pid: number | null; last_seen: string | null };
  disk_free_gb: number | null;
};

export type ReadinessReport = {
  ready: boolean;
  checks: {
    jarvis_dir: boolean;
    crm_db: boolean;
    knowledge_db: boolean;
    runtime_db: boolean;
    daemon_running: boolean;
  };
};

const startTime = Date.now();

function queryCount(db: DatabaseSync, sql: string): number {
  try {
    return (db.prepare(sql).get() as { n: number }).n;
  } catch {
    return 0;
  }
}

export function getHealthReport(): HealthReport {
  const report: HealthReport = {
    status: "healthy",
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    crm: { ok: false, contacts: 0 },
    knowledge: { ok: false, documents: 0, playbooks: 0, decisions: 0 },
    runtime: { ok: false, pending_approvals: 0, pending_commands: 0, recent_runs: 0 },
    daemon: { running: false, pid: null, last_seen: null },
    disk_free_gb: null,
  };

  // CRM
  try {
    const crm = new DatabaseSync(CRM_DB_PATH);
    report.crm.contacts = queryCount(crm, "SELECT COUNT(*) as n FROM contacts");
    report.crm.ok = true;
    crm.close();
  } catch { /* CRM unavailable */ }

  // Knowledge
  try {
    const kb = new DatabaseSync(KNOWLEDGE_DB_PATH);
    report.knowledge.documents = queryCount(kb, "SELECT COUNT(*) as n FROM documents");
    report.knowledge.playbooks = queryCount(kb, "SELECT COUNT(*) as n FROM playbooks");
    report.knowledge.decisions = queryCount(kb, "SELECT COUNT(*) as n FROM decisions");
    report.knowledge.ok = true;
    kb.close();
  } catch { /* Knowledge unavailable */ }

  // Runtime
  try {
    const rtDb = new DatabaseSync(RUNTIME_DB_PATH);
    rtDb.exec("PRAGMA journal_mode = WAL;");
    rtDb.exec("PRAGMA busy_timeout = 5000;");

    report.runtime.pending_approvals = queryCount(rtDb, "SELECT COUNT(*) as n FROM approvals WHERE status = 'pending'");
    report.runtime.pending_commands = queryCount(rtDb, "SELECT COUNT(*) as n FROM agent_commands WHERE status = 'queued'");
    report.runtime.recent_runs = queryCount(rtDb, "SELECT COUNT(DISTINCT run_id) as n FROM run_events WHERE created_at > datetime('now', '-24 hours')");
    report.runtime.ok = true;

    // Daemon heartbeat
    const heartbeat = rtDb.prepare(
      "SELECT pid, last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1",
    ).get() as { pid: number; last_seen_at: string } | undefined;

    if (heartbeat) {
      const stale = Date.now() - new Date(heartbeat.last_seen_at).getTime() > 30_000;
      report.daemon.running = !stale;
      report.daemon.pid = heartbeat.pid;
      report.daemon.last_seen = heartbeat.last_seen_at;
    }

    rtDb.close();
  } catch { /* Runtime unavailable */ }

  // Disk
  try {
    if (fs.existsSync(JARVIS_DIR)) {
      const stats = fs.statfsSync(JARVIS_DIR);
      report.disk_free_gb = parseFloat(((stats.bfree * stats.bsize) / (1024 ** 3)).toFixed(1));
    }
  } catch { /* can't check disk */ }

  // Determine overall status
  if (!report.crm.ok || !report.knowledge.ok || !report.runtime.ok) {
    report.status = "unhealthy";
  } else if (!report.daemon.running || (report.disk_free_gb !== null && report.disk_free_gb < 2)) {
    report.status = "degraded";
  }

  return report;
}

export function getReadinessReport(): ReadinessReport {
  const checks = {
    jarvis_dir: fs.existsSync(JARVIS_DIR),
    crm_db: fs.existsSync(CRM_DB_PATH),
    knowledge_db: fs.existsSync(KNOWLEDGE_DB_PATH),
    runtime_db: fs.existsSync(RUNTIME_DB_PATH),
    daemon_running: false,
  };

  // Check daemon heartbeat
  if (checks.runtime_db) {
    try {
      const rtDb = new DatabaseSync(RUNTIME_DB_PATH);
      rtDb.exec("PRAGMA journal_mode = WAL;");
      rtDb.exec("PRAGMA busy_timeout = 5000;");
      const row = rtDb.prepare(
        "SELECT last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1",
      ).get() as { last_seen_at: string } | undefined;
      rtDb.close();

      if (row) {
        checks.daemon_running = Date.now() - new Date(row.last_seen_at).getTime() < 30_000;
      }
    } catch { /* can't check */ }
  }

  return {
    ready: checks.jarvis_dir && checks.crm_db && checks.knowledge_db && checks.runtime_db && checks.daemon_running,
    checks,
  };
}
