import type { AgentRun, AgentTrigger } from "@jarvis/agent-framework";
import type { OrchestratorDeps } from "./orchestrator.js";
import { runAgent } from "./orchestrator.js";
import type { Logger } from "./logger.js";

type QueueEntry = {
  agentId: string;
  trigger: AgentTrigger;
  priority: number; // higher = run first
  enqueuedAt: string;
};

/**
 * Manages concurrent agent execution with resource-lock awareness.
 *
 * Browser-using agents (social-engagement, content-engine) share a single
 * browser resource and cannot run concurrently with each other. All other
 * agents can run in parallel up to `maxConcurrent`.
 */
export class AgentQueue {
  private running = new Map<string, Promise<AgentRun>>();
  private queue: QueueEntry[] = [];
  private maxConcurrent: number;
  private resourceLocks = new Map<string, string>(); // resource -> agentId

  // Browser-using agents: social-engagement, content-engine
  private readonly browserAgents = new Set(["social-engagement", "content-engine"]);

  constructor(
    maxConcurrent: number,
    private deps: OrchestratorDeps,
    private logger: Logger,
  ) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  /**
   * Add an agent run to the queue, sorted by priority (descending).
   * If the agent is already running or already queued, this is a no-op.
   */
  enqueue(agentId: string, trigger: AgentTrigger, priority = 0): void {
    // Don't enqueue if already running
    if (this.running.has(agentId)) {
      this.logger.debug(`Agent ${agentId} already running — skipping enqueue`);
      return;
    }

    // Don't enqueue if already in queue
    if (this.queue.some((e) => e.agentId === agentId)) {
      this.logger.debug(`Agent ${agentId} already queued — skipping enqueue`);
      return;
    }

    this.queue.push({
      agentId,
      trigger,
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

      const runPromise = runAgent(entry.agentId, entry.trigger, this.deps)
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

          // Process queue again — may unblock waiting entries
          this.processQueue();

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
