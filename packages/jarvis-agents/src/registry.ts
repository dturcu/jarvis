import type { AgentDefinition } from "@jarvis/agent-framework";
import { bdPipelineAgent } from "./definitions/bd-pipeline.js";
import { proposalEngineAgent } from "./definitions/proposal-engine.js";
import { evidenceAuditorAgent } from "./definitions/evidence-auditor.js";
import { contractReviewerAgent } from "./definitions/contract-reviewer.js";
import { staffingMonitorAgent } from "./definitions/staffing-monitor.js";
import { contentEngineAgent } from "./definitions/content-engine.js";
import { portfolioMonitorAgent } from "./definitions/portfolio-monitor.js";
import { gardenCalendarAgent } from "./definitions/garden-calendar.js";
import { socialEngagementAgent } from "./definitions/social-engagement.js";
import { securityMonitorAgent } from "./definitions/security-monitor.js";
import { invoiceGeneratorAgent } from "./definitions/invoice-generator.js";
import { emailCampaignAgent } from "./definitions/email-campaign.js";
import { meetingTranscriberAgent } from "./definitions/meeting-transcriber.js";
import { driveWatcherAgent } from "./definitions/drive-watcher.js";

export const ALL_AGENTS: AgentDefinition[] = [
  bdPipelineAgent,
  proposalEngineAgent,
  evidenceAuditorAgent,
  contractReviewerAgent,
  staffingMonitorAgent,
  contentEngineAgent,
  portfolioMonitorAgent,
  gardenCalendarAgent,
  socialEngagementAgent,
  securityMonitorAgent,
  invoiceGeneratorAgent,
  emailCampaignAgent,
  meetingTranscriberAgent,
  driveWatcherAgent,
];

export function getAgent(agentId: string): AgentDefinition | undefined {
  return ALL_AGENTS.find(a => a.agent_id === agentId);
}

export function listAgents(): AgentDefinition[] {
  return ALL_AGENTS;
}
