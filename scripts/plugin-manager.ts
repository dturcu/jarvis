/**
 * Jarvis Plugin Manager — install, list, and remove plugins from the CLI.
 *
 * Usage:
 *   npm run plugin:install <path>   # Install plugin from local directory
 *   npm run plugin:list             # List installed plugins
 *   npm run plugin:remove <id>      # Remove an installed plugin
 *
 * Or directly:
 *   npx tsx scripts/plugin-manager.ts install /path/to/plugin
 *   npx tsx scripts/plugin-manager.ts list
 *   npx tsx scripts/plugin-manager.ts remove <plugin-id>
 */

import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const PLUGINS_DIR = join(os.homedir(), ".jarvis", "plugins");

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  agent: { agent_id?: string; label?: string };
  config_requirements?: string[];
  installed_at: string;
}

// ─── Commands ───────────────────────────────────────────────────────────────

function listPlugins(): void {
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.log("No plugins installed.");
    return;
  }

  const dirs = fs.readdirSync(PLUGINS_DIR).filter((d) => {
    try {
      return fs.statSync(join(PLUGINS_DIR, d)).isDirectory();
    } catch {
      return false;
    }
  });

  if (dirs.length === 0) {
    console.log("No plugins installed.");
    return;
  }

  console.log(`\n  Installed plugins (${dirs.length}):\n`);

  for (const dir of dirs) {
    const manifestPath = join(PLUGINS_DIR, dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      console.log(`  [?] ${dir} — missing manifest.json`);
      continue;
    }

    try {
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8"),
      ) as PluginManifest;
      const reqs = manifest.config_requirements?.length
        ? ` (requires: ${manifest.config_requirements.join(", ")})`
        : "";
      console.log(
        `  [*] ${manifest.name} v${manifest.version} — ${manifest.description}${reqs}`,
      );
      console.log(
        `      id: ${manifest.id}  agent: ${manifest.agent?.agent_id ?? "none"}  installed: ${manifest.installed_at}`,
      );
    } catch {
      console.log(`  [!] ${dir} — malformed manifest.json`);
    }
  }

  console.log();
}

function installPlugin(sourcePath: string): void {
  const manifestPath = join(sourcePath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: No manifest.json found at ${sourcePath}`);
    process.exit(1);
  }

  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as PluginManifest;
  } catch {
    console.error("Error: Failed to parse manifest.json");
    process.exit(1);
  }

  if (!manifest.id || !manifest.name || !manifest.version) {
    console.error("Error: Plugin manifest must contain id, name, and version");
    process.exit(1);
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

  console.log(`Installed: ${manifest.name} v${manifest.version} (${manifest.id})`);
}

function removePlugin(pluginId: string): void {
  const dir = join(PLUGINS_DIR, pluginId);
  if (!fs.existsSync(dir)) {
    console.error(`Error: Plugin not found: ${pluginId}`);
    process.exit(1);
  }

  fs.rmSync(dir, { recursive: true });
  console.log(`Removed: ${pluginId}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "install": {
    const sourcePath = args[0];
    if (!sourcePath) {
      console.error("Usage: plugin-manager.ts install <path>");
      process.exit(1);
    }
    installPlugin(sourcePath);
    break;
  }

  case "list":
    listPlugins();
    break;

  case "remove": {
    const pluginId = args[0];
    if (!pluginId) {
      console.error("Usage: plugin-manager.ts remove <plugin-id>");
      process.exit(1);
    }
    removePlugin(pluginId);
    break;
  }

  default:
    console.log("Jarvis Plugin Manager");
    console.log();
    console.log("Commands:");
    console.log("  install <path>   Install plugin from local directory");
    console.log("  list             List installed plugins");
    console.log("  remove <id>      Remove an installed plugin");
    console.log();
    console.log("Examples:");
    console.log("  npm run plugin:install /path/to/my-plugin");
    console.log("  npm run plugin:list");
    console.log("  npm run plugin:remove my-plugin-id");
    break;
}
