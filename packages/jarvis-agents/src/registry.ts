import type { AgentDefinition } from "@jarvis/agent-framework";
import { orchestratorAgent } from "./definitions/orchestrator.js";
import { selfReflectionAgent } from "./definitions/self-reflection.js";
import { regulatoryWatchAgent } from "./definitions/regulatory-watch.js";
import { knowledgeCuratorAgent } from "./definitions/knowledge-curator.js";
import { proposalEngineAgent } from "./definitions/proposal-engine.js";
import { evidenceAuditorAgent } from "./definitions/evidence-auditor.js";
import { contractReviewerAgent } from "./definitions/contract-reviewer.js";
import { staffingMonitorAgent } from "./definitions/staffing-monitor.js";

/**
 * Active production agent roster — rebuilt 2026-04-08.
 *
 * 8 agents, each owning a real business loop:
 * - orchestrator: top-level workflow coordination
 * - self-reflection: system health and improvement proposals
 * - regulatory-watch: standards and regulatory intelligence
 * - knowledge-curator: knowledge store maintenance
 * - proposal-engine: RFQ analysis, quoting, invoicing
 * - evidence-auditor: ISO 26262 / ASPICE compliance
 * - contract-reviewer: NDA/MSA clause analysis
 * - staffing-monitor: team utilization and gap forecasting
 *
 * The previous 15-agent roster is preserved in legacy/.
 */
export const ALL_AGENTS: AgentDefinition[] = [
  orchestratorAgent,
  selfReflectionAgent,
  regulatoryWatchAgent,
  knowledgeCuratorAgent,
  proposalEngineAgent,
  evidenceAuditorAgent,
  contractReviewerAgent,
  staffingMonitorAgent,
];

export function getAgent(agentId: string): AgentDefinition | undefined {
  return ALL_AGENTS.find(a => a.agent_id === agentId);
}

export function listAgents(): AgentDefinition[] {
  return ALL_AGENTS;
}
