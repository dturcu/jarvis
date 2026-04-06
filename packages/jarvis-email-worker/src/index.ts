export * from "./types.js";
export * from "./adapter.js";
export * from "./mock.js";
export * from "./execute.js";
export * from "./gmail-adapter.js";

import type { EmailAdapter } from "./adapter.js";
import { MockEmailAdapter } from "./mock.js";
import { GmailAdapter } from "./gmail-adapter.js";
import fs from "fs";
import os from "os";
import { join } from "path";

export function createEmailAdapter(mode: "mock" | "gmail"): EmailAdapter {
  if (mode === "gmail") {
    const configPath = join(os.homedir(), ".jarvis", "config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Gmail config not found at ${configPath}. Run the oauth-setup script first.`,
      );
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const gmail = config["gmail"] as
      | { client_id: string; client_secret: string; refresh_token: string }
      | undefined;
    if (!gmail || !gmail.client_id || !gmail.client_secret || !gmail.refresh_token) {
      throw new Error(
        `Gmail credentials missing in ${configPath}. Run the oauth-setup script first.`,
      );
    }
    return new GmailAdapter(gmail);
  }
  return new MockEmailAdapter();
}
