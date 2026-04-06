import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const runtimeScriptsDir = __dirname;
export const repoRoot = path.resolve(__dirname, "..", "..");
export const runtimeRoot = path.join(repoRoot, ".artifacts", "runtime-smoke");

export const smokeProfile = process.env.JARVIS_SMOKE_PROFILE ?? "jarvis-smoke";
export const smokeAgentId = process.env.JARVIS_SMOKE_AGENT_ID ?? "smoke";
export const gatewayPort = Number(process.env.JARVIS_SMOKE_GATEWAY_PORT ?? "18899");
export const lmStudioPort = Number(process.env.JARVIS_SMOKE_LMSTUDIO_PORT ?? "1234");
export const modelSourceKey = process.env.JARVIS_SMOKE_MODEL_KEY ?? "qwen/qwen3.5-35b-a3b";
export const modelIdentifier = process.env.JARVIS_SMOKE_MODEL_ID ?? "jarvis-smoke-32k";
export const modelRef = `lmstudio/${modelIdentifier}`;
export const contextWindow = Number(process.env.JARVIS_SMOKE_CONTEXT_WINDOW ?? "32768");
export const maxTokens = Number(process.env.JARVIS_SMOKE_MAX_TOKENS ?? "8192");

export function createRunPaths(profile = smokeProfile, options = {}) {
  const {
    timestamp = new Date().toISOString().replaceAll(":", "-")
  } = options;
  const runDir = path.join(runtimeRoot, timestamp);
  const mainWorkspaceDir = path.join(runtimeRoot, `workspace-${profile}`);
  const leanWorkspaceDir = path.join(runtimeRoot, `workspace-${profile}-lean`);

  return {
    timestamp,
    runDir,
    mainWorkspaceDir,
    leanWorkspaceDir,
    summaryJsonPath: path.join(runDir, "summary.json"),
    summaryMarkdownPath: path.join(runDir, "summary.md"),
    latestJsonPath: path.join(runtimeRoot, "latest.json"),
    latestMarkdownPath: path.join(runtimeRoot, "latest.md"),
    bootstrapJsonPath: path.join(runtimeRoot, "bootstrap.json"),
    bootstrapMarkdownPath: path.join(runtimeRoot, "bootstrap.md"),
    stateDbPath: path.join(resolveProfileDir(profile), "jarvis-state.sqlite"),
    legacyStatePath: path.join(resolveProfileDir(profile), "jarvis-state.json"),
    gatewayOutPath: path.join(runDir, "gateway.out.log"),
    gatewayErrPath: path.join(runDir, "gateway.err.log")
  };
}

export function mkdirp(targetPath) {
  mkdirSync(targetPath, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(filePath, value) {
  mkdirp(path.dirname(filePath));
  writeFileSync(filePath, `${value}`, "utf8");
}

export function stripQuotes(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

export function expandHome(targetPath) {
  const normalized = stripQuotes(targetPath);
  if (normalized === "~") {
    return os.homedir();
  }
  if (normalized.startsWith("~/") || normalized.startsWith("~\\")) {
    return path.join(os.homedir(), normalized.slice(2));
  }
  return normalized;
}

export function normalizeResolvedPath(targetPath) {
  const expanded = expandHome(targetPath);
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }
  return path.resolve(repoRoot, expanded);
}

export function resolveProfileDir(profile = smokeProfile) {
  return profile === "default"
    ? path.join(os.homedir(), ".openclaw")
    : path.join(os.homedir(), `.openclaw-${profile}`);
}

export function lastNonEmptyLine(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

function quoteCmdArg(value) {
  const text = String(value ?? "");
  if (!text) {
    return '""';
  }
  if (/^[A-Za-z0-9_./\\:-]+$/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '\\"')}"`;
}

function isBatchFile(command) {
  return /\.(cmd|bat)$/i.test(command);
}

export function createSpawnTarget(command, args) {
  if (process.platform !== "win32" || !isBatchFile(command)) {
    return { command, args, shell: false };
  }

  const commandLine = [quoteCmdArg(command), ...(args ?? []).map(quoteCmdArg)].join(" ");
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
    shell: false
  };
}

export function findNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function findOpenClawCli() {
  const candidates = [
    process.env.JARVIS_SMOKE_OPENCLAW_CLI,
    path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "openclaw.cmd" : "openclaw"),
    path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "openclaw" : "openclaw"),
    process.env.OPENCLAW_CLI
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("OpenClaw CLI was not found. Install dependencies or set JARVIS_SMOKE_OPENCLAW_CLI.");
}

