import { randomUUID } from "node:crypto";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "./logger.js";

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
 * StatusWriter: periodically writes daemon heartbeat to runtime.db.
 * The dashboard reads from the daemon_heartbeats table to display live daemon info.
 */
export class StatusWriter {
  private state: DaemonStatusData;
  private timer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;
  private daemonId: string;
  private db: DatabaseSync | null;

  constructor(agentsRegistered: number, schedulesActive: number, logger: Logger, db?: DatabaseSync) {
    this.logger = logger;
    this.daemonId = `daemon-${process.pid}`;
    this.db = db ?? null;
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
    this.flush();
    this.timer = setInterval(() => this.flush(), WRITE_INTERVAL_MS);
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

  /** Write state to database (daemon_heartbeats table). */
  private flush(): void {
    this.state.updated_at = new Date().toISOString();
    if (!this.db) return;

    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO daemon_heartbeats (daemon_id, pid, host, version, status, last_seen_at, current_run_id, current_agent_id, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.daemonId,
        this.state.pid,
        os.hostname(),
        "0.1.0",
        this.state.current_run ? "busy" : "idle",
        this.state.updated_at,
        null,
        this.state.current_run?.agent_id ?? null,
        JSON.stringify(this.state),
      );
    } catch (e) {
      this.logger.error(`Failed to write daemon heartbeat: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
