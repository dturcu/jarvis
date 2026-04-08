import type { AgentRun, AgentTrigger } from "@jarvis/agent-framework";
import type { OrchestratorDeps } from "./orchestrator.js";
import { runAgent } from "./orchestrator.js";
import type { Logger } from "./logger.js";

type QueueEntry = {
  agentId: string;
  trigger: AgentTrigger;
  commandId?: string; // links this queue entry to an agent_commands row
  commandPayload?: Record<string, unknown>; // parsed payload_json from agent_commands (carries retry_of, etc.)
  owner?: string; // user who triggered the run (for team-mode ownership)
  priority: number; // higher = run first
  enqueuedAt: string;
};

/**
 * Manages concurrent agent execution with resource-lock awareness.
 *
 * Agents listed in `browserAgents` share a single browser resource and
 * cannot run concurrently with each other. All other agents can run in
 * parallel up to `maxConcurrent`.
 */
export class AgentQueue {
  private running = new Map<string, Promise<AgentRun>>();
  private queue: QueueEntry[] = [];
  private maxConcurrent: number;
  private resourceLocks = new Map<string, string>(); // resource -> agentId
  private _draining = false;
  private _drainResolvers: Array<() => void> = [];

  // Agents that require an exclusive browser lock.  Empty after the
  // 2026-04-08 roster reset — will be populated when browser-using
  // agents are re-introduced.
  private readonly browserAgents = new Set<string>();

  constructor(
    maxConcurrent: number,
    private deps: OrchestratorDeps,
    private logger: Logger,
  ) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  /** Whether the queue is draining (no new work accepted). */
  get isDraining(): boolean { return this._draining; }

  /**
   * Enter drain mode: reject new enqueues, return a promise that resolves
   * when all running agents complete (or after timeoutMs).
   */
  drain(timeoutMs = 30_000): Promise<void> {
    this._draining = true;
    this.queue.length = 0; // Clear pending queue
    this.logger.info(`Drain mode: waiting for ${this.running.size} running agent(s) to complete`);

    if (this.running.size === 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      this._drainResolvers.push(resolve);
      setTimeout(() => {
        this.logger.warn(`Drain timeout after ${timeoutMs}ms with ${this.running.size} still running`);
        resolve();
      }, timeoutMs);
    });
  }

  /**
   * Add an agent run to the queue, sorted by priority (descending).
   * If the agent is already running or already queued, this is a no-op.
   */
  enqueue(agentId: string, trigger: AgentTrigger, priority = 0, commandId?: string, commandPayload?: Record<string, unknown>, owner?: string): boolean {
    // Reject in drain mode
    if (this._draining) {
      this.logger.debug(`Agent ${agentId} rejected — queue is draining`);
      return false;
    }

    // Don't enqueue if already running
    if (this.running.has(agentId)) {
      this.logger.debug(`Agent ${agentId} already running — skipping enqueue`);
      return false;
    }

    // Don't enqueue if already in queue
    if (this.queue.some((e) => e.agentId === agentId)) {
      this.logger.debug(`Agent ${agentId} already queued — skipping enqueue`);
      return false;
    }

    this.queue.push({
      agentId,
      trigger,
      commandId,
      commandPayload,
      owner,
      priority,
      enqueuedAt: new Date().toISOString(),
    });

    // Sort by priority descending, then by enqueue time ascending (FIFO within same priority)
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enqueuedAt.localeCompare(b.enqueuedAt);
    });

    this.logger.debug(
      `Enqueued agent ${agentId} (priority=${priority}, queue=${this.queue.length})`,
    );
    return true;
  }

  /**
   * Process the queue: start as many agents as capacity and resource locks allow.
   * Called after enqueue and after each agent completion.
   */
  async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const entry = this.pickNext();
      if (!entry) break; // All remaining entries are blocked on resources

      // Acquire resource locks
      if (this.browserAgents.has(entry.agentId)) {
        this.resourceLocks.set("browser", entry.agentId);
        this.logger.debug(`Acquired browser lock for ${entry.agentId}`);
      }

      // Start the agent run
      this.logger.info(
        `Starting agent ${entry.agentId} (running=${this.running.size + 1}/${this.maxConcurrent}, queued=${this.queue.length})`,
      );

      // Attach command_id and command_payload to trigger so orchestrator can link the run
      // and log retry relationships atomically
      const triggerWithCommand = entry.commandId || entry.owner
        ? {
            ...entry.trigger,
            ...(entry.commandId ? { command_id: entry.commandId } : {}),
            ...(entry.commandPayload ? { command_payload: entry.commandPayload } : {}),
            ...(entry.owner ? { owner: entry.owner } : {}),
          }
        : entry.trigger;
      const runPromise = runAgent(entry.agentId, triggerWithCommand, this.deps)
        .catch((e) => {
          this.logger.error(
            `Agent ${entry.agentId} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
          // Return a minimal failed AgentRun so the map entry resolves
          return {
            run_id: "error",
            agent_id: entry.agentId,
            trigger: entry.trigger,
            goal: "",
            status: "failed" as const,
            current_step: 0,
            total_steps: 0,
            started_at: entry.enqueuedAt,
            updated_at: new Date().toISOString(),
            error: e instanceof Error ? e.message : String(e),
          };
        })
        .then((result) => {
          // Release resource locks
          if (this.browserAgents.has(entry.agentId)) {
            this.resourceLocks.delete("browser");
            this.logger.debug(`Released browser lock for ${entry.agentId}`);
          }

          // Remove from running
          this.running.delete(entry.agentId);
          this.logger.info(
            `Agent ${entry.agentId} finished (running=${this.running.size}, queued=${this.queue.length})`,
          );

          // Check drain completion
          if (this._draining && this.running.size === 0) {
            for (const resolver of this._drainResolvers) resolver();
            this._drainResolvers.length = 0;
          }

          // Process queue again — may unblock waiting entries
          if (!this._draining) {
            this.processQueue();
          }

          return result;
        });

      this.running.set(entry.agentId, runPromise);
    }
  }

  /**
   * Pick the next eligible entry from the queue.
   * Skips entries that need the browser if it's currently locked.
   * Removes and returns the entry, or returns undefined if nothing is eligible.
   */
  private pickNext(): QueueEntry | undefined {
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];

      // Check browser lock: if this agent needs browser and browser is locked by another agent, skip
      if (
        this.browserAgents.has(entry.agentId) &&
        this.resourceLocks.has("browser")
      ) {
        this.logger.debug(
          `Skipping ${entry.agentId} — browser locked by ${this.resourceLocks.get("browser")}`,
        );
        continue;
      }

      // This entry is eligible — remove from queue and return
      this.queue.splice(i, 1);
      return entry;
    }

    return undefined;
  }

  /** Number of agents currently executing */
  get runningCount(): number {
    return this.running.size;
  }

  /** Number of agents waiting in the queue */
  get queueLength(): number {
    return this.queue.length;
  }

  /** Check if a specific agent is currently executing */
  isRunning(agentId: string): boolean {
    return this.running.has(agentId);
  }
}
