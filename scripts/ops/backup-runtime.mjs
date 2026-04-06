import path from "node:path";
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
