import { randomUUID } from "node:crypto";
import type { AgentDefinition, AgentTrigger } from "./schema.js";
import type { AgentMemoryStore } from "./memory.js";
import type { AgentPlan } from "./planner.js";

export type AgentRunStatus = "idle" | "planning" | "executing" | "awaiting_approval" | "completed" | "failed" | "paused";

export type AgentRun = {
  run_id: string;
  agent_id: string;
  trigger: AgentTrigger;
  goal: string;
  status: AgentRunStatus;
  current_step: number;
  total_steps: number;
  plan?: AgentPlan;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  error?: string;
};

export type AgentStepResult = {
  run_id: string;
  step: number;
  action: string;
  status: "completed" | "failed" | "awaiting_approval";
  output: Record<string, unknown>;
  reasoning: string;
};

export class AgentRuntime {
  private definitions = new Map<string, AgentDefinition>();
  private readonly memory: AgentMemoryStore;

  constructor(memory: AgentMemoryStore) {
    this.memory = memory;
  }

  registerAgent(def: AgentDefinition): void {
    this.definitions.set(def.agent_id, def);
  }

  getDefinition(agentId: string): AgentDefinition | undefined {
    return this.definitions.get(agentId);
  }

  /**
   * Create a new run object. The caller (orchestrator) owns the run lifecycle
   * and persists it via RunStore — AgentRuntime no longer caches run state.
   */
  startRun(agentId: string, trigger: AgentTrigger, goal?: string): AgentRun {
    const def = this.definitions.get(agentId);
    if (!def) throw new Error(`Agent not registered: ${agentId}`);
    const now = new Date().toISOString();
    return {
      run_id: randomUUID(),
      agent_id: agentId,
      trigger,
      goal: goal ?? def.description,
      status: "planning",
      current_step: 0,
      total_steps: def.max_steps_per_run,
      started_at: now,
      updated_at: now,
    };
  }

  /**
   * Clear short-term memory for a completed run. Called by the orchestrator
   * after a successful run so ephemeral memory is freed.
   */
  clearRunMemory(runId: string): void {
    this.memory.clearShortTerm(runId);
  }

  getStatus(agentId: string): { definition: AgentDefinition | undefined } {
    return { definition: this.definitions.get(agentId) };
  }
}
