import type { AgentRun, AgentTrigger } from "@jarvis/agent-framework";
import { getJarvisState } from "@jarvis/shared";
import type { JobClaimResult } from "@jarvis/shared";
import type { OrchestratorDeps } from "./orchestrator.js";
import { runAgent } from "./orchestrator.js";
import type { Logger } from "./logger.js";

const WORKER_ID = `daemon-${process.pid}`;
const LEASE_SECONDS = 300; // 5 minutes, extended by heartbeat during execution

/**
 * Manages concurrent agent execution by claiming jobs from JarvisState.
 *
 * Instead of maintaining an in-memory queue, this claims durable jobs from
 * the JarvisState SQLite database. Browser-using agents share a single
 * browser resource and cannot run concurrently with each other.
 */
export class AgentQueue {
  private running = new Map<string, Promise<AgentRun>>();
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
   * Process the queue: claim jobs from JarvisState and start execution
   * up to capacity and resource lock constraints.
   */
  async processQueue(): Promise<void> {
    while (this.running.size < this.maxConcurrent) {
      // Determine which routes are available (skip browser if locked)
      const routes = ["agent"];

      const claim = getJarvisState().claimJob({
        worker_id: WORKER_ID,
        routes,
        lease_seconds: LEASE_SECONDS,
      });

      if (!claim) break; // No eligible jobs

      const agentId = this.extractAgentId(claim);
      if (!agentId) {
        this.logger.warn(`Claimed job ${claim.job_id} has no agent_id — skipping`);
        this.failClaim(claim, "Missing agent_id in job input");
        continue;
      }

      // Check resource locks
      if (this.browserAgents.has(agentId) && this.resourceLocks.has("browser")) {
        this.logger.debug(`Skipping ${agentId} — browser locked by ${this.resourceLocks.get("browser")}`);
        // Release the claim so another worker can pick it up
        // For now, just break — the job stays claimed and will be requeued on lease expiry
        break;
      }

      // Don't run the same agent concurrently
      if (this.running.has(agentId)) {
        this.logger.debug(`Agent ${agentId} already running — skipping`);
        break;
      }

      // Acquire resource locks
      if (this.browserAgents.has(agentId)) {
        this.resourceLocks.set("browser", agentId);
        this.logger.debug(`Acquired browser lock for ${agentId}`);
      }

      // Build trigger from job input
      const trigger = this.buildTrigger(claim);

      this.logger.info(
        `Starting agent ${agentId} (job=${claim.job_id}, running=${this.running.size + 1}/${this.maxConcurrent})`,
      );

      // Start the agent run, passing the claim info for heartbeat and completion
      const runPromise = runAgent(agentId, trigger, this.deps, {
        jobId: claim.job_id!,
        claimId: claim.claim_id!,
        workerId: WORKER_ID,
        leaseSeconds: LEASE_SECONDS,
      })
        .catch((e) => {
          this.logger.error(
            `Agent ${agentId} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
          // Report failure to JarvisState
          this.failClaim(claim, e instanceof Error ? e.message : String(e));
          // Return a minimal failed AgentRun so the map entry resolves
          return {
            run_id: claim.job_id ?? "error",
            agent_id: agentId,
            trigger,
            goal: "",
            status: "failed" as const,
            current_step: 0,
            total_steps: 0,
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            error: e instanceof Error ? e.message : String(e),
          };
        })
        .then((result) => {
          // Release resource locks
          if (this.browserAgents.has(agentId)) {
            this.resourceLocks.delete("browser");
            this.logger.debug(`Released browser lock for ${agentId}`);
          }

          // Remove from running
          this.running.delete(agentId);
          this.logger.info(
            `Agent ${agentId} finished (running=${this.running.size})`,
          );

          // Process queue again — may unblock waiting entries
          this.processQueue();

          return result;
        });

      this.running.set(agentId, runPromise);
    }
  }

  /** Extract agent_id from the claimed job's input */
  private extractAgentId(claim: JobClaimResult): string | undefined {
    const input = claim.job?.input as Record<string, unknown> | undefined;
    return typeof input?.agent_id === "string" ? input.agent_id : undefined;
  }

  /** Build an AgentTrigger from the claimed job's input */
  private buildTrigger(claim: JobClaimResult): AgentTrigger {
    const input = claim.job?.input as Record<string, unknown> | undefined;
    const triggerKind = (input?.trigger_kind as string) ?? "manual";

    if (triggerKind === "schedule") {
      return { kind: "schedule", cron: (input?.cron as string) ?? "" };
    }
    return { kind: "manual" };
  }

  /** Report a failed claim back to JarvisState */
  private failClaim(claim: JobClaimResult, message: string): void {
    if (!claim.job_id) return;
    try {
      getJarvisState().handleWorkerCallback({
        contract_version: "jarvis.v1",
        job_id: claim.job_id,
        job_type: claim.job_type ?? "agent.start",
        attempt: claim.attempt ?? 1,
        status: "failed",
        summary: message,
        worker_id: WORKER_ID,
        claim_id: claim.claim_id,
        error: {
          code: "EXECUTION_ERROR",
          message,
          retryable: true,
        },
        metrics: {
          finished_at: new Date().toISOString(),
        },
      });
    } catch (e) {
      this.logger.error(`Failed to report job failure: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Graceful shutdown: cancel claims for running jobs so they can be requeued on restart.
   */
  async shutdown(): Promise<void> {
    const runningIds = this.getRunningAgentIds();
    if (runningIds.length === 0) {
      this.logger.info("Shutdown: no running agents to release");
      return;
    }

    this.logger.info(`Shutdown: releasing ${runningIds.length} running agent(s): ${runningIds.join(", ")}`);
    // Claims will expire naturally via lease timeout, allowing requeueExpiredJobs() to
    // pick them up on restart. No explicit cancellation needed — JarvisState handles this.
    this.running.clear();
  }

  /** Get the list of currently running agent IDs (for shutdown coordination). */
  getRunningAgentIds(): string[] {
    return Array.from(this.running.keys());
  }

  /** Number of agents currently executing */
  get runningCount(): number {
    return this.running.size;
  }

  /** Check if a specific agent is currently executing */
  isRunning(agentId: string): boolean {
    return this.running.has(agentId);
  }
}
