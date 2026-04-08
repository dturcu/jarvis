import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type RunStatus = "queued" | "planning" | "awaiting_approval" | "executing" | "completed" | "failed" | "cancelled";

export type RunEventType =
  | "run_started"
  | "plan_built"
  | "plan_critique"
  | "plan_multi_viewpoint"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "approval_requested"
  | "approval_resolved"
  | "disagreement_resolved"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "daemon_shutdown";

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
 * SQLite-backed run store. Tracks agent run lifecycle via the durable `runs`
 * table (authoritative current state) and `run_events` table (audit trail).
 *
 * Current status is always read from DB, never from an in-memory cache.
 *
 * ── Retention Policy (#70) ──────────────────────────────────────────────────
 * Intended data-lifecycle rules (not yet implemented — document intent now,
 * build compaction job later):
 *
 *  - run_events older than 90 days: compact into per-run summary rows, then
 *    delete the individual step-level events. The summary preserves final
 *    status, duration, step count, and error (if any).
 *
 *  - channel_messages previews older than 30 days: archive preview_json to
 *    cold storage (or drop if full content is retained in full_content_json),
 *    keeping the message row for thread-continuity queries.
 *
 * Until the compaction job ships, these tables grow unbounded. Monitor
 * runtime.db size via the dashboard health endpoint.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class RunStore {
  constructor(private db: DatabaseSync) {}

  /** Start a new run. Inserts into runs table and emits run_started event atomically. Returns run_id. */
  startRun(agentId: string, triggerKind?: string, commandId?: string, goal?: string, runId?: string, owner?: string): string {
    runId = runId ?? randomUUID();
    const now = new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO runs (run_id, agent_id, status, trigger_kind, command_id, goal, started_at, owner)
        VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)
      `).run(runId, agentId, triggerKind ?? null, commandId ?? null, goal ?? null, now, owner ?? null);

      // Inline transition to 'planning' + event emission within the same transaction
      this.db.prepare(`
        UPDATE runs SET status = 'planning' WHERE run_id = ?
      `).run(runId);

      this.db.prepare(`
        INSERT INTO run_events (event_id, run_id, agent_id, event_type, step_no, action, payload_json, created_at)
        VALUES (?, ?, ?, 'run_started', NULL, NULL, NULL, ?)
      `).run(randomUUID(), runId, agentId, now);

      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    return runId;
  }

  /** Transition a run to a new status. Validates the transition and emits an event atomically. */
  transition(
    runId: string,
    agentId: string,
    newStatus: RunStatus,
    eventType: RunEventType,
    payload?: { step_no?: number; action?: string; details?: Record<string, unknown> },
  ): void {
    // Read current status from DB (outside transaction — read-only)
    const currentStatus = this.getStatus(runId);
    if (currentStatus) {
      const allowed = VALID_TRANSITIONS[currentStatus];
      if (allowed && !allowed.includes(newStatus)) {
        throw new Error(
          `Invalid run transition: ${currentStatus} -> ${newStatus} (run ${runId})`,
        );
      }
    }

    const completedAt = (newStatus === "completed" || newStatus === "failed" || newStatus === "cancelled")
      ? new Date().toISOString()
      : null;
    const error = payload?.details?.error ?? payload?.details?.reason ?? null;

    // Atomic: status update + event emission
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE runs SET status = ?, completed_at = COALESCE(?, completed_at),
          error = COALESCE(?, error), current_step = COALESCE(?, current_step)
        WHERE run_id = ?
      `).run(
        newStatus,
        completedAt,
        error ? String(error) : null,
        payload?.step_no ?? null,
        runId,
      );

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

      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Update run metadata (goal, total_steps) without changing status. */
  updateRunMeta(runId: string, meta: { goal?: string; total_steps?: number }): void {
    if (meta.goal !== undefined) {
      this.db.prepare("UPDATE runs SET goal = ? WHERE run_id = ?").run(meta.goal, runId);
    }
    if (meta.total_steps !== undefined) {
      this.db.prepare("UPDATE runs SET total_steps = ? WHERE run_id = ?").run(meta.total_steps, runId);
    }
  }

  /** Set the owner of a run (who initiated it). */
  setRunOwner(runId: string, owner: string): void {
    this.db.prepare("UPDATE runs SET owner = ? WHERE run_id = ?").run(owner, runId);
  }

  /** Assign a run to a specific operator for review/action. */
  assignRun(runId: string, assignee: string): void {
    this.db.prepare("UPDATE runs SET assignee = ? WHERE run_id = ?").run(assignee, runId);
  }

  /** Get runs owned by or assigned to a specific user. */
  getRunsByUser(userId: string, limit = 20): Array<{
    run_id: string; agent_id: string; status: RunStatus;
    trigger_kind: string | null; command_id: string | null;
    goal: string | null; total_steps: number | null;
    current_step: number; error: string | null;
    started_at: string; completed_at: string | null;
    owner: string | null; assignee: string | null;
  }> {
    return this.db.prepare(
      "SELECT * FROM runs WHERE owner = ? OR assignee = ? ORDER BY started_at DESC LIMIT ?",
    ).all(userId, userId, limit) as any[];
  }

  /** Emit a run event without changing status (e.g., step_started within executing). */
  emitEvent(
    runId: string,
    agentId: string,
    eventType: RunEventType | string,
    payload?: { step_no?: number; action?: string; details?: Record<string, unknown> },
  ): void {
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
  }

  /** Get current status of a run from the durable runs table. */
  getStatus(runId: string): RunStatus | null {
    const row = this.db.prepare(
      "SELECT status FROM runs WHERE run_id = ?",
    ).get(runId) as { status: string } | undefined;
    return (row?.status as RunStatus) ?? null;
  }

  /** Find the most recent run by its linked command_id. Used to link retry runs to originals. */
  getRunByCommandId(commandId: string): { run_id: string; agent_id: string; status: string } | null {
    const row = this.db.prepare(
      "SELECT run_id, agent_id, status FROM runs WHERE command_id = ? ORDER BY started_at DESC LIMIT 1",
    ).get(commandId) as { run_id: string; agent_id: string; status: string } | undefined;
    return row ?? null;
  }

  /** Get a run record. */
  getRun(runId: string): {
    run_id: string; agent_id: string; status: RunStatus;
    trigger_kind: string | null; command_id: string | null;
    goal: string | null; total_steps: number | null;
    current_step: number; error: string | null;
    started_at: string; completed_at: string | null;
  } | null {
    return this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as any ?? null;
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

  /** Get recent runs across all agents from the durable runs table. */
  getRecentRuns(limit = 20): Array<{
    run_id: string;
    agent_id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
  }> {
    return this.db.prepare(
      "SELECT run_id, agent_id, status, started_at, completed_at FROM runs ORDER BY started_at DESC LIMIT ?",
    ).all(limit) as any[];
  }

  /** Mark a run's associated command as completed, failed, or cancelled. */
  completeCommand(runId: string, status: "completed" | "failed" | "cancelled"): void {
    this.db.prepare(`
      UPDATE agent_commands SET status = ?, completed_at = ?
      WHERE command_id = (SELECT command_id FROM runs WHERE run_id = ? AND command_id IS NOT NULL)
    `).run(status, new Date().toISOString(), runId);
  }
}
