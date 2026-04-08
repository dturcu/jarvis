export type StarterPack = {
  pack_id: string;
  name: string;
  description: string;
  enabled_agents: string[];
  disabled_agents: string[];
  adapter_mode: "mock" | "real";
  approval_policy: "strict" | "standard" | "relaxed";
};

const NEW_ROSTER = [
  "orchestrator",
  "self-reflection",
  "regulatory-watch",
  "knowledge-curator",
  "proposal-engine",
  "evidence-auditor",
  "contract-reviewer",
  "staffing-monitor",
];

export const STARTER_PACKS: StarterPack[] = [
  {
    pack_id: "automotive-consulting",
    name: "Automotive Consulting",
    description: "Full production suite for ISO 26262, ASPICE, and automotive safety consulting.",
    enabled_agents: NEW_ROSTER,
    disabled_agents: [],
    adapter_mode: "real",
    approval_policy: "strict",
  },
  {
    pack_id: "development",
    name: "Development Mode",
    description: "All agents enabled with mock adapters for testing.",
    enabled_agents: NEW_ROSTER,
    disabled_agents: [],
    adapter_mode: "mock",
    approval_policy: "relaxed",
  },
];
