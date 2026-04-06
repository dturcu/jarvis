import fs from "node:fs";
import { join } from "node:path";
import { JARVIS_DIR } from "./config.js";
import type { Logger } from "./logger.js";

const STATUS_FILE = join(JARVIS_DIR, "daemon-status.json");
const WRITE_INTERVAL_MS = 10_000; // 10 seconds

export interface DaemonStatusData {
  pid: number;
  started_at: string;
  updated_at: string;
  agents_registered: number;
  schedules_active: number;
  last_run: {
    agent_id: string;
    status: string;
    completed_at: string;
  } | null;
  current_run: {
    agent_id: string;
    status: string;
    step: number;
    total_steps: number;
    current_action: string;
    started_at: string;
  } | null;
}

/**
 * StatusWriter: periodically writes daemon state to ~/.jarvis/daemon-status.json.
 * The dashboard reads this file to display live daemon info without IPC.
 */
export class StatusWriter {
  private state: DaemonStatusData;
  private timer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;

  constructor(agentsRegistered: number, schedulesActive: number, logger: Logger) {
    this.logger = logger;
    this.state = {
      pid: process.pid,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      agents_registered: agentsRegistered,
      schedules_active: schedulesActive,
      last_run: null,
      current_run: null,
    };
  }

  /** Start periodic writes. Call once after initialization. */
  start(): void {
    // Write immediately on start
    this.flush();
    // Then write every WRITE_INTERVAL_MS
    this.timer = setInterval(() => this.flush(), WRITE_INTERVAL_MS);
    // Unref so this timer doesn't keep the process alive
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
    this.logger.info(`Status writer started (interval: ${WRITE_INTERVAL_MS / 1000}s)`);
  }

  /** Stop periodic writes. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Write one final status showing daemon is stopping
    this.flush();
    this.logger.info("Status writer stopped");
  }

  /** Mark an agent run as started. */
  setCurrentRun(agentId: string, totalSteps: number): void {
    this.state.current_run = {
      agent_id: agentId,
      status: "executing",
      step: 0,
      total_steps: totalSteps,
      current_action: "planning",
      started_at: new Date().toISOString(),
    };
    this.flush();
  }

  /** Update progress of the current run. */
  updateStep(step: number, action: string): void {
    if (this.state.current_run) {
      this.state.current_run.step = step;
      this.state.current_run.current_action = action;
      this.state.current_run.status = "executing";
      this.flush();
    }
  }

  /** Update total steps (after planning completes). */
  updateTotalSteps(totalSteps: number): void {
    if (this.state.current_run) {
      this.state.current_run.total_steps = totalSteps;
    }
  }

  /** Mark current run as awaiting approval. */
  setAwaitingApproval(step: number, action: string): void {
    if (this.state.current_run) {
      this.state.current_run.status = "awaiting_approval";
      this.state.current_run.step = step;
      this.state.current_run.current_action = action;
      this.flush();
    }
  }

  /** Mark current run as completed and move to last_run. */
  completeRun(status: string): void {
    if (this.state.current_run) {
      this.state.last_run = {
        agent_id: this.state.current_run.agent_id,
        status,
        completed_at: new Date().toISOString(),
      };
      this.state.current_run = null;
      this.flush();
    }
  }

  /** Write state to disk. */
  private flush(): void {
    this.state.updated_at = new Date().toISOString();
    try {
      fs.writeFileSync(STATUS_FILE, JSON.stringify(this.state, null, 2), "utf8");
    } catch (e) {
      this.logger.error(`Failed to write daemon status: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
