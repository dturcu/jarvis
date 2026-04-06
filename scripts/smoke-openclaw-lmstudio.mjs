import {
  bootstrapRuntime,
  createRunPaths,
  ensureLmStudioReady,
  findLmStudioCli,
  gatewayPort,
  invokeTool,
  lmStudioPort,
  modelIdentifier,
  modelRef,
  modelSourceKey,
  postCallback,
  repoRoot,
  runAgentCheck,
  serializeError,
  smokeAgentId,
  smokeProfile,
  startGatewayProcess,
  stopGatewayProcess,
  waitForGatewayHealth,
  writeSmokeReport
} from "./runtime/common.mjs";

const keepRunning = process.env.JARVIS_SMOKE_KEEP_RUNNING === "1";
const runAgentCheckEnabled = process.env.JARVIS_SMOKE_AGENT_CHECK === "1";
const requireAgentCheck = process.env.JARVIS_SMOKE_REQUIRE_AGENT === "1";
const skipBuild = process.env.JARVIS_SMOKE_SKIP_BUILD === "1";

async function main() {
  const runPaths = createRunPaths(smokeProfile);
  let gatewayPid = null;
  let runtime = null;

  const summary = {
    status: "running",
    startedAt: new Date().toISOString(),
    profile: smokeProfile,
    agentId: smokeAgentId,
    gatewayPort,
    lmStudioPort,
    modelKey: modelSourceKey,
    modelId: modelIdentifier,
    modelRef,
    repoRoot,
    configPath: null,
    mainWorkspaceDir: null,
    leanWorkspaceDir: null,
    stateDbPath: null,
    runDir: runPaths.runDir,
    summaryJsonPath: runPaths.summaryJsonPath,
    summaryMarkdownPath: runPaths.summaryMarkdownPath,
    latestJsonPath: runPaths.latestJsonPath,
    latestMarkdownPath: runPaths.latestMarkdownPath,
    logs: {
      gatewayOutPath: runPaths.gatewayOutPath,
      gatewayErrPath: runPaths.gatewayErrPath
    },
    steps: {},
    warnings: [],
    agentCheck: {
      status: "skipped",
      bestEffort: true,
      agentId: smokeAgentId,
      workspaceDir: runPaths.leanWorkspaceDir,
      reason: "JARVIS_SMOKE_AGENT_CHECK != 1"
    }
  };

  try {
    runtime = await bootstrapRuntime({
      profile: smokeProfile,
      agentId: smokeAgentId,
      skipBuild,
      runPaths
    });

    summary.configPath = runtime.configPath;
    summary.mainWorkspaceDir = runtime.mainWorkspaceDir;
    summary.leanWorkspaceDir = runtime.leanWorkspaceDir;
    summary.stateDbPath = runtime.stateDbPath;
    summary.steps.bootstrap = {
      status: "ready",
      configPath: runtime.configPath,
      mainWorkspaceDir: runtime.mainWorkspaceDir,
      leanWorkspaceDir: runtime.leanWorkspaceDir,
      stateDbPath: runtime.stateDbPath
    };

    const lmStudioCliPath = findLmStudioCli();
    await ensureLmStudioReady(lmStudioCliPath, {
      modelKey: modelSourceKey,
      modelId: modelIdentifier,
      port: lmStudioPort
    });
    summary.steps.lmStudio = {
      status: "ready",
      cliPath: lmStudioCliPath,
      modelLoaded: modelIdentifier
    };

    const gateway = startGatewayProcess({
      profile: smokeProfile,
      gatewayPort,
      runPaths,
      stateDbPath: runtime.stateDbPath
    });
    gatewayPid = gateway.pid;
    summary.steps.gateway = {
      status: "starting",
      pid: gatewayPid,
      stdoutPath: gateway.stdoutPath,
      stderrPath: gateway.stderrPath
    };

    await waitForGatewayHealth(gatewayPort);
    summary.steps.gateway.status = "ready";

    const mergeExcel = await invokeTool({
      gatewayPort,
      gatewayToken: runtime.gatewayToken,
      tool: "office_merge_excel",
      args: {
        artifactIds: ["artifact-a", "artifact-b"],
        mode: "by_header_union",
        outputName: "merged.xlsx"
      }
    });

    const mergeJobId = mergeExcel.result?.details?.job_id;
    if (!mergeJobId) {
      throw new Error("office_merge_excel did not return a job id.");
    }

    const queuedStatus = await invokeTool({
      gatewayPort,
      gatewayToken: runtime.gatewayToken,
      tool: "job_status",
      args: {
        jobId: mergeJobId
      }
    });

    const callbackResult = await postCallback({
      gatewayPort,
      callbackPayload: {
        contract_version: "jarvis.v1",
        job_id: mergeJobId,
        job_type: "office.merge_excel",
        attempt: 1,
        status: "completed",
        summary: "Merged smoke workbooks into one normalized workbook.",
        worker_id: "office-worker-smoke",
        artifacts: [
          {
            artifact_id: "artifact-merged-smoke",
            kind: "xlsx",
            name: "merged.xlsx",
            path: "C:\\Jarvis\\artifacts\\merged.xlsx",
            path_context: "windows-host",
            path_style: "windows",
            size_bytes: 184220
          }
        ],
        structured_output: {
          output_artifact_id: "artifact-merged-smoke",
          source_file_count: 2,
          sheets_created: 1,
          rows_written: 1242,
          rows_deduped: 18,
          warnings: []
        },
        metrics: {
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          queue_seconds: 1.1,
          run_seconds: 2.5,
          attempt: 1,
          worker_id: "office-worker-smoke"
        },
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: "info",
            message: "Smoke callback accepted",
            source: "office-worker-smoke"
          }
        ]
      }
    });

    const finalStatus = await invokeTool({
      gatewayPort,
      gatewayToken: runtime.gatewayToken,
      tool: "job_status",
      args: {
        jobId: mergeJobId
      }
    });

    const artifacts = await invokeTool({
      gatewayPort,
      gatewayToken: runtime.gatewayToken,
      tool: "job_artifacts",
      args: {
        jobId: mergeJobId
      }
    });

    const deviceQueue = await invokeTool({
      gatewayPort,
      gatewayToken: runtime.gatewayToken,
      tool: "device_list_windows",
      args: {
        outputName: "windows.json"
      }
    });

    summary.steps.tools = {
      status: "ready",
      mergeJobId,
      mergeAccepted: mergeExcel.result?.details?.status ?? null,
      queuedStatus: queuedStatus.result?.details?.status ?? null,
      callbackStatus: callbackResult.status ?? null,
      finalStatus: finalStatus.result?.details?.status ?? null,
      artifactCount: artifacts.result?.details?.artifacts?.length ?? 0,
      deviceJobId: deviceQueue.result?.details?.job_id ?? null
    };

    if (runAgentCheckEnabled) {
      const agentProbe = await runAgentCheck({
        profile: smokeProfile,
        agentId: smokeAgentId
      });
      summary.agentCheck = {
        status: agentProbe.passed ? "passed" : "failed",
        bestEffort: true,
        agentId: smokeAgentId,
        workspaceDir: runtime.leanWorkspaceDir,
        text: agentProbe.text,
        raw: agentProbe.raw
      };
      if (!agentProbe.passed) {
        summary.warnings.push(
          `Optional agent probe did not return JARVIS_SMOKE_OK for ${smokeAgentId}.`
        );
        if (requireAgentCheck) {
          throw new Error(`Agent check did not pass. Output: ${agentProbe.text || agentProbe.raw || "(empty)"}`);
        }
      }
    }

    summary.status = "ok";
    summary.finishedAt = new Date().toISOString();
    writeSmokeReport(summary, runPaths);

    process.stdout.write(`Smoke run complete. Summary: ${runPaths.summaryJsonPath}\n`);
    process.stdout.write(`Latest summary: ${runPaths.latestJsonPath}\n`);
    process.stdout.write(`Lean agent: ${smokeAgentId}\n`);

    if (!keepRunning) {
      await stopGatewayProcess(gatewayPid);
      process.stdout.write("Stopped smoke gateway process.\n");
    } else {
      process.stdout.write("Leaving smoke gateway running because JARVIS_SMOKE_KEEP_RUNNING=1.\n");
    }
  } catch (error) {
    summary.status = "failed";
    summary.finishedAt = new Date().toISOString();
    summary.error = serializeError(error);
    writeSmokeReport(summary, runPaths);

    if (!keepRunning) {
      await stopGatewayProcess(gatewayPid);
    }

    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${serializeError(error)}\n`);
  process.exit(1);
});
