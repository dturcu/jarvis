import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type RunStatus = "queued" | "planning" | "awaiting_approval" | "executing" | "completed" | "failed" | "cancelled";

export type RunEventType =
  | "run_started"
  | "plan_built"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "approval_requested"
  | "approval_resolved"
  | "run_completed"
  | "run_failed"
  | "run_cancelled";

/** Valid state transitions for the run state machine. */
const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["planning", "cancelled"],
  planning: ["executing", "failed", "cancelled"],
  executing: ["awaiting_approval", "completed", "failed", "cancelled"],
  awaiting_approval: ["executing", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

/**
 * SQLite-backed run store. Tracks agent run lifecycle via run_events table.
 *
 * Each run has a current status. Every transition emits a run_event row for
 * auditability and replay.
 */
export class RunStore {
  private currentRuns = new Map<string, { status: RunStatus; agent_id: string }>();

  constructor(private db: DatabaseSync) {}

  /** Start a new run. Emits run_started event. Returns run_id. */
  startRun(agentId: string): string {
    const runId = randomUUID();
    this.currentRuns.set(runId, { status: "queued", agent_id: agentId });
    this.transition(runId, agentId, "planning", "run_started");
    return runId;
  }

  /** Transition a run to a new status. Validates the transition and emits an event. */
  transition(
    runId: string,
    agentId: string,
    newStatus: RunStatus,
    eventType: RunEventType,
    payload?: { step_no?: number; action?: string; details?: Record<string, unknown> },
  ): void {
    const current = this.currentRuns.get(runId);
    if (current) {
      const allowed = VALID_TRANSITIONS[current.status];
      if (allowed && !allowed.includes(newStatus)) {
        throw new Error(
          `Invalid run transition: ${current.status} -> ${newStatus} (run ${runId})`,
        );
      }
      current.status = newStatus;
    } else {
      this.currentRuns.set(runId, { status: newStatus, agent_id: agentId });
    }

    this.emitEvent(runId, agentId, eventType, payload);
  }

  /** Emit a run event without changing status (e.g., step_started within executing). */
  emitEvent(
    runId: string,
    agentId: string,
    eventType: RunEventType,
    payload?: { step_no?: number; action?: string; details?: Record<string, unknown> },
  ): void {
    try {
      this.db.prepare(`
        INSERT INTO run_events (event_id, run_id, agent_id, event_type, step_no, action, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        runId,
        agentId,
        eventType,
        payload?.step_no ?? null,
        payload?.action ?? null,
        payload?.details ? JSON.stringify(payload.details) : null,
        new Date().toISOString(),
      );
    } catch {
      // Best-effort: don't crash agent run if event emission fails
    }
  }

  /** Get current status of a run. */
  getStatus(runId: string): RunStatus | null {
    return this.currentRuns.get(runId)?.status ?? null;
  }

  /** Get all events for a run, ordered chronologically. */
  getRunEvents(runId: string): Array<{
    event_id: string;
    run_id: string;
    agent_id: string;
    event_type: string;
    step_no: number | null;
    action: string | null;
    payload_json: string | null;
    created_at: string;
  }> {
    return this.db.prepare(
      "SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC",
    ).all(runId) as Array<{
      event_id: string;
      run_id: string;
      agent_id: string;
      event_type: string;
      step_no: number | null;
      action: string | null;
      payload_json: string | null;
      created_at: string;
    }>;
  }

  /** Get recent runs across all agents. */
  getRecentRuns(limit = 20): Array<{
    run_id: string;
    agent_id: string;
    event_type: string;
    created_at: string;
  }> {
    return this.db.prepare(`
      SELECT DISTINCT run_id, agent_id, event_type, created_at
      FROM run_events
      WHERE event_type IN ('run_started', 'run_completed', 'run_failed', 'run_cancelled')
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      run_id: string;
      agent_id: string;
      event_type: string;
      created_at: string;
    }>;
  }

  /** Clean up in-memory tracking for completed/failed runs. */
  cleanup(runId: string): void {
    this.currentRuns.delete(runId);
  }
}
