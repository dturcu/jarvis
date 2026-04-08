import fs from "node:fs";
import os from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { AgentDefinition } from "@jarvis/agent-framework";
import type { DatabaseSync } from "node:sqlite";

const PLUGINS_DIR = join(os.homedir(), ".jarvis", "plugins");

// ── Permission Classes ─────────────────────────────────────────────────────

/**
 * Permission classes control what a plugin's agent is allowed to do.
 * Each maps to a capability family (prefix before the dot in action names).
 */
export const PLUGIN_PERMISSIONS = [
  "read_knowledge",
  "write_knowledge",
  "read_crm",
  "write_crm",
  "execute_inference",
  "execute_browser",
  "execute_email",
  "execute_social",
  "execute_files",
  "execute_device",
  "execute_interpreter",
  "execute_scheduler",
  "execute_web",
  "execute_office",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/** Maps capability prefixes to required permissions. */
const CAPABILITY_PERMISSION_MAP: Record<string, PluginPermission> = {
  knowledge: "read_knowledge",
  knowledge_write: "write_knowledge",
  crm: "read_crm",
  crm_write: "write_crm",
  inference: "execute_inference",
  browser: "execute_browser",
  email: "execute_email",
  social: "execute_social",
  files: "execute_files",
  device: "execute_device",
  interpreter: "execute_interpreter",
  scheduler: "execute_scheduler",
  web: "execute_web",
  office: "execute_office",
  document: "execute_files",
};

// ── Manifest Schema (TypeBox) ──────────────────────────────────────────────

const TriggerSchema = Type.Union([
  Type.Object({ kind: Type.Literal("schedule"), cron: Type.String({ minLength: 5 }) }),
  Type.Object({ kind: Type.Literal("event"), event_type: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal("manual") }),
  Type.Object({ kind: Type.Literal("threshold"), alert_id: Type.String({ minLength: 1 }) }),
]);

const ApprovalGateSchema = Type.Object({
  action: Type.String({ minLength: 1 }),
  severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("critical")]),
  auto_approve_after_seconds: Type.Optional(Type.Number({ minimum: 0 })),
});

const TaskProfileSchema = Type.Object({
  objective: Type.Union([
    Type.Literal("plan"), Type.Literal("execute"), Type.Literal("critique"),
    Type.Literal("summarize"), Type.Literal("extract"), Type.Literal("classify"),
    Type.Literal("answer"), Type.Literal("code"), Type.Literal("rag_synthesis"),
  ]),
  constraints: Type.Optional(Type.Object({
    require_json: Type.Optional(Type.Boolean()),
    require_tools: Type.Optional(Type.Boolean()),
    require_vision: Type.Optional(Type.Boolean()),
    max_latency_ms: Type.Optional(Type.Number({ minimum: 0 })),
    min_context_window: Type.Optional(Type.Number({ minimum: 0 })),
    prefer_local_only: Type.Optional(Type.Boolean()),
  })),
  preferences: Type.Optional(Type.Object({
    prioritize_speed: Type.Optional(Type.Boolean()),
    prioritize_accuracy: Type.Optional(Type.Boolean()),
    prioritize_code_quality: Type.Optional(Type.Boolean()),
    deterministic: Type.Optional(Type.Boolean()),
  })),
});

const AgentDefinitionSchema = Type.Object({
  agent_id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$" }),
  label: Type.String({ minLength: 1, maxLength: 128 }),
  version: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  triggers: Type.Array(TriggerSchema),
  capabilities: Type.Array(Type.String({ minLength: 1 })),
  approval_gates: Type.Array(ApprovalGateSchema),
  knowledge_collections: Type.Array(Type.String()),
  task_profile: TaskProfileSchema,
  max_steps_per_run: Type.Integer({ minimum: 1, maximum: 100 }),
  system_prompt: Type.String({ minLength: 1 }),
  output_channels: Type.Array(Type.String()),
  planner_mode: Type.Optional(Type.Union([
    Type.Literal("single"), Type.Literal("critic"), Type.Literal("multi"),
  ])),
});

const ManifestSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$" }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  version: Type.String({ minLength: 1, pattern: "^\\d+\\.\\d+\\.\\d+" }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  agent: AgentDefinitionSchema,
  permissions: Type.Optional(Type.Array(Type.Union(
    PLUGIN_PERMISSIONS.map(p => Type.Literal(p)) as [any, any, ...any[]],
  ))),
  knowledge_seeds: Type.Optional(Type.Array(Type.Object({
    collection: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }),
    tags: Type.Array(Type.String()),
  }))),
  config_requirements: Type.Optional(Type.Array(Type.String())),
  installed_at: Type.Optional(Type.String()),
  /** SHA-256 checksum of the manifest content for integrity verification. */
  checksum_sha256: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  /** Minimum Jarvis version required by this plugin (semver). */
  min_jarvis_version: Type.Optional(Type.String({ pattern: "^\\d+\\.\\d+\\.\\d+" })),
  /** Maximum Jarvis version compatible with this plugin (semver). */
  max_jarvis_version: Type.Optional(Type.String({ pattern: "^\\d+\\.\\d+\\.\\d+" })),
});

