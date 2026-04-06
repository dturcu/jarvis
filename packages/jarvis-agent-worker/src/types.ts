// agent.start
export type AgentStartInput = {
  agent_id: string;
  trigger_kind: "schedule" | "event" | "manual" | "threshold";
  goal?: string;
  trigger_data?: Record<string, unknown>;
};
export type AgentStartOutput = {
  run_id: string;
  agent_id: string;
  status: string;
  goal: string;
  started_at: string;
};

// agent.step
export type AgentStepInput = {
  run_id: string;
};
export type AgentStepOutput = {
  run_id: string;
  step: number;
  action: string;
  status: "completed" | "failed" | "awaiting_approval";
  output: Record<string, unknown>;
  reasoning: string;
};

// agent.status
export type AgentStatusInput = {
  agent_id: string;
};
export type AgentStatusRun = {
  run_id: string;
  status: string;
  current_step: number;
  total_steps: number;
  started_at: string;
  updated_at: string;
  completed_at?: string;
};
export type AgentStatusOutput = {
  agent_id: string;
  active_runs: number;
  total_runs: number;
  runs: AgentStatusRun[];
};

// agent.pause
export type AgentPauseInput = { run_id: string };
export type AgentPauseOutput = { run_id: string; status: string; paused_at: string };

// agent.resume
export type AgentResumeInput = { run_id: string };
export type AgentResumeOutput = { run_id: string; status: string; resumed_at: string };

// agent.configure
export type AgentConfigureInput = {
  agent_id: string;
  updates: {
    inference_tier?: "haiku" | "sonnet" | "opus";
    max_steps_per_run?: number;
    output_channels?: string[];
  };
};
export type AgentConfigureOutput = {
  agent_id: string;
  updated_at: string;
  applied_updates: string[];
};