export function findLmStudioCli() {
  const candidates = [
    process.env.JARVIS_SMOKE_LMS_CLI,
    process.env.LMS_CLI,
    path.join(os.homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms"),
    path.join(
      os.homedir(),
      "AppData",
      "Local",
      "Programs",
      "LM Studio",
      "resources",
      "app",
      ".webpack",
      process.platform === "win32" ? "lms.exe" : "lms"
    )
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("LM Studio CLI was not found. Set JARVIS_SMOKE_LMS_CLI to the lms executable path.");
}

export function describeCommand(command, args = []) {
  return [command, ...(args ?? [])].map(quoteCmdArg).join(" ");
}

export async function runCommand(command, args = [], options = {}) {
  const {
    cwd = repoRoot,
    env = {},
    allowFailure = false,
    stdio = ["ignore", "pipe", "pipe"]
  } = options;
  const target = createSpawnTarget(command, args);

  return new Promise((resolve, reject) => {
    const child = spawn(target.command, target.args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio,
      shell: target.shell ?? false
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
    }

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stdout, stderr });
        return;
      }

      const message = [
        `Command failed with exit code ${code}.`,
        describeCommand(target.command, target.args),
        stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
        stderr.trim() ? `stderr:\n${stderr.trim()}` : ""
      ]
        .filter(Boolean)
        .join("\n\n");

      reject(new Error(message));
    });
  });
}

export async function poll(fn, options = {}) {
  const {
    attempts = 30,
    delayMs = 1000,
    label = "operation"
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`${label} did not succeed after ${attempts} attempts.${lastError ? ` ${lastError.message}` : ""}`);
}

function workspaceFiles(kind) {
  if (kind === "lean") {
    return {
      "AGENTS.md": [
        "# Jarvis Smoke Lean",
        "",
        "This workspace is for the optional conversational smoke check only.",
        "Reply exactly `JARVIS_SMOKE_OK` when prompted.",
        "Do not browse, write files, or use tools unless absolutely necessary."
      ].join("\n"),
      "SOUL.md": [
        "# Persona",
        "",
        "Lean, deterministic, and brief."
      ].join("\n"),
      "TOOLS.md": [
        "# Tools",
        "",
        "Keep the prompt small. Prefer no tool use for the smoke check."
      ].join("\n"),
      "IDENTITY.md": [
        "# Identity",
        "",
        "Name: Jarvis Smoke Lean"
      ].join("\n"),
      "USER.md": [
        "# User",
        "",
        "The operator is validating the optional local-model probe."
      ].join("\n"),
      "HEARTBEAT.md": "HEARTBEAT_OK\n"
    };
  }

  return {
    "AGENTS.md": [
      "# Jarvis Smoke",
      "",
      "This workspace exists only for runtime smoke tests.",
      "Keep replies short and deterministic.",
      "Prefer tool use when a request maps cleanly to a registered tool."
    ].join("\n"),
    "SOUL.md": [
      "# Persona",
      "",
      "You are Jarvis running a local runtime smoke check."
    ].join("\n"),
    "USER.md": [
      "# User",
      "",
      "The operator is validating local OpenClaw + LM Studio integration."
    ].join("\n"),
    "IDENTITY.md": [
      "# Identity",
      "",
      "Name: Jarvis Smoke"
    ].join("\n"),
    "TOOLS.md": [
      "# Tools",
      "",
      "The Jarvis plugin pack is loaded from the current repository."
    ].join("\n"),
    "HEARTBEAT.md": "If nothing needs attention, reply HEARTBEAT_OK.\n"
  };
}

