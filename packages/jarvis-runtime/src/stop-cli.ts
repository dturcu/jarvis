/**
 * Stop the running Jarvis daemon by sending SIGTERM to the heartbeat PID.
 *
 * Usage: jarvis stop
 */

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { RUNTIME_DB_PATH } from "./config.js";

function main() {
  if (!fs.existsSync(RUNTIME_DB_PATH)) {
    console.log("Runtime database not found. Daemon is not running.");
    return;
  }

  const db = new DatabaseSync(RUNTIME_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");

  const row = db.prepare(
    "SELECT pid, last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1",
  ).get() as { pid: number; last_seen_at: string } | undefined;

  db.close();

  if (!row) {
    console.log("No daemon heartbeat found. Daemon is not running.");
    return;
  }

  const lastSeen = new Date(row.last_seen_at);
  const stale = Date.now() - lastSeen.getTime() > 30_000;

  if (stale) {
    console.log(`Daemon heartbeat is stale (last seen ${row.last_seen_at}). Daemon may have already stopped.`);
    return;
  }

  try {
    process.kill(row.pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (PID ${row.pid}). Daemon will drain and shut down.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") {
      console.log(`PID ${row.pid} not found. Daemon already stopped.`);
    } else {
      console.error(`Failed to stop daemon: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}

main();
