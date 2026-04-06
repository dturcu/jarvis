export type PlanStep = {
  step: number;
  action: string;
  input: Record<string, unknown>;
  reasoning: string;
};

export type AgentPlan = {
  run_id: string;
  agent_id: string;
  goal: string;
  steps: PlanStep[];
  created_at: string;
};

export function buildPlan(params: {
  agent_id: string;
  run_id: string;
  goal: string;
  system_prompt: string;
  context: string;
  capabilities: string[];
  max_steps: number;
}): AgentPlan {
  return {
    run_id: params.run_id,
    agent_id: params.agent_id,
    goal: params.goal,
    steps: [],
    created_at: new Date().toISOString(),
  };
}
