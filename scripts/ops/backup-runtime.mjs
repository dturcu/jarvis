import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_PROFILE,
  buildBackupManifest,
  copyTree,
  ensureDir,
  loadProfileConfig,
  parseArgs,
  resolveBackupRoot,
  resolveReportRoot,
  readJsonIfExists,
  timestampStamp,
  writeJson
} from "./common.mjs";

async function copyIfExists(source, target) {
  if (!source) {
    return false;
  }
  try {
    await copyTree(source, target);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function escapeSqlitePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "''");
}

async function snapshotSqliteDatabase(sourcePath, targetPath) {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) {
      throw error;
    }
  }

  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec(`VACUUM INTO '${escapeSqlitePath(targetPath)}'`);
  } finally {
    try { db.close(); } catch {}
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = args.profile ?? process.env.JARVIS_OPS_PROFILE ?? DEFAULT_PROFILE;
  const bundleRoot = args["bundle-root"] ? path.resolve(args["bundle-root"]) : resolveBackupRoot(profile);
  const stamp = timestampStamp();
  const bundleDir = path.join(bundleRoot, stamp);
  const profileTarget = path.join(bundleDir, "profile");
  const workspaceTarget = path.join(bundleDir, "workspace");
  const reportsTarget = path.join(bundleDir, "reports");

  const { configPath, configSummary, profileDir, workspacePath } = await loadProfileConfig(profile);
  await ensureDir(bundleDir);

  const copiedProfile = await copyIfExists(profileDir, profileTarget);
  const copiedWorkspace = await copyIfExists(workspacePath, workspaceTarget);

  const copiedArtifacts = [];
  const latestOpsReportPath = path.join(resolveReportRoot(), `${profile}-latest.json`);
  const latestOpsReport = await readJsonIfExists(latestOpsReportPath);
  if (latestOpsReport) {
    await ensureDir(reportsTarget);
    const copiedReportPath = path.join(reportsTarget, "latest.json");
    await writeJson(copiedReportPath, latestOpsReport);
    copiedArtifacts.push(copiedReportPath);
  }

  // Backup Jarvis runtime databases (~/.jarvis/*.db)
  const jarvisDir = path.join(os.homedir(), ".jarvis");
  const jarvisTarget = path.join(bundleDir, "jarvis");
  const copiedDatabases = [];
  for (const dbName of ["runtime.db", "crm.db", "knowledge.db"]) {
    const dbPath = path.join(jarvisDir, dbName);
    try {
      await fs.access(dbPath);
      await ensureDir(jarvisTarget);
      await snapshotSqliteDatabase(dbPath, path.join(jarvisTarget, dbName));
      copiedDatabases.push(dbName);
    } catch { /* db doesn't exist, skip */ }
  }
  // Copy config.json if it exists
  try {
    const configJsonPath = path.join(jarvisDir, "config.json");
    await fs.access(configJsonPath);
    await ensureDir(jarvisTarget);
    await fs.copyFile(configJsonPath, path.join(jarvisTarget, "config.json"));
  } catch { /* no config.json */ }

  // Compute checksums for integrity verification
  const checksums = {};
  for (const dbName of copiedDatabases) {
    const filePath = path.join(jarvisTarget, dbName);
    const content = await fs.readFile(filePath);
    checksums[dbName] = crypto.createHash("sha256").update(content).digest("hex");
  }

  const manifest = buildBackupManifest({
    profile,
    bundleDir,
    configPath,
    profileDir,
    workspacePath,
    configSummary,
    copiedWorkspace,
    copiedArtifacts
  });
  manifest.jarvisDatabases = copiedDatabases;
  manifest.checksums = checksums;

  await writeJson(path.join(bundleDir, "manifest.json"), manifest);

  const reportRoot = resolveReportRoot();
  await ensureDir(reportRoot);
  await writeJson(path.join(reportRoot, `${profile}-backup-latest.json`), manifest);

  process.stdout.write(`${JSON.stringify({
    profile,
    bundleDir,
    copiedProfile,
    copiedWorkspace,
    manifestPath: path.join(bundleDir, "manifest.json"),
    configPath,
    workspacePath
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
