import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_IDENTIFIER,
  DEFAULT_PROFILE,
  buildBackupManifest,
  resolveBundlePaths,
  summarizeConfig
} from "../scripts/ops/common.mjs";

describe("ops runtime helpers", () => {
  it("builds stable runtime paths for the canonical smoke profile", () => {
    const paths = resolveBundlePaths(DEFAULT_PROFILE, "2026-04-04T11-00-00.000Z");

    expect(paths.profileDir).toContain(".openclaw-jarvis-smoke");
    expect(paths.configPath).toContain("openclaw.json");
    expect(paths.bundleDir).toContain(".openclaw-jarvis-backups");
    expect(paths.manifestPath).toContain("manifest.json");
    expect(paths.latestReportPath).toContain("jarvis-smoke-latest.json");
  });

  it("summarizes the current runtime config shape", () => {
    const config = {
      agents: {
        defaults: {
          workspace: "~/.openclaw/workspace-jarvis-smoke",
          skipBootstrap: true,
          bootstrapMaxChars: 1200,
          bootstrapTotalMaxChars: 4000,
          model: { primary: `lmstudio/${DEFAULT_MODEL_IDENTIFIER}` }
        }
      },
      gateway: {
        mode: "local",
        port: 18899,
        auth: { mode: "token" }
      },
      models: {
        mode: "merge",
        providers: {
          lmstudio: {
            baseUrl: "http://127.0.0.1:1234/v1",
            models: [
              {
                id: DEFAULT_MODEL_IDENTIFIER
              }
            ]
          }
        }
      },
      plugins: {
        load: { paths: ["./packages/jarvis-core"] },
        entries: {
          "jarvis-core": { enabled: true }
        }
      }
    };

    const summary = summarizeConfig(config as any);
    expect(summary.primaryModel).toBe(`lmstudio/${DEFAULT_MODEL_IDENTIFIER}`);
    expect(summary.primaryModelIdentifier).toBe(DEFAULT_MODEL_IDENTIFIER);
    expect(summary.lmstudioModelIdentifier).toBe(DEFAULT_MODEL_IDENTIFIER);
    expect(summary.workspacePath).toContain("workspace-jarvis-smoke");
    expect(summary.enabledPluginIds).toEqual(["jarvis-core"]);
  });

  it("builds a backup manifest with the key recovery paths", () => {
    const manifest = buildBackupManifest({
      profile: DEFAULT_PROFILE,
      bundleDir: "C:/Users/DanielV2/.openclaw-jarvis-backups/jarvis-smoke/2026-04-04T11-00-00.000Z",
      configPath: "C:/Users/DanielV2/.openclaw-jarvis-smoke/openclaw.json",
      profileDir: "C:/Users/DanielV2/.openclaw-jarvis-smoke",
      workspacePath: "C:/Users/DanielV2/.openclaw/workspace-jarvis-smoke",
      configSummary: {
        primaryModelIdentifier: DEFAULT_MODEL_IDENTIFIER
      },
      copiedWorkspace: true,
      copiedArtifacts: ["C:/Users/DanielV2/Documents/Playground/.artifacts/runtime-smoke/latest.json"]
    });

    expect(manifest.profile).toBe(DEFAULT_PROFILE);
    expect(manifest.copiedWorkspace).toBe(true);
    expect(manifest.configSummary.primaryModelIdentifier).toBe(DEFAULT_MODEL_IDENTIFIER);
    expect(manifest.copiedArtifacts).toHaveLength(1);
  });
});
