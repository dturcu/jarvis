export * from "./types.js";
export * from "./adapter.js";
export * from "./mock.js";
export * from "./execute.js";
export * from "./toggl-adapter.js";

import type { TimeAdapter } from "./adapter.js";
import { MockTimeAdapter } from "./mock.js";
import { TogglAdapter } from "./toggl-adapter.js";
import fs from "fs";
import os from "os";
import { join } from "path";

export function createTimeAdapter(mode: "mock" | "toggl"): TimeAdapter {
  if (mode === "toggl") {
    const configPath = join(os.homedir(), ".jarvis", "config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Toggl config not found at ${configPath}. Run the setup script first.`,
      );
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const toggl = config["toggl"] as
      | { api_token: string; workspace_id: string }
      | undefined;
    if (!toggl || !toggl.api_token || !toggl.workspace_id) {
      throw new Error(
        `Toggl credentials missing in ${configPath}. Run the setup script first.`,
      );
    }
    return new TogglAdapter(toggl);
  }
  return new MockTimeAdapter();
}