export function ensureWorkspaceFiles(workspaceDir, kind = "main") {
  mkdirp(workspaceDir);

  const files = workspaceFiles(kind);
  for (const [name, contents] of Object.entries(files)) {
    writeText(path.join(workspaceDir, name), `${contents}\n`);
  }

  const bootstrapPath = path.join(workspaceDir, "BOOTSTRAP.md");
  if (existsSync(bootstrapPath)) {
    writeText(bootstrapPath, "");
  }
}

export function buildProfileConfig({
  gatewayToken,
  mainWorkspaceDir,
  leanWorkspaceDir
}) {
  return {
    agents: {
      defaults: {
        workspace: mainWorkspaceDir,
        skipBootstrap: true,
        bootstrapMaxChars: 1200,
        bootstrapTotalMaxChars: 4000,
        contextTokens: contextWindow,
        maxConcurrent: 1,
        compaction: { mode: "safeguard" },
        heartbeat: { every: "0m" },
        model: { primary: modelRef },
        models: {
          [modelRef]: { alias: "Local Smoke" }
        }
      },
      list: [
        {
          id: smokeAgentId,
          default: true,
          workspace: leanWorkspaceDir,
          model: { primary: modelRef },
          thinkingDefault: "low",
          reasoningDefault: "off",
          fastModeDefault: true,
          sandbox: { mode: "off" },
          tools: {
            profile: "minimal"
          }
        }
      ]
    },
    gateway: {
      mode: "local",
      port: gatewayPort,
      auth: {
        mode: "token",
        token: gatewayToken
      },
      remote: {
        token: gatewayToken
      }
    },
    models: {
      mode: "merge",
      providers: {
        lmstudio: {
          baseUrl: `http://127.0.0.1:${lmStudioPort}/v1`,
          apiKey: "lmstudio",
          api: "openai-responses",
          models: [
            {
              id: modelIdentifier,
              name: "Jarvis Smoke Local Model",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0
              },
              contextWindow,
              maxTokens
            }
          ]
        }
      }
    },
    skills: {
      allowBundled: []
    },
    plugins: {
      load: {
        paths: [
          "packages/jarvis-core",
          "packages/jarvis-jobs",
          "packages/jarvis-files",
          "packages/jarvis-browser",
          "packages/jarvis-device",
          "packages/jarvis-office",
          "packages/jarvis-dispatch"
        ].map((relativePath) => path.join(repoRoot, relativePath))
      },
      entries: {
        "jarvis-core": { enabled: true },
        "jarvis-jobs": { enabled: true },
        "jarvis-files": { enabled: true },
        "jarvis-browser": { enabled: true },
        "jarvis-device": { enabled: true },
        "jarvis-office": { enabled: true },
        "jarvis-dispatch": { enabled: true }
      }
    }
  };
}

export async function ensureBuild({ skipBuild = false } = {}) {
  if (skipBuild) {
    return { skipped: true };
  }

  await runCommand(findNpmCommand(), ["run", "build"], { cwd: repoRoot });
  return { skipped: false };
}

export async function resolveConfigPath(profile = smokeProfile) {
  const openclawCli = findOpenClawCli();
  const result = await runCommand(openclawCli, ["--profile", profile, "config", "file"]);
  const resolved = normalizeResolvedPath(lastNonEmptyLine(result.stdout));
  if (!resolved) {
    throw new Error(`Unable to resolve config path for profile ${profile}.`);
  }
  return { openclawCli, configPath: resolved };
}

export async function bootstrapRuntime(options = {}) {
  const {
    profile = smokeProfile,
    agentId = smokeAgentId,
    skipBuild = false,
    runPaths = createRunPaths(profile)
  } = options;

  await ensureBuild({ skipBuild });

  mkdirp(runPaths.runDir);
  mkdirp(runtimeRoot);

  const { configPath } = await resolveConfigPath(profile);
  const gatewayToken = randomBytes(24).toString("hex");
  const mainWorkspaceDir = runPaths.mainWorkspaceDir;
  const leanWorkspaceDir = runPaths.leanWorkspaceDir;
  const stateDbPath = runPaths.stateDbPath;

  ensureWorkspaceFiles(mainWorkspaceDir, "main");
  ensureWorkspaceFiles(leanWorkspaceDir, "lean");
  mkdirp(path.dirname(stateDbPath));

  writeJson(
    configPath,
    buildProfileConfig({
      gatewayToken,
      mainWorkspaceDir,
      leanWorkspaceDir
    })
  );

  return {
    profile,
    agentId,
    gatewayToken,
    configPath,
    stateDbPath,
    ...runPaths
  };
}

