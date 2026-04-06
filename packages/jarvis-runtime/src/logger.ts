import fs from "node:fs";
import { join } from "node:path";
import { JARVIS_DIR, TELEGRAM_QUEUE_FILE } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_FILE = join(JARVIS_DIR, "daemon.log");

export class Logger {
  private level: number;
  private logToFile: boolean;
  private alertOnError: boolean;

  constructor(level: LogLevel = "info", options?: { logToFile?: boolean; alertOnError?: boolean }) {
    this.level = LEVELS[level];
    this.logToFile = options?.logToFile ?? true;
    this.alertOnError = options?.alertOnError ?? true;
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    if (this.level <= 0) this.write("DEBUG", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    if (this.level <= 1) this.write("INFO", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    if (this.level <= 2) this.write("WARN", msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    if (this.level <= 3) {
      this.write("ERROR", msg, data);
      if (this.alertOnError) this.sendTelegramAlert(msg, data);
    }
  }

  private write(level: string, msg: string, data?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const tsShort = ts.slice(11, 19);
    const suffix = data ? ` ${JSON.stringify(data)}` : "";

    // Console output (human-friendly)
    const consoleLine = `[${tsShort}] [${level.padEnd(5)}] ${msg}${suffix}`;
    if (level === "ERROR" || level === "WARN") {
      console.error(consoleLine);
    } else {
      console.log(consoleLine);
    }

    // File output (structured JSON, one line per entry)
    if (this.logToFile) {
      try {
        const jsonLine = JSON.stringify({ ts, level, msg, ...(data ?? {}) }) + "\n";
        fs.appendFileSync(LOG_FILE, jsonLine);
      } catch { /* non-fatal */ }
    }
  }

  /** Push critical errors to Telegram queue for immediate notification */
  private sendTelegramAlert(msg: string, data?: Record<string, unknown>): void {
    try {
      const alertMsg = `JARVIS ERROR\n${msg}${data ? "\n" + JSON.stringify(data).slice(0, 300) : ""}`;

      let queue: Array<{ agent: string; message: string; ts: string; sent: boolean }> = [];
      try {
        if (fs.existsSync(TELEGRAM_QUEUE_FILE)) {
          queue = JSON.parse(fs.readFileSync(TELEGRAM_QUEUE_FILE, "utf8")) as typeof queue;
        }
      } catch { /* start fresh */ }

      queue.push({ agent: "daemon", message: alertMsg, ts: new Date().toISOString(), sent: false });
      fs.writeFileSync(TELEGRAM_QUEUE_FILE, JSON.stringify(queue, null, 2));
    } catch { /* non-fatal */ }
  }
}
