/**
 * RT-705: Jarvis doctor command.
 *
 * Checks operational health of the Jarvis system and prints a checklist.
 * Exits with code 0 if all OK/WARN, code 1 if any FAIL.
 *
 * Usage:
 *   npx tsx scripts/doctor.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ─── Paths ──────────────────────────────────────────────────────────────────

const JARVIS_DIR = join(homedir(), ".jarvis");
const CONFIG_PATH = join(JARVIS_DIR, "config.json");
const CRM_DB_PATH = join(JARVIS_DIR, "crm.db");
const KNOWLEDGE_DB_PATH = join(JARVIS_DIR, "knowledge.db");
const RUNTIME_DB_PATH = join(JARVIS_DIR, "runtime.sqlite");
const DASHBOARD_INDEX = join("packages", "jarvis-dashboard", "dist", "index.html");

// ─── Result tracking ────────────────────────────────────────────────────────

type Level = "OK" | "WARN" | "FAIL";

let hasFail = false;

function report(level: Level, message: string): void {
  if (level === "FAIL") hasFail = true;
  console.log(`[${level}] ${message}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { n: number } | undefined;
  return row != null && row.n > 0;
}

function tableCount(db: DatabaseSync, table: string): number {
  if (!tableExists(db, table)) return -1;
  const row = db.prepare(`SELECT COUNT(*) as n FROM "${table}"`).get() as { n: number };
  return row.n;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Checks ─────────────────────────────────────────────────────────────────

function checkDirectory(): void {
  if (existsSync(JARVIS_DIR)) {
    report("OK", `Directory ${JARVIS_DIR} exists`);
  } else {
    report("FAIL", `Directory ${JARVIS_DIR} does not exist`);
  }
}

function checkConfig(): { lmstudioUrl: string | null } {
  if (!existsSync(CONFIG_PATH)) {
    report("WARN", "config.json not found (using defaults)");
    return { lmstudioUrl: "http://localhost:1234" };
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;

    const errors: string[] = [];
    if (typeof raw.lmstudio_url !== "string") errors.push("missing lmstudio_url");
    if (typeof raw.adapter_mode !== "string") errors.push("missing adapter_mode");

    if (errors.length > 0) {
      report("FAIL", `config.json invalid: ${errors.join(", ")}`);
      return { lmstudioUrl: null };
    }

    report("OK", "config.json valid");
    return { lmstudioUrl: raw.lmstudio_url as string };
  } catch (err) {
    report("FAIL", `config.json parse error: ${err instanceof Error ? err.message : String(err)}`);
    return { lmstudioUrl: null };
  }
}

function checkCrmDb(): void {
  if (!existsSync(CRM_DB_PATH)) {
    report("FAIL", "crm.db not found");
    return;
  }

  const db = new DatabaseSync(CRM_DB_PATH, { readOnly: true });
  try {
    if (!tableExists(db, "contacts")) {
      report("FAIL", "crm.db missing 'contacts' table");
      return;
    }
    const count = tableCount(db, "contacts");
    report("OK", `crm.db (${count} contacts)`);
  } finally {
    db.close();
  }
}

function checkKnowledgeDb(): void {
  if (!existsSync(KNOWLEDGE_DB_PATH)) {
    report("FAIL", "knowledge.db not found");
    return;
  }

  const db = new DatabaseSync(KNOWLEDGE_DB_PATH, { readOnly: true });
  try {
    const missingTables: string[] = [];
    for (const table of ["documents", "decisions"]) {
      if (!tableExists(db, table)) missingTables.push(table);
    }

    if (missingTables.length > 0) {
      report("FAIL", `knowledge.db missing tables: ${missingTables.join(", ")}`);
      return;
    }

    const docs = tableCount(db, "documents");
    const playbooks = tableExists(db, "playbooks") ? tableCount(db, "playbooks") : 0;
    const decisions = tableCount(db, "decisions");
    report("OK", `knowledge.db (${docs} documents, ${playbooks} playbooks, ${decisions} decisions)`);
  } finally {
    db.close();
  }
}

function checkRuntimeDb(): void {
  if (!existsSync(RUNTIME_DB_PATH)) {
    report("FAIL", "runtime.sqlite not found");
    return;
  }

  const db = new DatabaseSync(RUNTIME_DB_PATH, { readOnly: true });
  try {
    // Check expected JarvisState tables
    const expectedTables = ["jobs", "approvals", "dispatches"];
    const missingTables: string[] = [];
    for (const table of expectedTables) {
      if (!tableExists(db, table)) missingTables.push(table);
    }

    if (missingTables.length > 0) {
      report("FAIL", `runtime.sqlite missing tables: ${missingTables.join(", ")}`);
      return;
    }

    const jobs = tableCount(db, "jobs");
    const approvals = tableCount(db, "approvals");
    const dispatches = tableCount(db, "dispatches");
    report("OK", `runtime.sqlite (${jobs} jobs, ${approvals} approvals, ${dispatches} dispatches)`);

    // Stale run check — runs stuck in executing/planning without completion
    checkStaleRuns(db);

    // Orphan check — daemon heartbeats with dead PIDs
    checkOrphanDaemons(db);
  } finally {
    db.close();
  }
}

function checkStaleRuns(db: DatabaseSync): void {
  if (!tableExists(db, "jobs")) return;

  // Jobs in running state with expired leases
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM jobs
       WHERE status = 'running'
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at < ?`,
    )
    .get(now) as { n: number };

  if (row.n > 0) {
    report("WARN", `${row.n} stalled job(s) with expired leases`);
  }
}

function checkOrphanDaemons(db: DatabaseSync): void {
  if (!tableExists(db, "daemon_heartbeats")) return;

  const rows = db
    .prepare("SELECT daemon_id, pid FROM daemon_heartbeats WHERE pid IS NOT NULL")
    .all() as Array<{ daemon_id: string; pid: number }>;

  let orphans = 0;
  for (const row of rows) {
    if (!isProcessAlive(row.pid)) {
      orphans++;
    }
  }

  if (orphans > 0) {
    report("WARN", `${orphans} daemon heartbeat(s) with dead PID(s)`);
  }
}

async function checkLmStudio(url: string | null): Promise<void> {
  if (!url) {
    report("WARN", "LM Studio URL unknown (config not loaded)");
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${url}/v1/models`, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      report("OK", `LM Studio reachable at ${url}`);
    } else {
      report("FAIL", `LM Studio returned HTTP ${response.status} at ${url}`);
    }
  } catch {
    report("FAIL", `LM Studio not reachable at ${url}`);
  }
}

function checkDashboard(): void {
  if (existsSync(DASHBOARD_INDEX)) {
    report("OK", "Dashboard build exists");
  } else {
    report("WARN", "Dashboard not built (run 'npm run dashboard:build')");
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Jarvis Doctor");
  console.log("=============\n");

  checkDirectory();
  const { lmstudioUrl } = checkConfig();
  checkCrmDb();
  checkKnowledgeDb();
  checkRuntimeDb();
  await checkLmStudio(lmstudioUrl);
  checkDashboard();

  console.log("");
  if (hasFail) {
    console.log("Result: UNHEALTHY (one or more checks failed)\n");
    process.exit(1);
  } else {
    console.log("Result: HEALTHY\n");
  }
}

main();
