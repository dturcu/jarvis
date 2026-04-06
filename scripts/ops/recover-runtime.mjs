import path from "node:path";
import {
  DEFAULT_PROFILE,
  copyTree,
  ensureDir,
  findLatestBackupBundle,
  parseArgs,
  readJsonIfExists,
  resolveProfileConfigPath,
  resolveProfileDir,
  resolveReportRoot,
  runHealthChecks,
  writeJson
} from "./common.mjs";

async function restoreBundle(bundleDir, profile, restoreWorkspace) {
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = await readJsonIfExists(manifestPath);
  if (!manifest) {
    throw new Error(`Backup manifest missing at ${manifestPath}.`);
  }

  const activeProfileDir = resolveProfileDir(profile);
  const activeConfigPath = resolveProfileConfigPath(profile);
  const bundleProfileDir = path.join(bundleDir, "profile");
  const bundleWorkspaceDir = path.join(bundleDir, "workspace");

  await ensureDir(activeProfileDir);
  await copyTree(bundleProfileDir, activeProfileDir);

  if (restoreWorkspace && manifest.workspacePath) {
    try {
      await copyTree(bundleWorkspaceDir, manifest.workspacePath);
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) {
        throw error;
      }
    }
  }

  return {
    manifest,
    activeProfileDir,
    activeConfigPath
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = args.profile ?? process.env.JARVIS_OPS_PROFILE ?? DEFAULT_PROFILE;
  const restoreWorkspace = args["restore-workspace"] !== "0";
  const bundleDir = args.bundle ? path.resolve(args.bundle) : await findLatestBackupBundle(profile);

  if (!bundleDir) {
    throw new Error(`No backup bundle found for profile ${profile}. Run npm run ops:backup first.`);
  }

  const restored = await restoreBundle(bundleDir, profile, restoreWorkspace);
  const health = await runHealthChecks({
    profile
  });

  const reportRoot = resolveReportRoot();
  await ensureDir(reportRoot);
  const report = {
    profile,
    bundleDir,
    restored,
    health
  };
  await writeJson(path.join(reportRoot, `${profile}-recovery-latest.json`), report);

  process.stdout.write(`${JSON.stringify({
    profile,
    bundleDir,
    activeConfigPath: restored.activeConfigPath,
    status: health.status,
    recommendations: health.recommendations
  }, null, 2)}\n`);

  if (health.status !== "ok") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
