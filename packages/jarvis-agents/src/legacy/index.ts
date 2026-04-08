/**
 * Legacy agent roster — archived 2026-04-08.
 *
 * These 15 agents were the original Jarvis production roster.
 * They are preserved here for reference, testing, and potential
 * selective restoration.  They are NOT registered in the active
 * runtime (ALL_AGENTS is empty).
 */
import type { AgentDefinition } from "@jarvis/agent-framework";

export { bdPipelineAgent, BD_PIPELINE_SYSTEM_PROMPT } from "./definitions/bd-pipeline.js";
export { proposalEngineAgent, PROPOSAL_ENGINE_SYSTEM_PROMPT } from "./definitions/proposal-engine.js";
export { evidenceAuditorAgent, EVIDENCE_AUDITOR_SYSTEM_PROMPT } from "./definitions/evidence-auditor.js";
export { contractReviewerAgent, CONTRACT_REVIEWER_SYSTEM_PROMPT } from "./definitions/contract-reviewer.js";
export { staffingMonitorAgent, STAFFING_MONITOR_SYSTEM_PROMPT } from "./definitions/staffing-monitor.js";
export { contentEngineAgent, CONTENT_ENGINE_SYSTEM_PROMPT } from "./definitions/content-engine.js";
export { portfolioMonitorAgent, PORTFOLIO_MONITOR_SYSTEM_PROMPT } from "./definitions/portfolio-monitor.js";
export { gardenCalendarAgent, GARDEN_CALENDAR_SYSTEM_PROMPT } from "./definitions/garden-calendar.js";
export { socialEngagementAgent, SOCIAL_ENGAGEMENT_SYSTEM_PROMPT } from "./definitions/social-engagement.js";
export { securityMonitorAgent, SECURITY_MONITOR_SYSTEM_PROMPT } from "./definitions/security-monitor.js";
export { invoiceGeneratorAgent, INVOICE_GENERATOR_SYSTEM_PROMPT } from "./definitions/invoice-generator.js";
export { emailCampaignAgent, EMAIL_CAMPAIGN_SYSTEM_PROMPT } from "./definitions/email-campaign.js";
export { meetingTranscriberAgent, MEETING_TRANSCRIBER_SYSTEM_PROMPT } from "./definitions/meeting-transcriber.js";
export { driveWatcherAgent, DRIVE_WATCHER_SYSTEM_PROMPT } from "./definitions/drive-watcher.js";
export { selfReflectionAgent, SELF_REFLECTION_SYSTEM_PROMPT } from "./definitions/self-reflection.js";

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
import { selfReflectionAgent } from "./definitions/self-reflection.js";

export const LEGACY_AGENTS: AgentDefinition[] = [
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
  selfReflectionAgent,
];
