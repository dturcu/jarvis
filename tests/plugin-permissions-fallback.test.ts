import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations } from "@jarvis/runtime";

function createTempHome(): string {
  return fs.mkdtempSync(join(os.tmpdir(), "jarvis-plugin-home-"));
}

describe("plugin permission fallback", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let tempHome: string;
  let db: DatabaseSync;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    tempHome = createTempHome();
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    runMigrations(db);
  });

  afterEach(() => {
    try { db.close(); } catch {}
    vi.resetModules();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("loads plugin permissions from the on-disk manifest when the DB row is missing", async () => {
    const pluginDir = join(tempHome, ".jarvis", "plugins", "test-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(join(pluginDir, "manifest.json"), JSON.stringify({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      installed_at: "2026-04-08T12:00:00.000Z",
      permissions: ["execute_web", "read_crm"],
      agent: {
        agent_id: "plugin-test-plugin",
        label: "Plugin Test Agent",
        version: "1.0.0",
        description: "Exercises plugin permissions fallback",
        triggers: [{ kind: "manual" }],
        capabilities: ["web", "crm"],
        approval_gates: [],
        knowledge_collections: [],
        task_profile: { objective: "answer" },
        max_steps_per_run: 5,
        system_prompt: "You are a test plugin.",
        output_channels: [],
      },
    }, null, 2));

    vi.resetModules();
    const { loadPluginPermissions } = await import("../packages/jarvis-runtime/src/orchestrator.ts");

    expect(loadPluginPermissions("plugin-test-plugin", db)).toEqual(["execute_web", "read_crm"]);
  });
});
