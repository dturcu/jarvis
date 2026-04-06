/**
 * Show daemon status from runtime.db heartbeat.
 *
 * Usage: jarvis status
 */

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { RUNTIME_DB_PATH } from "./config.js";

function main() {
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    console.log("Runtime database not found. Run: jarvis init");
    process.exitCode = 1;
    return;
  }

  const db = new DatabaseSync(RUNTIME_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");

  const row = db.prepare(
    "SELECT daemon_id, pid, status, last_seen_at, details_json FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1",
  ).get() as { daemon_id: string; pid: number; status: string; last_seen_at: string; details_json: string } | undefined;

  db.close();

  if (!row) {
    console.log("No daemon heartbeat found. Daemon has not been started.");
    return;
  }

  const lastSeen = new Date(row.last_seen_at);
  const stale = Date.now() - lastSeen.getTime() > 30_000;
  const details = row.details_json ? JSON.parse(row.details_json) as Record<string, unknown> : {};

  console.log("\n  Jarvis Daemon Status\n");
  console.log(`  Status:     ${stale ? "STOPPED (heartbeat stale)" : "RUNNING"}`);
  console.log(`  PID:        ${row.pid}`);
  console.log(`  Last seen:  ${row.last_seen_at}`);

  if (details.started_at) {
    const uptime = Math.floor((Date.now() - new Date(details.started_at as string).getTime()) / 1000);
    if (!stale) {
      console.log(`  Uptime:     ${formatDuration(uptime)}`);
    }
  }

  if (details.agents_registered) {
    console.log(`  Agents:     ${details.agents_registered}`);
  }
  if (details.schedules_active) {
    console.log(`  Schedules:  ${details.schedules_active}`);
  }

  const current = details.current_run as Record<string, unknown> | null;
  if (current && !stale) {
    console.log(`  Running:    ${current.agent_id} (step ${current.step}/${current.total_steps})`);
  }

  console.log("");
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

main();