export function buildSmokeReportMarkdown(summary) {
  const lines = [];
  const push = (line = "") => lines.push(line);
  const stepEntries = Object.entries(summary.steps ?? {});

  push("# Jarvis runtime smoke");
  push("");
  push(`Status: ${summary.status}`);
  push(`Profile: ${summary.profile}`);
  push(`Model: ${summary.modelRef}`);
  push(`Gateway port: ${summary.gatewayPort}`);
  push(`LM Studio port: ${summary.lmStudioPort}`);
  push(`Config: ${summary.configPath}`);
  push(`Workspace: ${summary.mainWorkspaceDir}`);
  push(`Lean agent: ${summary.agentId}`);
  push(`State DB: ${summary.stateDbPath}`);
  push(`Run dir: ${summary.runDir}`);
  push(`Summary JSON: ${summary.summaryJsonPath}`);
  push(`Latest JSON: ${summary.latestJsonPath}`);

  if (summary.warnings?.length) {
    push("");
    push("Warnings:");
    for (const warning of summary.warnings) {
      push(`- ${warning}`);
    }
  }

  push("");
  push("## Steps");
  for (const [name, value] of stepEntries) {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    push(`- ${name}: ${rendered}`);
  }

  if (summary.agentCheck) {
    push("");
    push("## Agent Check");
    push(`- status: ${summary.agentCheck.status}`);
    push(`- bestEffort: ${summary.agentCheck.bestEffort ? "true" : "false"}`);
    if (summary.agentCheck.agentId) {
      push(`- agentId: ${summary.agentCheck.agentId}`);
    }
    if (summary.agentCheck.workspaceDir) {
      push(`- workspace: ${summary.agentCheck.workspaceDir}`);
    }
    if (summary.agentCheck.text) {
      push(`- text: ${summary.agentCheck.text}`);
    }
    if (summary.agentCheck.reason) {
      push(`- reason: ${summary.agentCheck.reason}`);
    }
  }

  if (summary.error) {
    push("");
    push("## Error");
    push("");
    push(summary.error);
  }

  return `${lines.join("\n")}\n`;
}

export function writeSmokeReport(summary, runPaths) {
  const finalSummary = {
    reportVersion: "jarvis.runtime-smoke.v2",
    ...summary,
    runDir: runPaths.runDir,
    summaryJsonPath: runPaths.summaryJsonPath,
    summaryMarkdownPath: runPaths.summaryMarkdownPath,
    latestJsonPath: runPaths.latestJsonPath,
    latestMarkdownPath: runPaths.latestMarkdownPath
  };

  writeJson(runPaths.summaryJsonPath, finalSummary);
  writeText(runPaths.summaryMarkdownPath, buildSmokeReportMarkdown(finalSummary));
  writeJson(runPaths.latestJsonPath, finalSummary);
  writeText(runPaths.latestMarkdownPath, buildSmokeReportMarkdown(finalSummary));

  return finalSummary;
}

export function serializeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function waitForHttpReady(url, options = {}) {
  const {
    attempts = 30,
    delayMs = 1000,
    label = url,
    headers
  } = options;

  await poll(async () => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`${label} returned ${response.status}.`);
    }
    return response;
  }, {
    attempts,
    delayMs,
    label
  });
}

