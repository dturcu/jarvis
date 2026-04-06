import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

export const DEFAULT_PROFILE = "jarvis-smoke";
export const DEFAULT_GATEWAY_PORT = 18899;
export const DEFAULT_LMSTUDIO_PORT = 1234;
export const DEFAULT_MODEL_KEY = "qwen/qwen3.5-35b-a3b";
export const DEFAULT_MODEL_IDENTIFIER = "jarvis-smoke-32k";
export const DEFAULT_CONTEXT_WINDOW = 32768;
export const DEFAULT_MAX_TOKENS = 8192;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..", "..");

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

export function expandHome(targetPath) {
  if (typeof targetPath !== "string") {
    return targetPath ?? null;
  }
  if (targetPath === "~") {
    return os.homedir();
  }
  if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return targetPath;
}

export function resolveProfileDir(profile = DEFAULT_PROFILE) {
  return profile === "default"
    ? path.join(os.homedir(), ".openclaw")
    : path.join(os.homedir(), `.openclaw-${profile}`);
}

export function resolveProfileConfigPath(profile = DEFAULT_PROFILE) {
  return path.join(resolveProfileDir(profile), "openclaw.json");
}

export function resolveWorkspacePath(config) {
  return expandHome(
    config?.agents?.defaults?.workspace ??
      config?.agent?.workspace ??
      null
  );
}

export function resolveBackupRoot(profile = DEFAULT_PROFILE) {
  return path.join(os.homedir(), ".openclaw-jarvis-backups", profile);
}

export function resolveReportRoot() {
  return path.join(repoRoot, ".artifacts", "ops");
}

export function resolveBundlePaths(profile = DEFAULT_PROFILE, stamp = timestampStamp()) {
  const backupRoot = resolveBackupRoot(profile);
  const bundleDir = path.join(backupRoot, stamp);
  return {
    profile,
    stamp,
    backupRoot,
    bundleDir,
    profileDir: resolveProfileDir(profile),
    configPath: resolveProfileConfigPath(profile),
    profileBackupDir: path.join(bundleDir, "profile"),
    workspaceBackupDir: path.join(bundleDir, "workspace"),
    manifestPath: path.join(bundleDir, "manifest.json"),
    reportPath: path.join(resolveReportRoot(), `${profile}-${stamp}.json`),
    latestReportPath: path.join(resolveReportRoot(), `${profile}-latest.json`)
  };
}

export function timestampStamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "-");
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function summarizeConfig(config) {
  const pluginLoadPaths = Array.isArray(config?.plugins?.load?.paths)
    ? config.plugins.load.paths.map((value) => expandHome(value))
    : [];
  const pluginEntries = config?.plugins?.entries ?? {};
  const enabledPluginIds = Object.entries(pluginEntries)
    .filter(([, entry]) => entry?.enabled !== false)
    .map(([pluginId]) => pluginId);
  const primaryModel = config?.agents?.defaults?.model?.primary ?? null;
  const lmstudioProvider = config?.models?.providers?.lmstudio ?? null;
  const lmstudioModel = Array.isArray(lmstudioProvider?.models)
    ? lmstudioProvider.models[0] ?? null
    : null;
  const workspacePath = resolveWorkspacePath(config);

  return {
    gatewayMode: config?.gateway?.mode ?? null,
    gatewayAuthMode: config?.gateway?.auth?.mode ?? null,
    gatewayPort: config?.gateway?.port ?? null,
    primaryModel,
    primaryModelIdentifier:
      typeof primaryModel === "string" && primaryModel.startsWith("lmstudio/")
        ? primaryModel.slice("lmstudio/".length)
        : null,
    lmstudioBaseUrl: lmstudioProvider?.baseUrl ?? null,
    lmstudioModelIdentifier: lmstudioModel?.id ?? null,
    workspacePath,
    pluginLoadPaths,
    enabledPluginIds,
    bootstrapMaxChars: config?.agents?.defaults?.bootstrapMaxChars ?? null,
    bootstrapTotalMaxChars: config?.agents?.defaults?.bootstrapTotalMaxChars ?? null,
    skipBootstrap: config?.agents?.defaults?.skipBootstrap ?? null
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      data
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runHealthChecks({
  profile = DEFAULT_PROFILE,
  gatewayPort = DEFAULT_GATEWAY_PORT,
  lmstudioPort = DEFAULT_LMSTUDIO_PORT,
  modelIdentifier = DEFAULT_MODEL_IDENTIFIER
} = {}) {
  const configPath = resolveProfileConfigPath(profile);
  const config = await readJsonIfExists(configPath);
  const configSummary = config ? summarizeConfig(config) : null;
  const gateway = await fetchJsonWithTimeout(`http://127.0.0.1:${gatewayPort}/healthz`);
  const lmstudio = await fetchJsonWithTimeout(`http://127.0.0.1:${lmstudioPort}/v1/models`);

  const modelIds = Array.isArray(lmstudio?.data?.data)
    ? lmstudio.data.data.map((entry) => entry?.id).filter(Boolean)
    : [];
  const pinnedModelPresent = modelIds.includes(modelIdentifier);
  const gatewayHealthy = Boolean(gateway?.ok || gateway?.data?.ok);
  const lmstudioHealthy = Boolean(lmstudio?.ok && pinnedModelPresent);
  const status =
    config && gatewayHealthy && lmstudioHealthy ? "ok" : "degraded";

  const recommendations = [];
  if (!config) {
    recommendations.push(`Profile config missing at ${configPath}. Run the bootstrap or restore from backup.`);
  }
  if (!gatewayHealthy) {
    recommendations.push("Gateway is not healthy. Start the OpenClaw Gateway service for the profile.");
  }
  if (!lmstudioHealthy) {
    recommendations.push(
      `LM Studio is missing the pinned model ${modelIdentifier}. Start the server and load the model identifier.`
    );
  }

  return {
    profile,
    status,
    configPath,
    configSummary,
    gateway,
    lmstudio: {
      ...lmstudio,
      pinnedModelPresent,
      modelIds
    },
    recommendations
  };
}

export async function copyTree(source, target) {
  await ensureDir(path.dirname(target));
  await fs.cp(source, target, { recursive: true, force: true, preserveTimestamps: true });
}

export async function findLatestBackupBundle(profile = DEFAULT_PROFILE) {
  const backupRoot = resolveBackupRoot(profile);
  try {
    const entries = await fs.readdir(backupRoot, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(backupRoot, entry.name))
      .sort();
    return directories.at(-1) ?? null;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function loadProfileConfig(profile = DEFAULT_PROFILE) {
  const configPath = resolveProfileConfigPath(profile);
  const config = await readJsonIfExists(configPath);
  return {
    profile,
    configPath,
    config,
    configSummary: config ? summarizeConfig(config) : null,
    profileDir: resolveProfileDir(profile),
    workspacePath: config ? resolveWorkspacePath(config) : null
  };
}

export function buildBackupManifest({
  profile = DEFAULT_PROFILE,
  bundleDir,
  configPath,
  profileDir,
  workspacePath,
  configSummary,
  copiedWorkspace,
  copiedArtifacts = []
}) {
  return {
    profile,
    createdAt: new Date().toISOString(),
    bundleDir,
    configPath,
    profileDir,
    workspacePath,
    copiedWorkspace,
    copiedArtifacts,
    configSummary
  };
}