export type PluginManifest = Static<typeof ManifestSchema> & {
  agent: AgentDefinition;
  installed_at: string;
};

export type ManifestValidationResult = {
  valid: boolean;
  errors: string[];
};

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a manifest against the TypeBox schema.
 * Returns structured errors instead of throwing.
 */
export function validateManifest(data: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (!Value.Check(ManifestSchema, data)) {
    for (const error of Value.Errors(ManifestSchema, data)) {
      errors.push(`${error.path}: ${error.message}`);
    }
    return { valid: false, errors };
  }

  const manifest = data as PluginManifest;

  // Cross-field validation: agent_id must match manifest id
  if (manifest.agent.agent_id !== `plugin-${manifest.id}` && manifest.agent.agent_id !== manifest.id) {
    errors.push(`agent.agent_id "${manifest.agent.agent_id}" should match manifest id "${manifest.id}" (or "plugin-${manifest.id}")`);
  }

  // Validate requested permissions cover declared capabilities
  if (manifest.permissions) {
    const requiredPerms = deriveRequiredPermissions(manifest.agent.capabilities);
    const grantedPerms = new Set(manifest.permissions);
    const missing = requiredPerms.filter(p => !grantedPerms.has(p));
    if (missing.length > 0) {
      errors.push(`Capabilities require permissions not declared: ${missing.join(", ")}`);
    }
  }

  // Version compatibility check
  if (manifest.min_jarvis_version || manifest.max_jarvis_version) {
    const jarvisVersion = JARVIS_PLATFORM_VERSION;
    if (manifest.min_jarvis_version && compareSemver(jarvisVersion, manifest.min_jarvis_version) < 0) {
      errors.push(`Requires Jarvis >= ${manifest.min_jarvis_version} (current: ${jarvisVersion})`);
    }
    if (manifest.max_jarvis_version && compareSemver(jarvisVersion, manifest.max_jarvis_version) > 0) {
      errors.push(`Requires Jarvis <= ${manifest.max_jarvis_version} (current: ${jarvisVersion})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Load platform version from root package.json instead of hardcoding. */
function loadPlatformVersion(): string {
  try {
    // Walk up from this file to find root package.json
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
      const pkgPath = join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.name === "jarvis-plugin-pack") return pkg.version;
      }
      dir = dirname(dir);
    }
  } catch { /* fallback below */ }
  return "0.1.0"; // fallback
}

/** Current Jarvis platform version for compatibility gating. */
export const JARVIS_PLATFORM_VERSION = loadPlatformVersion();

/** Simple semver comparison. Returns -1 if a < b, 0 if equal, 1 if a > b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}

/**
 * Derive the minimum required permissions from a list of capabilities.
 */
export function deriveRequiredPermissions(capabilities: string[]): PluginPermission[] {
  const perms = new Set<PluginPermission>();
  for (const cap of capabilities) {
    const mapped = CAPABILITY_PERMISSION_MAP[cap];
    if (mapped) perms.add(mapped);
  }
  return [...perms];
}

/**
 * Check if a plugin's agent action is allowed by its granted permissions.
 * Fails closed: unknown/unmapped action families are denied.
 */
export function isActionPermitted(action: string, grantedPermissions: PluginPermission[]): boolean {
  const prefix = action.split(".")[0] ?? action;
  const required = CAPABILITY_PERMISSION_MAP[prefix];
  if (!required) return false; // Unknown prefix — deny (fail closed)
  return grantedPermissions.includes(required);
}

// ── Checksum Verification ─────────────────────────────────────────────────

/**
 * Verify the SHA-256 checksum of a plugin manifest file.
 * If the manifest doesn't include a checksum, verification is skipped (optional field).
 * The checksum is computed over the manifest content with the checksum field removed.
 */
function verifyManifestChecksum(manifestPath: string, manifest: PluginManifest): boolean {
  if (!manifest.checksum_sha256) return true; // Optional field — skip if not provided
  const content = fs.readFileSync(manifestPath, "utf8");
  // Remove the checksum field itself before hashing (it was added after content was hashed)
  const withoutChecksum = JSON.parse(content);
  delete withoutChecksum.checksum_sha256;
  const hash = createHash("sha256").update(JSON.stringify(withoutChecksum, null, 2)).digest("hex");
  return hash === manifest.checksum_sha256;
}

// ── Loading ────────────────────────────────────────────────────────────────

/**
 * Load all installed plugins from ~/.jarvis/plugins/.
 * Validates each manifest; skips invalid ones with warnings.
 */
export function loadPlugins(logger?: { warn: (msg: string) => void }): PluginManifest[] {
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
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const validation = validateManifest(raw);
      if (!validation.valid) {
        logger?.warn(`Plugin ${dir}: invalid manifest — ${validation.errors.join("; ")}`);
        continue;
      }
      // Verify checksum integrity before accepting the plugin
      if (!verifyManifestChecksum(manifestPath, raw as PluginManifest)) {
        logger?.warn(`Plugin ${dir}: checksum mismatch — manifest may have been tampered with`);
        continue;
      }
      manifests.push(raw as PluginManifest);
    } catch (e) {
      logger?.warn(`Plugin ${dir}: failed to parse manifest — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return manifests;
}

// ── Install / Uninstall ────────────────────────────────────────────────────

export type InstallResult = {
  status: "installed" | "upgraded";
  manifest: PluginManifest;
  previous_version?: string;
};

/**
 * Install a plugin from a source directory.
 * Validates manifest, checks permissions, records in DB if available.
 *
 * Uses a write-to-temp-then-rename strategy to avoid partial installs:
 * 1. Validate manifest
 * 2. Copy to temp directory (plugins/.installing-<id>)
 * 3. If existing install, rename to backup (plugins/.backup-<id>)
 * 4. Rename temp to final directory
 * 5. Remove backup on success, restore on failure
 * 6. Record in plugin_installs table if DB is available
 */
export function installPlugin(
  sourcePath: string,
  opts?: { db?: DatabaseSync; actor?: string },
): InstallResult {
  const manifestPath = join(sourcePath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json found at ${sourcePath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error(`Failed to parse manifest: ${e instanceof Error ? e.message : String(e)}`);
  }

  const validation = validateManifest(raw);
  if (!validation.valid) {
    throw new Error(`Invalid manifest: ${validation.errors.join("; ")}`);
  }

  const manifest = raw as PluginManifest;
  const targetDir = join(PLUGINS_DIR, manifest.id);
  const tempDir = join(PLUGINS_DIR, `.installing-${manifest.id}`);
  const backupDir = join(PLUGINS_DIR, `.backup-${manifest.id}`);

  // Check for existing version
  let previousVersion: string | undefined;
  if (fs.existsSync(targetDir)) {
    try {
      const existing = JSON.parse(fs.readFileSync(join(targetDir, "manifest.json"), "utf8")) as PluginManifest;
      previousVersion = existing.version;
    } catch { /* ignore */ }
  }

  // Ensure plugins dir exists
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  // Clean up any stale temp/backup dirs
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true });

  try {
    // Step 1: Copy to temp directory
    fs.mkdirSync(tempDir, { recursive: true });
    manifest.installed_at = new Date().toISOString();
    fs.writeFileSync(join(tempDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    // Copy prompt files
    const promptsDir = join(sourcePath, "prompts");
    if (fs.existsSync(promptsDir)) {
      const targetPrompts = join(tempDir, "prompts");
      fs.mkdirSync(targetPrompts, { recursive: true });
      for (const f of fs.readdirSync(promptsDir)) {
        const srcFile = join(promptsDir, f);
        if (fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, join(targetPrompts, f));
        }
      }
    }

    // Step 2: Backup existing, then swap
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
    }
    fs.renameSync(tempDir, targetDir);

    // Step 3: Remove backup on success
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true });
    }

    // Step 4: Record in DB if available
    if (opts?.db) {
      try {
        opts.db.prepare(`
          INSERT OR REPLACE INTO plugin_installs (plugin_id, version, install_path, installed_at, installed_by, status, manifest_json)
          VALUES (?, ?, ?, ?, ?, 'active', ?)
        `).run(manifest.id, manifest.version, targetDir, manifest.installed_at, opts.actor ?? "system", JSON.stringify(manifest));
      } catch { /* best-effort DB recording */ }
    }

    return {
      status: previousVersion ? "upgraded" : "installed",
      manifest,
      previous_version: previousVersion,
    };
  } catch (e) {
    // Rollback: restore backup if it exists
    if (fs.existsSync(backupDir)) {
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true });
      fs.renameSync(backupDir, targetDir);
    }
    // Clean up temp
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
    throw new Error(`Plugin install failed (rolled back): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Uninstall a plugin by removing its directory.
 * Records removal in DB if available.
 */
export function uninstallPlugin(
  pluginId: string,
  opts?: { db?: DatabaseSync; actor?: string },
): boolean {
  const dir = join(PLUGINS_DIR, pluginId);
  if (!fs.existsSync(dir)) return false;

  fs.rmSync(dir, { recursive: true });

  if (opts?.db) {
    try {
      opts.db.prepare(
        "UPDATE plugin_installs SET status = 'uninstalled' WHERE plugin_id = ?",
      ).run(pluginId);
    } catch { /* best-effort */ }
  }

  return true;
}

/**
 * List all installed plugins. Alias for loadPlugins().
 */
export function listPlugins(logger?: { warn: (msg: string) => void }): PluginManifest[] {
  return loadPlugins(logger);
}
