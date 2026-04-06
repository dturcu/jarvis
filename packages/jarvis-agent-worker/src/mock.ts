import { randomUUID } from "node:crypto";
import type { AgentAdapter, ExecutionOutcome } from "./adapter.js";
import type {
  AgentStartInput,
  AgentStartOutput,
  AgentStepInput,
  AgentStepOutput,
  AgentStatusInput,
  AgentStatusOutput,
  AgentPauseInput,
  AgentPauseOutput,
  AgentResumeInput,
  AgentResumeOutput,
  AgentConfigureInput,
  AgentConfigureOutput
} from "./types.js";
import { AgentWorkerError } from "./adapter.js";

const MOCK_NOW = "2026-04-04T12:00:00.000Z";

const MOCK_AGENT_IDS = [
  "bd-pipeline",
  "proposal-engine",
  "evidence-auditor",
  "contract-reviewer",
  "staffing-monitor",
  "content-engine",
  "portfolio-monitor",
  "garden-calendar"
];

type MockRun = {
  run_id: string;
  agent_id: string;
  status: string;
  current_step: number;
  total_steps: number;
  goal: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
};

export type MockAgentAdapterOptions = {
  registered_agents?: string[];
};

export class MockAgentAdapter implements AgentAdapter {
  private runs = new Map<string, MockRun>();
  private configurations = new Map<string, Record<string, unknown>>();
  private readonly agents: Set<string>;

  constructor(options: MockAgentAdapterOptions = {}) {
    this.agents = new Set(options.registered_agents ?? MOCK_AGENT_IDS);
  }

  async start(input: AgentStartInput): Promise<ExecutionOutcome<AgentStartOutput>> {
    if (!this.agents.has(input.agent_id)) {
      throw new AgentWorkerError("AGENT_NOT_FOUND", `Agent not found: ${input.agent_id}`);
    }
    const run_id = randomUUID();
    const run: MockRun = {
      run_id,
      agent_id: input.agent_id,
      status: "planning",
      current_step: 0,
      total_steps: 5,
      goal: input.goal ?? `Run ${input.agent_id}`,
      started_at: MOCK_NOW,
      updated_at: MOCK_NOW
    };
    this.runs.set(run_id, run);
    return {
      summary: `Started agent run for ${input.agent_id}`,
      structured_output: {
        run_id,
        agent_id: input.agent_id,
        status: "planning",
        goal: run.goal,
        started_at: MOCK_NOW
      }
    };
  }

  async step(input: AgentStepInput): Promise<ExecutionOutcome<AgentStepOutput>> {
    const run = this.runs.get(input.run_id);
    if (!run) throw new AgentWorkerError("RUN_NOT_FOUND", `Run not found: ${input.run_id}`);
    run.current_step += 1;
    run.status = run.current_step >= run.total_steps ? "completed" : "executing";
    return {
      summary: `Executed step ${run.current_step} of ${input.run_id}`,
      structured_output: {
        run_id: input.run_id,
        step: run.current_step,
        action: `mock.action.step_${run.current_step}`,
        status: "completed",
        output: { step: run.current_step },
        reasoning: `Mock reasoning for step ${run.current_step}`
      }
    };
  }

  async status(input: AgentStatusInput): Promise<ExecutionOutcome<AgentStatusOutput>> {
    const agentRuns = [...this.runs.values()].filter(r => r.agent_id === input.agent_id);
    const active = agentRuns.filter(r =>
      ["planning", "executing", "awaiting_approval"].includes(r.status)
    );
    return {
      summary: `Status for agent ${input.agent_id}: ${active.length} active runs`,
      structured_output: {
        agent_id: input.agent_id,
        active_runs: active.length,
        total_runs: agentRuns.length,
        runs: agentRuns.map(r => ({
          run_id: r.run_id,
          status: r.status,
          current_step: r.current_step,
          total_steps: r.total_steps,
          started_at: r.started_at,
          updated_at: r.updated_at,
          completed_at: r.completed_at
        }))
      }
    };
  }

  async pause(input: AgentPauseInput): Promise<ExecutionOutcome<AgentPauseOutput>> {
    const run = this.runs.get(input.run_id);
    if (!run) throw new AgentWorkerError("RUN_NOT_FOUND", `Run not found: ${input.run_id}`);
    run.status = "paused";
    return {
      summary: `Paused run ${input.run_id}`,
      structured_output: { run_id: input.run_id, status: "paused", paused_at: MOCK_NOW }
    };
  }

  async resume(input: AgentResumeInput): Promise<ExecutionOutcome<AgentResumeOutput>> {
    const run = this.runs.get(input.run_id);
    if (!run) throw new AgentWorkerError("RUN_NOT_FOUND", `Run not found: ${input.run_id}`);
    run.status = "executing";
    return {
      summary: `Resumed run ${input.run_id}`,
      structured_output: { run_id: input.run_id, status: "executing", resumed_at: MOCK_NOW }
    };
  }

  async configure(input: AgentConfigureInput): Promise<ExecutionOutcome<AgentConfigureOutput>> {
    const existing = this.configurations.get(input.agent_id) ?? {};
    this.configurations.set(input.agent_id, { ...existing, ...input.updates });
    const applied = Object.keys(input.updates);
    return {
      summary: `Configured agent ${input.agent_id}: updated ${applied.join(", ")}`,
      structured_output: { agent_id: input.agent_id, updated_at: MOCK_NOW, applied_updates: applied }
    };
  }

  getRunCount(): number {
    return this.runs.size;
  }

  getActiveRuns(): string[] {
    return [...this.runs.values()]
      .filter(r => ["planning", "executing"].includes(r.status))
      .map(r => r.run_id);
  }

  getConfiguration(agentId: string): Record<string, unknown> | undefined {
    return this.configurations.get(agentId);
  }
}