export async function ensureLmStudioReady(lmStudioCliPath, options = {}) {
  const {
    modelKey = modelSourceKey,
    modelId = modelIdentifier,
    port = lmStudioPort,
    context = contextWindow,
    maxTokens: outputTokens = maxTokens
  } = options;

  await runCommand(lmStudioCliPath, ["server", "start", "--port", String(port), "--bind", "127.0.0.1"], {
    allowFailure: true
  });

  await waitForHttpReady(`http://127.0.0.1:${port}/v1/models`, {
    label: "LM Studio /v1/models"
  });

  await runCommand(lmStudioCliPath, ["unload", modelId], { allowFailure: true });
  await runCommand(lmStudioCliPath, [
    "load",
    modelKey,
    "--identifier",
    modelId,
    "-c",
    String(context),
    "--parallel",
    "1",
    "--ttl",
    "3600",
    "-y"
  ]);

  const response = await fetch(`http://127.0.0.1:${port}/v1/models`);
  const payload = await response.json();
  const ids = Array.isArray(payload?.data) ? payload.data.map((entry) => entry.id) : [];
  if (!ids.includes(modelId)) {
    throw new Error(`LM Studio is reachable but does not advertise ${modelId}.`);
  }

  return {
    modelKey,
    modelId,
    context,
    maxTokens: outputTokens
  };
}

export async function waitForGatewayHealth(port) {
  await waitForHttpReady(`http://127.0.0.1:${port}/healthz`, {
    label: "OpenClaw gateway /healthz"
  });
}

export function startGatewayProcess({
  profile = smokeProfile,
  gatewayPort: localGatewayPort = gatewayPort,
  runPaths = createRunPaths(profile),
  stateDbPath = runPaths.stateDbPath
} = {}) {
  mkdirp(runtimeRoot);
  mkdirp(runPaths.runDir);

  const openclawCli = findOpenClawCli();
  const stdoutFd = openSync(runPaths.gatewayOutPath, "w");
  const stderrFd = openSync(runPaths.gatewayErrPath, "w");
  const target = createSpawnTarget(openclawCli, [
    "--profile",
    profile,
    "gateway",
    "run",
    "--force",
    "--port",
    String(localGatewayPort)
  ]);
  const child = spawn(target.command, target.args, {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      JARVIS_STATE_DB: stateDbPath,
      JARVIS_STATE_FILE: runPaths.legacyStatePath
    },
    stdio: ["ignore", stdoutFd, stderrFd]
  });

  child.unref();
  closeSync(stdoutFd);
  closeSync(stderrFd);

  return {
    pid: child.pid,
    runPaths,
    openclawCli,
    stdoutPath: runPaths.gatewayOutPath,
    stderrPath: runPaths.gatewayErrPath
  };
}

export async function stopGatewayProcess(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"], { allowFailure: true });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // best-effort stop only
  }
}

export async function invokeTool({
  gatewayPort: localGatewayPort = gatewayPort,
  gatewayToken,
  tool,
  args = {},
  sessionKey = "agent:main:smoke:http"
}) {
  const response = await fetch(`http://127.0.0.1:${localGatewayPort}/tools/invoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gatewayToken}`
    },
    body: JSON.stringify({
      tool,
      args,
      sessionKey
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`Tool ${tool} failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function postCallback({
  gatewayPort: localGatewayPort = gatewayPort,
  callbackPayload
}) {
  const response = await fetch(`http://127.0.0.1:${localGatewayPort}/jarvis/jobs/callback`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(callbackPayload)
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`Worker callback failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

function extractTextPayload(rawText) {
  const trimmed = String(rawText ?? "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed);
    const payloads = parsed?.result?.payloads;
    if (Array.isArray(payloads)) {
      return payloads.map((entry) => entry?.text).filter(Boolean).join("\n").trim();
    }
  } catch {
    // Ignore JSON parse failures and fall back to raw text.
  }

  return trimmed;
}

export async function runAgentCheck({
  profile = smokeProfile,
  agentId = smokeAgentId,
  message = "Reply with exactly: JARVIS_SMOKE_OK",
  timeoutSeconds = 60
} = {}) {
  const openclawCli = findOpenClawCli();
  const result = await runCommand(openclawCli, [
    "--profile",
    profile,
    "agent",
    "--agent",
    agentId,
    "--message",
    message,
    "--json",
    "--timeout",
    String(timeoutSeconds)
  ], {
    allowFailure: true
  });

  const raw = `${result.stdout}${result.stderr}`.trim();
  const text = extractTextPayload(raw);
  const passed = text.includes("JARVIS_SMOKE_OK");
  return {
    passed,
    text,
    raw
  };
}
