import path from "node:path";
import {
  DEFAULT_GATEWAY_PORT,
  DEFAULT_LMSTUDIO_PORT,
  DEFAULT_MODEL_IDENTIFIER,
  DEFAULT_PROFILE,
  ensureDir,
  loadProfileConfig,
  parseArgs,
  resolveReportRoot,
  runHealthChecks,
  timestampStamp,
  writeJson
} from "./common.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = args.profile ?? process.env.JARVIS_OPS_PROFILE ?? DEFAULT_PROFILE;
  const gatewayPort = Number(args["gateway-port"] ?? process.env.JARVIS_OPS_GATEWAY_PORT ?? DEFAULT_GATEWAY_PORT);
  const lmstudioPort = Number(args["lmstudio-port"] ?? process.env.JARVIS_OPS_LMSTUDIO_PORT ?? DEFAULT_LMSTUDIO_PORT);
  const modelIdentifier =
    args["model-identifier"] ?? process.env.JARVIS_OPS_MODEL_ID ?? DEFAULT_MODEL_IDENTIFIER;

  const config = await loadProfileConfig(profile);
  const health = await runHealthChecks({
    profile,
    gatewayPort,
    lmstudioPort,
    modelIdentifier
  });

  const reportRoot = resolveReportRoot();
  const stamp = timestampStamp();
  const reportPath = path.join(reportRoot, `${profile}-${stamp}.json`);
  const latestPath = path.join(reportRoot, `${profile}-latest.json`);
  await ensureDir(reportRoot);
  await writeJson(reportPath, {
    ...health,
    runtime: {
      gatewayPort,
      lmstudioPort,
      modelIdentifier
    },
    config: config.configSummary
  });
  await writeJson(latestPath, {
    ...health,
    runtime: {
      gatewayPort,
      lmstudioPort,
      modelIdentifier
    },
    config: config.configSummary
  });

  process.stdout.write(`${JSON.stringify({
    profile,
    status: health.status,
    reportPath,
    configPath: health.configPath,
    gatewayHealthy: Boolean(health.gateway?.ok || health.gateway?.data?.ok),
    pinnedModelPresent: Boolean(health.lmstudio?.pinnedModelPresent),
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

