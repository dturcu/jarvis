export type AgentTrigger =
  | { kind: "schedule"; cron: string }
  | { kind: "event"; event_type: string }
  | { kind: "manual" }
  | { kind: "threshold"; alert_id: string };

export type ApprovalGate = {
  action: string;
  severity: "info" | "warning" | "critical";
  auto_approve_after_seconds?: number;
};

export type AgentDefinition = {
  agent_id: string;
  label: string;
  version: string;
  description: string;
  triggers: AgentTrigger[];
  capabilities: string[];
  approval_gates: ApprovalGate[];
  knowledge_collections: string[];
  inference_tier: "haiku" | "sonnet" | "opus";
  max_steps_per_run: number;
  system_prompt: string;
  output_channels: string[];
};
