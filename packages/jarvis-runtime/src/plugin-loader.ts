import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { AgentDefinition } from "@jarvis/agent-framework";

const PLUGINS_DIR = join(os.homedir(), ".jarvis", "plugins");

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  agent: AgentDefinition;
  knowledge_seeds?: Array<{
    collection: string;
    title: string;
    content: string;
    tags: string[];
  }>;
  config_requirements?: string[];
  installed_at: string;
};

/**
 * Load all installed plugins from ~/.jarvis/plugins/.
 * Returns an empty array if the directory does not exist or is empty.
 */
export function loadPlugins(): PluginManifest[] {
  if (!fs.existsSync(PLUGINS_DIR)) return [];

  const dirs = fs.readdirSync(PLUGINS_DIR).filter((d) => {
    try {
      return fs.statSync(join(PLUGINS_DIR, d)).isDirectory();
    } catch {
      return false;
    }
  });

  const manifests: PluginManifest[] = [];
  for (const dir of dirs) {
    const manifestPath = join(PLUGINS_DIR, dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8"),
      ) as PluginManifest;
      manifests.push(manifest);
    } catch {
      // Skip malformed manifests
    }
  }

  return manifests;
}

/**
 * Install a plugin from a source directory.
 * Copies manifest.json and any prompt files to ~/.jarvis/plugins/<id>/.
 */
export function installPlugin(sourcePath: string): PluginManifest {
  const manifestPath = join(sourcePath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json found at ${sourcePath}`);
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) as PluginManifest;

  if (!manifest.id || !manifest.name || !manifest.version) {
    throw new Error("Plugin manifest must contain id, name, and version");
  }

  const targetDir = join(PLUGINS_DIR, manifest.id);
  fs.mkdirSync(targetDir, { recursive: true });

  // Write manifest with install timestamp
  manifest.installed_at = new Date().toISOString();
  fs.writeFileSync(
    join(targetDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  // Copy prompt files if they exist
  const promptsDir = join(sourcePath, "prompts");
  if (fs.existsSync(promptsDir)) {
    const targetPrompts = join(targetDir, "prompts");
    fs.mkdirSync(targetPrompts, { recursive: true });
    for (const f of fs.readdirSync(promptsDir)) {
      const srcFile = join(promptsDir, f);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, join(targetPrompts, f));
      }
    }
  }

  return manifest;
}

/**
 * Uninstall a plugin by removing its directory from ~/.jarvis/plugins/.
 * Returns true if the plugin was found and removed, false if not found.
 */
export function uninstallPlugin(pluginId: string): boolean {
  const dir = join(PLUGINS_DIR, pluginId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true });
  return true;
}

/**
 * List all installed plugins. Alias for loadPlugins().
 */
export function listPlugins(): PluginManifest[] {
  return loadPlugins();
}
