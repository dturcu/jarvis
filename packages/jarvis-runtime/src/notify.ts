import fs from "node:fs";
import { TELEGRAM_QUEUE_FILE } from "./config.js";

type QueueEntry = {
  agent: string;
  message: string;
  ts: string;
  sent: boolean;
};

/**
 * Append a message to the Telegram relay queue.
 * The telegram-bot process polls this file and delivers unsent messages.
 */
export function writeTelegramQueue(agentId: string, message: string): void {
  let queue: QueueEntry[] = [];
  try {
    if (fs.existsSync(TELEGRAM_QUEUE_FILE)) {
      queue = JSON.parse(fs.readFileSync(TELEGRAM_QUEUE_FILE, "utf8")) as QueueEntry[];
    }
  } catch { /* start fresh */ }

  queue.push({
    agent: agentId,
    message,
    ts: new Date().toISOString(),
    sent: false,
  });

  fs.writeFileSync(TELEGRAM_QUEUE_FILE, JSON.stringify(queue, null, 2));
}
