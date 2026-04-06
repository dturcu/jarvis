export type StarterPack = {
  pack_id: string;
  name: string;
  description: string;
  enabled_agents: string[];
  disabled_agents: string[];
  adapter_mode: "mock" | "real";
  approval_policy: "strict" | "standard" | "relaxed";
};

export const STARTER_PACKS: StarterPack[] = [
  {
    pack_id: "automotive-consulting",
    name: "Automotive Consulting",
    description: "Full suite for ISO 26262, ASPICE, and automotive safety consulting. Enables BD pipeline, proposals, evidence auditing, contract review, and staffing.",
    enabled_agents: ["bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer", "staffing-monitor"],
    disabled_agents: ["content-engine", "portfolio-monitor", "garden-calendar", "social-engagement", "security-monitor", "invoice-generator", "email-campaign", "meeting-transcriber", "drive-watcher"],
    adapter_mode: "real",
    approval_policy: "strict",
  },
  {
    pack_id: "solo-consultant",
    name: "Solo Consultant",
    description: "Lean setup for individual consultants. BD pipeline, contract review, and staffing only.",
    enabled_agents: ["bd-pipeline", "contract-reviewer", "staffing-monitor"],
    disabled_agents: ["proposal-engine", "evidence-auditor", "content-engine", "portfolio-monitor", "garden-calendar", "social-engagement", "security-monitor", "invoice-generator", "email-campaign", "meeting-transcriber", "drive-watcher"],
    adapter_mode: "real",
    approval_policy: "standard",
  },
  {
    pack_id: "development",
    name: "Development Mode",
    description: "All agents enabled with mock adapters. For testing and development only.",
    enabled_agents: ["bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer", "staffing-monitor", "content-engine", "portfolio-monitor", "garden-calendar", "social-engagement", "security-monitor", "invoice-generator", "email-campaign", "meeting-transcriber", "drive-watcher"],
    disabled_agents: [],
    adapter_mode: "mock",
    approval_policy: "relaxed",
  },
];
