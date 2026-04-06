import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { APPROVALS_FILE } from "./config.js";

export type ApprovalEntry = {
  id: string;
  agent: string;
  action: string;
  payload: string;
  created_at: string;
  status: "pending" | "approved" | "rejected";
  run_id: string;
  severity: "info" | "warning" | "critical";
  notified?: boolean;
};

function loadApprovals(): ApprovalEntry[] {
  if (!fs.existsSync(APPROVALS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8")) as ApprovalEntry[];
  } catch {
    return [];
  }
}

function writeApprovals(entries: ApprovalEntry[]): void {
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Write a new approval request to the shared approvals file.
 * Both Dashboard and Telegram bot poll this file and can resolve it.
 */
export function requestApproval(req: {
  agent_id: string;
  run_id: string;
  action: string;
  severity: "info" | "warning" | "critical";
  payload: string;
}): string {
  const id = randomUUID().slice(0, 8); // short ID for easy Telegram commands
  const approvals = loadApprovals();
  approvals.push({
    id,
    agent: req.agent_id,
    action: req.action,
    payload: req.payload,
    created_at: new Date().toISOString(),
    status: "pending",
    run_id: req.run_id,
    severity: req.severity,
  });
  writeApprovals(approvals);
  return id;
}

/**
 * Poll the approvals file until the given approval is resolved or timeout.
 * Dashboard sets status via POST /api/approvals/:id/approve.
 * Telegram bot sets status via /approve command.
 */
export async function waitForApproval(
  approvalId: string,
  timeoutMs = 24 * 60 * 60 * 1000,
  pollMs = 5_000,
): Promise<"approved" | "rejected" | "timeout"> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const approvals = loadApprovals();
    const entry = approvals.find(a => a.id === approvalId);
    if (entry && entry.status !== "pending") {
      return entry.status;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return "timeout";
}
