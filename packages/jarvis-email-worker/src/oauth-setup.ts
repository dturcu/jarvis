/**
 * One-time OAuth2 setup for Gmail API access.
 *
 * Usage:
 *   npx tsx packages/jarvis-email-worker/src/oauth-setup.ts
 *
 * Prerequisites:
 *   1. Create a Google Cloud project
 *   2. Enable the Gmail API
 *   3. Create OAuth 2.0 credentials (Desktop application type)
 *   4. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables
 *      (or pass them interactively)
 *
 * This script will:
 *   1. Open a browser for consent
 *   2. Exchange the auth code for tokens
 *   3. Save credentials to ~/.jarvis/config.json under the 'gmail' key
 */

import { google } from "googleapis";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const CONFIG_DIR = path.join(os.homedir(), ".jarvis");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function loadConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

async function main(): Promise<void> {
  console.log("=== Jarvis Gmail OAuth Setup ===\n");

  const clientId =
    process.env["GMAIL_CLIENT_ID"] ||
    (await prompt("Enter Google OAuth Client ID: "));

  const clientSecret =
    process.env["GMAIL_CLIENT_SECRET"] ||
    (await prompt("Enter Google OAuth Client Secret: "));

  if (!clientId || !clientSecret) {
    console.error("Error: Client ID and Client Secret are required.");
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob",
  );

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\nOpen this URL in your browser to authorize:\n");
  console.log(authUrl);
  console.log();

  const authCode = await prompt("Enter the authorization code: ");

  if (!authCode) {
    console.error("Error: Authorization code is required.");
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2.getToken(authCode);

    if (!tokens.refresh_token) {
      console.error(
        "Error: No refresh token received. Make sure you selected 'offline' access.",
      );
      process.exit(1);
    }

    const config = loadConfig();
    config["gmail"] = {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
    };
    saveConfig(config);

    console.log(`\nCredentials saved to ${CONFIG_PATH}`);
    console.log("Gmail adapter is ready to use.");
  } catch (error) {
    console.error(
      "Error exchanging auth code:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
