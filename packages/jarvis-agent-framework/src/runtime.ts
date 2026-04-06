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
  private runs = new Map<string, AgentRun>();
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

  startRun(agentId: string, trigger: AgentTrigger, goal?: string): AgentRun {
    const def = this.definitions.get(agentId);
    if (!def) throw new Error(`Agent not registered: ${agentId}`);
    const now = new Date().toISOString();
    const run: AgentRun = {
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
    this.runs.set(run.run_id, run);
    return run;
  }

  pauseRun(runId: string): AgentRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const updated = { ...run, status: "paused" as AgentRunStatus, updated_at: new Date().toISOString() };
    this.runs.set(runId, updated);
    return updated;
  }

  resumeRun(runId: string): AgentRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const updated = { ...run, status: "executing" as AgentRunStatus, updated_at: new Date().toISOString() };
    this.runs.set(runId, updated);
    return updated;
  }

  completeRun(runId: string, error?: string): AgentRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const now = new Date().toISOString();
    const updated = {
      ...run,
      status: (error ? "failed" : "completed") as AgentRunStatus,
      error,
      updated_at: now,
      completed_at: now,
    };
    this.runs.set(runId, updated);
    if (!error) this.memory.clearShortTerm(runId);
    return updated;
  }

  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(agentId?: string): AgentRun[] {
    const all = [...this.runs.values()];
    return agentId ? all.filter(r => r.agent_id === agentId) : all;
  }

  getStatus(agentId: string): { definition: AgentDefinition | undefined; runs: AgentRun[]; active_runs: number } {
    const runs = this.listRuns(agentId);
    const active = runs.filter(r => r.status === "planning" || r.status === "executing" || r.status === "awaiting_approval");
    return { definition: this.definitions.get(agentId), runs, active_runs: active.length };
  }
}
