import fs from "node:fs";
import { join } from "node:path";
import { JARVIS_DIR } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_FILE = join(JARVIS_DIR, "daemon.log");

/** Patterns that should be redacted in log output. */
const REDACT_PATTERNS = [
  /(?:api[_-]?key|api[_-]?token|secret|password|refresh[_-]?token|client[_-]?secret|bot[_-]?token|webhook[_-]?secret)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-./+=]{8,})/gi,
];

function redact(text: string): string {
  let result = text;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, (match, _value) => {
      const eqIdx = match.search(/[:=]/);
      return match.slice(0, eqIdx + 1) + " [REDACTED]";
    });
  }
  return result;
}

/**
 * Correlation context for structured log entries.
 * Attach to a Logger via `withContext()` to automatically include
 * run_id, agent_id, command_id, step_no, action in every log line.
 */
export type LogContext = {
  run_id?: string;
  agent_id?: string;
  command_id?: string;
  step_no?: number;
  action?: string;
};

export class Logger {
  private level: number;
  private logToFile: boolean;
  private alertOnError: boolean;
  private context: LogContext;

  constructor(level: LogLevel = "info", options?: { logToFile?: boolean; alertOnError?: boolean; context?: LogContext }) {
    this.level = LEVELS[level];
    this.logToFile = options?.logToFile ?? true;
    this.alertOnError = options?.alertOnError ?? true;
    this.context = options?.context ?? {};
  }

  /**
   * Create a child logger with additional correlation context.
   * The child shares the same level and output settings.
   */
  withContext(ctx: LogContext): Logger {
    return new Logger(
      Object.entries(LEVELS).find(([, v]) => v === this.level)?.[0] as LogLevel ?? "info",
      { logToFile: this.logToFile, alertOnError: this.alertOnError, context: { ...this.context, ...ctx } },
    );
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
      if (this.alertOnError) this.sendAlert(msg, data);
    }
  }

  private write(level: string, msg: string, data?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const tsShort = ts.slice(11, 19);

    // Merge context + data for structured output
    const merged = { ...this.context, ...(data ?? {}) };
    const hasMerged = Object.keys(merged).length > 0;
    const suffix = hasMerged ? ` ${JSON.stringify(merged)}` : "";

    // Console output (human-friendly with optional context prefix)
    const ctxPrefix = this.context.agent_id ? `[${this.context.agent_id}] ` : "";
    const consoleLine = redact(`[${tsShort}] [${level.padEnd(5)}] ${ctxPrefix}${msg}${suffix}`);
    if (level === "ERROR" || level === "WARN") {
      console.error(consoleLine);
    } else {
      console.log(consoleLine);
    }

    // File output (structured JSON, one line per entry, redacted)
    if (this.logToFile) {
      try {
        const jsonLine = redact(JSON.stringify({ ts, level, msg, ...merged })) + "\n";
        fs.appendFileSync(LOG_FILE, jsonLine);
      } catch { /* non-fatal */ }
    }
  }

  /** Push critical errors as alerts (notification system handles delivery) */
  private sendAlert(msg: string, data?: Record<string, unknown>): void {
    try {
      // Write to a simple alert file that the notification system picks up
      const alertFile = join(JARVIS_DIR, "alerts.jsonl");
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        level: "ERROR",
        msg: redact(msg),
        agent_id: this.context.agent_id ?? "daemon",
        run_id: this.context.run_id,
        data: data ? JSON.parse(redact(JSON.stringify(data))) : undefined,
      });
      fs.appendFileSync(alertFile, entry + "\n");
    } catch { /* non-fatal */ }
  }
}
