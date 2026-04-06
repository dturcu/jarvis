import {
  bootstrapRuntime,
  modelIdentifier,
  modelRef,
  modelSourceKey,
  smokeAgentId,
  smokeProfile,
  serializeError
} from "./common.mjs";

async function main() {
  const skipBuild = process.env.JARVIS_SMOKE_SKIP_BUILD === "1";
  const startedAt = new Date().toISOString();

  try {
    const runtime = await bootstrapRuntime({ profile: smokeProfile, agentId: smokeAgentId, skipBuild });
    const report = {
      status: "ok",
      startedAt,
      finishedAt: new Date().toISOString(),
      profile: smokeProfile,
      agentId: smokeAgentId,
      configPath: runtime.configPath,
      mainWorkspaceDir: runtime.mainWorkspaceDir,
      leanWorkspaceDir: runtime.leanWorkspaceDir,
      stateFilePath: runtime.stateFilePath,
      modelKey: modelSourceKey,
      modelId: modelIdentifier,
      modelRef
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const report = {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      profile: smokeProfile,
      agentId: smokeAgentId,
      error: serializeError(error)
    };

    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${serializeError(error)}\n`);
  process.exit(1);
});
