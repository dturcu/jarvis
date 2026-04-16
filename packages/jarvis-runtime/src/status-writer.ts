import { randomUUID } from "node:crypto";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "./logger.js";

const WRITE_INTERVAL_MS = 10_000; // 10 seconds

type ActiveRun = {
  agent_id: string;
  status: string;
  step: number;
  total_steps: number;
  current_action: string;
  started_at: string;
};

export interface DaemonStatusData {
  pid: number;
  started_at: string;
  updated_at: string;
  agents_registered: number;
  schedules_active: number;
  /** Whether the daemon is running in safe mode (autonomous execution disabled). */
  safe_mode: boolean;
  /** Reason the daemon entered safe mode, or null if not in safe mode. */
  safe_mode_reason: string | null;
  last_run: {
    agent_id: string;
    status: string;
    completed_at: string;
  } | null;
  /** @deprecated Use active_runs instead */
  current_run: ActiveRun | null;
  /** All currently executing agent runs (supports concurrent execution). */
  active_runs: ActiveRun[];
}

/**
 * StatusWriter: periodically writes daemon heartbeat to runtime.db.
 * The dashboard reads from the daemon_heartbeats table to display live daemon info.
 *
 * Tracks multiple concurrent runs (AgentQueue supports parallel execution).
 */
export class StatusWriter {
  private state: DaemonStatusData;
  private timer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;
  private daemonId: string;
  private db: DatabaseSync | null;
  private getSchedulesActive: () => number;

  constructor(agentsRegistered: number, getSchedulesActive: () => number, logger: Logger, db?: DatabaseSync) {
    this.logger = logger;
    this.daemonId = `daemon-${process.pid}`;
    this.db = db ?? null;
    this.getSchedulesActive = getSchedulesActive;
    this.state = {
      pid: process.pid,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      agents_registered: agentsRegistered,
      schedules_active: getSchedulesActive(),
      safe_mode: false,
      safe_mode_reason: null,
      last_run: null,
      current_run: null,
      active_runs: [],
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

  /** Update safe mode status. Called by the daemon on startup and when exiting safe mode. */
  setSafeMode(enabled: boolean, reason: string | null): void {
    this.state.safe_mode = enabled;
    this.state.safe_mode_reason = reason;
    this.flush();
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

  /** Mark an agent run as started. Supports concurrent runs. */
  setCurrentRun(agentId: string, totalSteps: number): void {
    const run: ActiveRun = {
      agent_id: agentId,
      status: "executing",
      step: 0,
      total_steps: totalSteps,
      current_action: "planning",
      started_at: new Date().toISOString(),
    };
    // Remove any stale entry for this agent (shouldn't happen, but defensive)
    this.state.active_runs = this.state.active_runs.filter(r => r.agent_id !== agentId);
    this.state.active_runs.push(run);
    // Keep current_run as the most recently started for backward compat
    this.state.current_run = run;
    this.flush();
  }

  /** Update progress of a specific agent's run. */
  updateStep(step: number, action: string, agentId?: string): void {
    const run = agentId
      ? this.state.active_runs.find(r => r.agent_id === agentId)
      : this.state.active_runs[this.state.active_runs.length - 1];
    if (run) {
      run.step = step;
      run.current_action = action;
      run.status = "executing";
      this.state.current_run = run;
      this.flush();
    }
  }

  /** Update total steps for a specific agent (after planning completes). */
  updateTotalSteps(totalSteps: number, agentId?: string): void {
    const run = agentId
      ? this.state.active_runs.find(r => r.agent_id === agentId)
      : this.state.active_runs[this.state.active_runs.length - 1];
    if (run) {
      run.total_steps = totalSteps;
    }
  }

  /** Mark a specific run as awaiting approval. */
  setAwaitingApproval(step: number, action: string, agentId?: string): void {
    const run = agentId
      ? this.state.active_runs.find(r => r.agent_id === agentId)
      : this.state.active_runs[this.state.active_runs.length - 1];
    if (run) {
      run.status = "awaiting_approval";
      run.step = step;
      run.current_action = action;
      this.state.current_run = run;
      this.flush();
    }
  }

  /** Mark a run as completed and remove from active runs. */
  completeRun(status: string, agentId?: string): void {
    const idx = agentId
      ? this.state.active_runs.findIndex(r => r.agent_id === agentId)
      : this.state.active_runs.length - 1;
    if (idx >= 0) {
      const run = this.state.active_runs[idx];
      if (!run) return;
      this.state.last_run = {
        agent_id: run.agent_id,
        status,
        completed_at: new Date().toISOString(),
      };
      this.state.active_runs.splice(idx, 1);
      // Update current_run: set to most recent active, or null
      this.state.current_run = this.state.active_runs.at(-1) ?? null;
      this.flush();
    }
  }

  /** Write state to database (daemon_heartbeats table). */
  private flush(): void {
    this.state.updated_at = new Date().toISOString();
    this.state.schedules_active = this.getSchedulesActive();
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
        this.state.active_runs.length > 0 ? "busy" : "idle",
        this.state.updated_at,
        null,
        this.state.active_runs.map(r => r.agent_id).join(",") || null,
        JSON.stringify(this.state),
      );
    } catch (e) {
      this.logger.error(`Failed to write daemon heartbeat: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
