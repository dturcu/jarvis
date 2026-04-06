export * from "./types.js";
export * from "./adapter.js";
export * from "./mock.js";
export * from "./execute.js";
export * from "./google-drive-adapter.js";

import type { DriveAdapter } from "./adapter.js";
import { MockDriveAdapter } from "./mock.js";
import { GoogleDriveAdapter } from "./google-drive-adapter.js";
import fs from "fs";
import os from "os";
import { join } from "path";

export function createDriveAdapter(mode: "mock" | "google"): DriveAdapter {
  if (mode === "google") {
    const configPath = join(os.homedir(), ".jarvis", "config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Drive config not found at ${configPath}. Run the setup script first.`,
      );
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const drive = config["drive"] as
      | { client_id: string; client_secret: string; refresh_token: string }
      | undefined;
    if (!drive || !drive.client_id || !drive.client_secret || !drive.refresh_token) {
      throw new Error(
        `Google Drive credentials missing in ${configPath}. Run the setup script first.`,
      );
    }
    return new GoogleDriveAdapter(drive);
  }
  return new MockDriveAdapter();
}
