/**
 * Unified Jarvis Setup — configure all integrations in one flow.
 *
 * Usage:
 *   npx tsx scripts/setup-jarvis.ts          # Interactive setup for all services
 *   npx tsx scripts/setup-jarvis.ts gmail     # Setup Gmail only
 *   npx tsx scripts/setup-jarvis.ts calendar  # Setup Google Calendar only
 *   npx tsx scripts/setup-jarvis.ts telegram  # Setup Telegram only
 *   npx tsx scripts/setup-jarvis.ts status    # Show current config status
 *
 * Prerequisites:
 *   1. Google Cloud project with Gmail + Calendar APIs enabled
 *   2. OAuth 2.0 credentials (Desktop application type)
 *   3. A Telegram bot created via @BotFather
 */

import { google } from "googleapis";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import https from "node:https";
import http from "node:http";

const CONFIG_DIR = path.join(os.homedir(), ".jarvis");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const CRM_DB_PATH = path.join(CONFIG_DIR, "crm.db");
const KNOWLEDGE_DB_PATH = path.join(CONFIG_DIR, "knowledge.db");

// ─── Helpers ────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

function loadConfig(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>; }
  catch { return {}; }
}

function saveConfig(config: Record<string, unknown>): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, res => {
      let data = "";
      res.on("data", (c: Buffer) => data += c.toString());
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function checkMark(ok: boolean): string { return ok ? "  [OK]" : "  [--]"; }

// ─── Status ─────────────────────────────────────────────────────────────────

function showStatus(): void {
  const config = loadConfig();
  console.log("\n=== Jarvis Configuration Status ===\n");

  // Databases
  console.log("DATABASES:");
  console.log(`${checkMark(fs.existsSync(CRM_DB_PATH))} crm.db      ${fs.existsSync(CRM_DB_PATH) ? "exists" : "MISSING — run: npx tsx scripts/init-jarvis.ts"}`);
  console.log(`${checkMark(fs.existsSync(KNOWLEDGE_DB_PATH))} knowledge.db ${fs.existsSync(KNOWLEDGE_DB_PATH) ? "exists" : "MISSING — run: npx tsx scripts/init-jarvis.ts"}`);

  // Gmail
  const gmail = config.gmail as Record<string, string> | undefined;
  console.log("\nGMAIL:");
  if (gmail?.client_id && gmail?.refresh_token) {
    console.log(`${checkMark(true)} Configured (client_id: ${gmail.client_id.slice(0, 20)}...)`);
  } else {
    console.log(`${checkMark(false)} Not configured — run: npx tsx scripts/setup-jarvis.ts gmail`);
  }

  // Calendar
  const calendar = config.calendar as Record<string, string> | undefined;
  console.log("\nCALENDAR:");
  if (calendar?.client_id && calendar?.refresh_token) {
    console.log(`${checkMark(true)} Configured (client_id: ${calendar.client_id.slice(0, 20)}...)`);
  } else if (gmail?.client_id && gmail?.refresh_token) {
    console.log(`${checkMark(false)} Not configured — run: npx tsx scripts/setup-jarvis.ts calendar`);
    console.log("         (can reuse Gmail OAuth credentials)");
  } else {
    console.log(`${checkMark(false)} Not configured — set up Gmail first, then calendar`);
  }

  // Chrome
  const chrome = config.chrome as Record<string, string> | undefined;
  console.log("\nCHROME (browser automation):");
  if (chrome?.debugging_url) {
    console.log(`${checkMark(true)} Configured (${chrome.debugging_url})`);
  } else {
    console.log(`${checkMark(false)} Not configured — run: npm run setup chrome`);
  }

  // Telegram
  const telegram = config.telegram as Record<string, string> | undefined;
  console.log("\nTELEGRAM:");
  if (telegram?.bot_token && telegram?.chat_id) {
    console.log(`${checkMark(true)} Configured (chat_id: ${telegram.chat_id})`);
  } else {
    console.log(`${checkMark(false)} Not configured — run: npx tsx scripts/setup-jarvis.ts telegram`);
  }

  // Toggl
  const toggl = config.toggl as Record<string, string> | undefined;
  console.log("\nTOGGL (time tracking):");
  if (toggl?.api_token && toggl?.workspace_id) {
    console.log(`${checkMark(true)} Configured (workspace: ${toggl.workspace_id})`);
  } else {
    console.log(`${checkMark(false)} Not configured — run: npx tsx scripts/setup-jarvis.ts toggl`);
  }

  // Google Drive
  const drive = config.drive as Record<string, string> | undefined;
  console.log("\nGOOGLE DRIVE:");
  if (drive?.client_id && drive?.refresh_token) {
    console.log(`${checkMark(true)} Configured (client_id: ${drive.client_id.slice(0, 20)}...)`);
  } else if (gmail?.client_id && gmail?.refresh_token) {
    console.log(`${checkMark(false)} Not configured — run: npx tsx scripts/setup-jarvis.ts drive`);
    console.log("         (can reuse Gmail OAuth credentials)");
  } else {
    console.log(`${checkMark(false)} Not configured — set up Gmail first, then drive`);
  }

  // LM Studio
  const lmsUrl = (config.lmstudio_url as string) ?? "http://localhost:1234";
  console.log("\nLM STUDIO:");
  console.log(`  URL: ${lmsUrl}`);
  console.log(`  Model: ${(config.default_model as string) ?? "auto"}`);

  // Runtime mode
  console.log("\nRUNTIME:");
  console.log(`  Adapter mode: ${(config.adapter_mode as string) ?? "real"}`);

  console.log("\nRun 'npx tsx scripts/setup-jarvis.ts' to configure missing services.\n");
}

// ─── Gmail Setup ────────────────────────────────────────────────────────────

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

async function setupGmail(): Promise<void> {
  console.log("\n=== Gmail Setup ===\n");
  console.log("Prerequisites:");
  console.log("  1. Go to https://console.cloud.google.com/apis/credentials");
  console.log("  2. Create an OAuth 2.0 Client ID (type: Desktop application)");
  console.log("  3. Enable the Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com\n");

  const config = loadConfig();
  const existing = config.gmail as Record<string, string> | undefined;

  let clientId = existing?.client_id ?? process.env["GOOGLE_CLIENT_ID"] ?? "";
  let clientSecret = existing?.client_secret ?? process.env["GOOGLE_CLIENT_SECRET"] ?? "";

  if (clientId) {
    const reuse = await prompt(`Found existing client_id (${clientId.slice(0, 30)}...). Reuse? [Y/n]: `);
    if (reuse.toLowerCase() === "n") clientId = "";
  }

  if (!clientId) clientId = await prompt("Google OAuth Client ID: ");
  if (!clientSecret) clientSecret = await prompt("Google OAuth Client Secret: ");

  if (!clientId || !clientSecret) {
    console.error("Error: Client ID and Secret are required.");
    return;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
  const authUrl = oauth2.generateAuthUrl({ access_type: "offline", scope: GMAIL_SCOPES, prompt: "consent" });

  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl);
  console.log();

  const authCode = await prompt("Paste the authorization code here: ");
  if (!authCode) { console.error("Authorization code required."); return; }

  try {
    const { tokens } = await oauth2.getToken(authCode);
    if (!tokens.refresh_token) {
      console.error("No refresh token received. Try again with a fresh consent.");
      return;
    }

    config.gmail = { client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token };
    saveConfig(config);
    console.log("\n[OK] Gmail configured successfully!");

    // Test connection
    try {
      oauth2.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const profile = await gmail.users.getProfile({ userId: "me" });
      console.log(`     Connected as: ${profile.data.emailAddress}`);
    } catch {
      console.log("     (could not verify connection — credentials saved anyway)");
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
  }
}

// ─── Calendar Setup ─────────────────────────────────────────────────────────

const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar"];

async function setupCalendar(): Promise<void> {
  console.log("\n=== Google Calendar Setup ===\n");

  const config = loadConfig();
  const gmail = config.gmail as Record<string, string> | undefined;
  const existing = config.calendar as Record<string, string> | undefined;

  let clientId = existing?.client_id ?? gmail?.client_id ?? "";
  let clientSecret = existing?.client_secret ?? gmail?.client_secret ?? "";

  if (gmail?.client_id && !existing?.client_id) {
    console.log("Using Gmail OAuth credentials (same Google Cloud project).\n");
    console.log("Make sure the Calendar API is enabled:");
    console.log("  https://console.cloud.google.com/apis/library/calendar-json.googleapis.com\n");
  }

  if (!clientId) clientId = await prompt("Google OAuth Client ID: ");
  if (!clientSecret) clientSecret = await prompt("Google OAuth Client Secret: ");

  if (!clientId || !clientSecret) {
    console.error("Error: Client ID and Secret are required.");
    return;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
  const authUrl = oauth2.generateAuthUrl({ access_type: "offline", scope: CALENDAR_SCOPES, prompt: "consent" });

  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl);
  console.log();

  const authCode = await prompt("Paste the authorization code here: ");
  if (!authCode) { console.error("Authorization code required."); return; }

  try {
    const { tokens } = await oauth2.getToken(authCode);
    if (!tokens.refresh_token) {
      console.error("No refresh token received.");
      return;
    }

    config.calendar = { client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token };
    saveConfig(config);
    console.log("\n[OK] Google Calendar configured successfully!");

    // Test connection
    try {
      oauth2.setCredentials(tokens);
      const cal = google.calendar({ version: "v3", auth: oauth2 });
      const list = await cal.calendarList.list({ maxResults: 1 });
      const primary = list.data.items?.[0];
      if (primary) console.log(`     Primary calendar: ${primary.summary}`);
    } catch {
      console.log("     (could not verify connection — credentials saved anyway)");
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
  }
}

// ─── Chrome Setup ───────────────────────────────────────────────────────────

async function setupChrome(): Promise<void> {
  console.log("\n=== Chrome Browser Setup ===\n");
  console.log("Jarvis connects to your existing Chrome to reuse your logins.\n");

  const config = loadConfig();
  const existing = config.chrome as Record<string, string> | undefined;
  const debuggingUrl = existing?.debugging_url ?? "http://127.0.0.1:9222";

  // Test connection
  console.log(`Testing connection to ${debuggingUrl}...`);
  try {
    const result = await httpGet(`${debuggingUrl}/json/version`);
    const data = JSON.parse(result) as { Browser?: string; webSocketDebuggerUrl?: string };
    console.log(`[OK] Chrome connected: ${data.Browser ?? "unknown version"}`);

    config.chrome = { debugging_url: debuggingUrl };
    saveConfig(config);
    console.log("\n[OK] Chrome configured!");
    console.log("\nIMPORTANT: Make sure you're logged into these sites in Chrome:");
    console.log("  - linkedin.com");
    console.log("  - twitter.com / x.com");
    console.log("  - github.com");
    console.log("  - reddit.com");
    console.log("  - facebook.com");
    console.log("\nJarvis will reuse your existing sessions.");
  } catch {
    console.log(`\nCould not connect to Chrome at ${debuggingUrl}`);
    console.log("\nTo enable Chrome remote debugging:\n");
    console.log("  WINDOWS: Right-click your Chrome shortcut → Properties → Target:");
    console.log('  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222\n');
    console.log("  Or run from terminal:");
    console.log('  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222\n');
    console.log("  Then re-run: npm run setup chrome\n");

    const customUrl = await prompt(`Custom debugging URL [${debuggingUrl}]: `) || debuggingUrl;
    config.chrome = { debugging_url: customUrl };
    saveConfig(config);
    console.log("Configuration saved (connection will be tested on next daemon start).");
  }
}

// ─── Telegram Setup ─────────────────────────────────────────────────────────

async function setupTelegram(): Promise<void> {
  console.log("\n=== Telegram Bot Setup ===\n");
  console.log("Prerequisites:");
  console.log("  1. Open Telegram, search for @BotFather");
  console.log("  2. Send /newbot, follow the prompts");
  console.log("  3. Copy the bot token\n");

  const config = loadConfig();
  const existing = config.telegram as Record<string, string> | undefined;

  let botToken = existing?.bot_token ?? "";
  if (botToken) {
    const reuse = await prompt(`Found existing bot token (${botToken.slice(0, 10)}...). Reuse? [Y/n]: `);
    if (reuse.toLowerCase() === "n") botToken = "";
  }

  if (!botToken) botToken = await prompt("Bot token (from @BotFather): ");
  if (!botToken) { console.error("Bot token required."); return; }

  // Test the bot token
  console.log("\nTesting bot connection...");
  try {
    const result = await httpGet(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = JSON.parse(result) as { ok: boolean; result?: { username: string } };
    if (!data.ok) { console.error("Invalid bot token."); return; }
    console.log(`[OK] Bot connected: @${data.result?.username}`);
  } catch {
    console.error("Could not reach Telegram API. Check your bot token.");
    return;
  }

  // Get chat ID
  let chatId = existing?.chat_id ?? "";
  if (!chatId) {
    console.log("\nNow send ANY message to your bot in Telegram, then press Enter here.");
    await prompt("Press Enter after sending a message to the bot...");

    try {
      const result = await httpGet(`https://api.telegram.org/bot${botToken}/getUpdates?limit=1&offset=-1`);
      const data = JSON.parse(result) as { ok: boolean; result: Array<{ message?: { chat: { id: number } } }> };
      if (data.ok && data.result.length > 0 && data.result[0]?.message) {
        chatId = String(data.result[0].message.chat.id);
        console.log(`[OK] Your chat ID: ${chatId}`);
      } else {
        console.log("No messages found. Enter your chat ID manually:");
        chatId = await prompt("Chat ID: ");
      }
    } catch {
      chatId = await prompt("Could not auto-detect. Enter your chat ID manually: ");
    }
  }

  if (!chatId) { console.error("Chat ID required."); return; }

  config.telegram = { bot_token: botToken, chat_id: chatId };
  saveConfig(config);
  console.log("\n[OK] Telegram bot configured!");

  // Send a test message
  try {
    const testResult = await httpGet(
      `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent("Jarvis is connected! Use /help to see available commands.")}`
    );
    const testData = JSON.parse(testResult) as { ok: boolean };
    if (testData.ok) console.log("     Test message sent to your Telegram.");
  } catch {
    console.log("     (could not send test message)");
  }
}

// ─── LM Studio Setup ───────────────────────────────────────────────────────

async function setupLmStudio(): Promise<void> {
  console.log("\n=== LM Studio Setup ===\n");

  const config = loadConfig();
  const currentUrl = (config.lmstudio_url as string) ?? "http://localhost:1234";

  const url = await prompt(`LM Studio URL [${currentUrl}]: `) || currentUrl;

  // Test connection
  console.log(`\nTesting connection to ${url}...`);
  try {
    const result = await httpGet(`${url}/v1/models`);
    const data = JSON.parse(result) as { data: Array<{ id: string }> };
    if (data.data.length > 0) {
      console.log(`[OK] Connected! Available models:`);
      for (const m of data.data) {
        console.log(`     - ${m.id}`);
      }

      const model = await prompt(`\nDefault model [${data.data[0]?.id ?? "auto"}]: `) || data.data[0]?.id ?? "auto";
      config.lmstudio_url = url;
      config.default_model = model;
    } else {
      console.log("[OK] Connected but no models loaded. Load a model in LM Studio first.");
      config.lmstudio_url = url;
    }
  } catch {
    console.log(`Could not connect to ${url}. Is LM Studio running?`);
    const save = await prompt("Save anyway? [y/N]: ");
    if (save.toLowerCase() === "y") {
      config.lmstudio_url = url;
    }
  }

  saveConfig(config);
  console.log("[OK] LM Studio configuration saved.");
}

// ─── Toggl Setup ───────────────────────────────────────────────────────────

async function setupToggl(): Promise<void> {
  console.log("\n=== Toggl Time Tracking Setup ===\n");
  console.log("Prerequisites:");
  console.log("  1. Go to https://track.toggl.com/profile");
  console.log("  2. Scroll to 'API Token' at the bottom");
  console.log("  3. Copy your API token");
  console.log("  4. Note your workspace ID from the URL (e.g., https://track.toggl.com/123456/timer)\n");

  const config = loadConfig();
  const existing = config.toggl as Record<string, string> | undefined;

  let apiToken = existing?.api_token ?? "";
  if (apiToken) {
    const reuse = await prompt(`Found existing API token (${apiToken.slice(0, 8)}...). Reuse? [Y/n]: `);
    if (reuse.toLowerCase() === "n") apiToken = "";
  }

  if (!apiToken) apiToken = await prompt("Toggl API Token: ");
  if (!apiToken) { console.error("API token required."); return; }

  let workspaceId = existing?.workspace_id ?? "";
  if (!workspaceId) workspaceId = await prompt("Toggl Workspace ID: ");
  if (!workspaceId) { console.error("Workspace ID required."); return; }

  // Test connection
  console.log("\nTesting Toggl connection...");
  try {
    const auth = Buffer.from(`${apiToken}:api_token`).toString("base64");
    const result = await new Promise<string>((resolve, reject) => {
      https.get(
        "https://api.track.toggl.com/api/v9/me",
        { headers: { "Authorization": `Basic ${auth}` } },
        res => {
          let data = "";
          res.on("data", (c: Buffer) => data += c.toString());
          res.on("end", () => resolve(data));
          res.on("error", reject);
        }
      ).on("error", reject);
    });

    const userData = JSON.parse(result) as { email?: string; fullname?: string };
    if (userData.email) {
      console.log(`[OK] Connected as: ${userData.fullname ?? userData.email}`);
    } else {
      console.log("[OK] Connection established (could not parse user data).");
    }
  } catch {
    console.log("Could not verify Toggl connection. Saving anyway.");
  }

  config.toggl = { api_token: apiToken, workspace_id: workspaceId };
  saveConfig(config);
  console.log("\n[OK] Toggl configured successfully!");
}

// ─── Google Drive Setup ────────────────────────────────────────────────────

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

async function setupDrive(): Promise<void> {
  console.log("\n=== Google Drive Setup ===\n");

  const config = loadConfig();
  const gmail = config.gmail as Record<string, string> | undefined;
  const existing = config.drive as Record<string, string> | undefined;

  let clientId = existing?.client_id ?? gmail?.client_id ?? "";
  let clientSecret = existing?.client_secret ?? gmail?.client_secret ?? "";

  if (gmail?.client_id && !existing?.client_id) {
    console.log("Using Gmail OAuth credentials (same Google Cloud project).\n");
    console.log("Make sure the Google Drive API is enabled:");
    console.log("  https://console.cloud.google.com/apis/library/drive.googleapis.com\n");
  }

  if (!clientId) clientId = await prompt("Google OAuth Client ID: ");
  if (!clientSecret) clientSecret = await prompt("Google OAuth Client Secret: ");

  if (!clientId || !clientSecret) {
    console.error("Error: Client ID and Secret are required.");
    return;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
  const authUrl = oauth2.generateAuthUrl({ access_type: "offline", scope: DRIVE_SCOPES, prompt: "consent" });

  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl);
  console.log();

  const authCode = await prompt("Paste the authorization code here: ");
  if (!authCode) { console.error("Authorization code required."); return; }

  try {
    const { tokens } = await oauth2.getToken(authCode);
    if (!tokens.refresh_token) {
      console.error("No refresh token received.");
      return;
    }

    config.drive = { client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token };
    saveConfig(config);
    console.log("\n[OK] Google Drive configured successfully!");

    // Test connection
    try {
      oauth2.setCredentials(tokens);
      const drive = google.drive({ version: "v3", auth: oauth2 });
      const about = await drive.about.get({ fields: "user" });
      const user = about.data.user;
      if (user?.emailAddress) console.log(`     Connected as: ${user.emailAddress}`);
    } catch {
      console.log("     (could not verify connection — credentials saved anyway)");
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
  }
}

// ─── Security Summary ──────────────────────────────────────────────────────

function printSecuritySummary(config: Record<string, unknown>): void {
  console.log("──── Security Summary ─────────────────────────");
  const ok = (label: string) => console.log(`  [OK] ${label}`);
  const missing = (label: string) => console.log(`  [--] ${label}`);

  if (config.api_token || config.api_tokens) ok("API authentication configured");
  else missing("API authentication — not configured");

  if (config.api_tokens) ok("Role-based tokens (admin/operator/viewer)");
  else missing("Role-based tokens — not configured (single token or none)");

  if (config.bind_host === "127.0.0.1") ok("Dashboard bound to localhost");
  else missing("Dashboard bound to " + (config.bind_host ?? "default") + " — consider 127.0.0.1");

  if (config.appliance_mode) ok("Appliance mode enabled");
  else missing("Appliance mode — disabled");

  if (config.webhook_secret) ok("Webhook secret configured");
  else missing("Webhook secret — not configured");

  console.log();
}

// ─── Appliance Preset ──────────────────────────────────────────────────────

async function setupAppliancePreset(): Promise<void> {
  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║     Jarvis Appliance Mode Setup       ║");
  console.log("╚═══════════════════════════════════════╝\n");
  console.log("Auto-configuring strict security defaults...\n");

  const { randomBytes } = await import("node:crypto");
  const config = loadConfig();

  // Generate role-based tokens
  const tokens: Record<string, string> = {
    admin: randomBytes(32).toString("hex"),
    operator: randomBytes(32).toString("hex"),
    viewer: randomBytes(32).toString("hex"),
  };
  config.api_tokens = tokens;

  // Localhost binding
  config.bind_host = "127.0.0.1";

  // Appliance mode
  config.appliance_mode = true;

  // Webhook secret
  const webhookSecret = randomBytes(32).toString("hex");
  config.webhook_secret = webhookSecret;

  saveConfig(config);

  console.log("Configuration saved to ~/.jarvis/config.json\n");
  console.log("──── Generated Credentials ────────────────────");
  for (const [role, token] of Object.entries(tokens)) {
    console.log(`  ${role} token: ${(token as string).slice(0, 8)}...${(token as string).slice(-4)}`);
  }
  console.log(`  webhook secret: ${webhookSecret.slice(0, 8)}...${webhookSecret.slice(-4)}`);
  console.log();

  printSecuritySummary(config);
  console.log("Appliance setup complete. Start with: npm start\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2]?.toLowerCase();

  if (arg === "status") {
    showStatus();
    return;
  }

  if (arg === "gmail") { await setupGmail(); return; }
  if (arg === "calendar") { await setupCalendar(); return; }
  if (arg === "chrome") { await setupChrome(); return; }
  if (arg === "telegram") { await setupTelegram(); return; }
  if (arg === "lmstudio") { await setupLmStudio(); return; }
  if (arg === "toggl") { await setupToggl(); return; }
  if (arg === "drive") { await setupDrive(); return; }

  if (arg === "appliance") {
    await setupAppliancePreset();
    return;
  }

  // Full interactive setup
  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║       Jarvis Integration Setup        ║");
  console.log("╚═══════════════════════════════════════╝\n");
  console.log("This will walk you through configuring all Jarvis integrations.\n");

  // 1. Check databases
  if (!fs.existsSync(CRM_DB_PATH) || !fs.existsSync(KNOWLEDGE_DB_PATH)) {
    console.log("Databases not found. Initializing...");
    console.log("Run: npx tsx scripts/init-jarvis.ts\n");
  }

  // 2. API Security — generate tokens for the dashboard API
  const config = loadConfig();
  if (!config.api_token && !config.api_tokens) {
    console.log("──── API Security ─────────────────────────────");
    console.log("The dashboard API needs an authentication token for safe operation.");
    console.log("Without it, the dashboard is read-only in dev mode and locked in production.\n");
    const doToken = await prompt("Generate API token now? [Y/n]: ");
    if (doToken.toLowerCase() !== "n") {
      const { randomBytes } = await import("node:crypto");

      const doRoleBased = await prompt("Generate role-based tokens (admin/operator/viewer)? [y/N]: ");
      if (doRoleBased.toLowerCase() === "y") {
        const tokens: Record<string, string> = {
          admin: randomBytes(32).toString("hex"),
          operator: randomBytes(32).toString("hex"),
          viewer: randomBytes(32).toString("hex"),
        };
        config.api_tokens = tokens;
        saveConfig(config);
        console.log(`\nRole-based API tokens generated and saved to ~/.jarvis/config.json`);
        for (const [role, token] of Object.entries(tokens)) {
          console.log(`  ${role}: ${(token as string).slice(0, 8)}...${(token as string).slice(-4)}`);
        }
        console.log();
      } else {
        const token = randomBytes(32).toString("hex");
        config.api_token = token;
        saveConfig(config);
        console.log(`\nAPI token generated and saved to ~/.jarvis/config.json`);
        console.log(`Token: ${token.slice(0, 8)}...${token.slice(-4)}`);
        console.log(`\nSet this as Authorization header: Bearer ${token}`);
        console.log(`Or set env: JARVIS_API_TOKEN=${token}\n`);
      }
    }
  } else {
    console.log("API token: already configured\n");
  }

  // 2b. Bind host
  console.log("──── Network Binding ──────────────────────────");
  const doLocalhost = await prompt("Bind dashboard to localhost only? [Y/n]: ");
  if (doLocalhost.toLowerCase() === "n") {
    config.bind_host = "0.0.0.0";
    console.log("Dashboard will listen on all interfaces (0.0.0.0)\n");
  } else {
    config.bind_host = "127.0.0.1";
    console.log("Dashboard will listen on localhost only (127.0.0.1)\n");
  }
  saveConfig(config);

  // 2c. Appliance mode
  console.log("──── Appliance Mode ───────────────────────────");
  const doAppliance = await prompt("Enable appliance mode (strict security)? [y/N]: ");
  if (doAppliance.toLowerCase() === "y") {
    config.appliance_mode = true;
    console.log("Appliance mode enabled\n");
  } else {
    config.appliance_mode = false;
  }
  saveConfig(config);

  // 2d. Webhook secret
  if (config.appliance_mode) {
    const { randomBytes } = await import("node:crypto");
    const secret = randomBytes(32).toString("hex");
    config.webhook_secret = secret;
    saveConfig(config);
    console.log("Webhook secret auto-generated for appliance mode");
    console.log(`Secret: ${secret.slice(0, 8)}...${secret.slice(-4)}\n`);
  } else if (!config.webhook_secret) {
    const doWebhook = await prompt("Generate webhook secret? [y/N]: ");
    if (doWebhook.toLowerCase() === "y") {
      const { randomBytes } = await import("node:crypto");
      const secret = randomBytes(32).toString("hex");
      config.webhook_secret = secret;
      saveConfig(config);
      console.log(`Webhook secret generated: ${secret.slice(0, 8)}...${secret.slice(-4)}\n`);
    }
  }

  // 3. LM Studio
  const doLms = await prompt("Configure LM Studio? [Y/n]: ");
  if (doLms.toLowerCase() !== "n") await setupLmStudio();

  // 3. Gmail
  const doGmail = await prompt("\nConfigure Gmail? [Y/n]: ");
  if (doGmail.toLowerCase() !== "n") await setupGmail();

  // 4. Calendar
  const doCal = await prompt("\nConfigure Google Calendar? [Y/n]: ");
  if (doCal.toLowerCase() !== "n") await setupCalendar();

  // 5. Chrome
  const doChrome = await prompt("\nConfigure Chrome browser automation? [Y/n]: ");
  if (doChrome.toLowerCase() !== "n") await setupChrome();

  // 6. Telegram
  const doTg = await prompt("\nConfigure Telegram bot? [Y/n]: ");
  if (doTg.toLowerCase() !== "n") await setupTelegram();

  // 7. Toggl
  const doToggl = await prompt("\nConfigure Toggl time tracking? [Y/n]: ");
  if (doToggl.toLowerCase() !== "n") await setupToggl();

  // 8. Google Drive
  const doDrive = await prompt("\nConfigure Google Drive? [Y/n]: ");
  if (doDrive.toLowerCase() !== "n") await setupDrive();

  console.log("\n=== Setup Complete ===\n");
  printSecuritySummary(config);
  showStatus();
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
