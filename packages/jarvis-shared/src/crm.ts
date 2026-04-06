import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type PipelineStage =
  | "prospect"
  | "qualified"
  | "contacted"
  | "meeting"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost"
  | "parked";

export type CrmAddContactParams = {
  name: string;
  company: string;
  role?: string;
  email?: string;
  linkedinUrl?: string;
  source?: string;
  tags?: string[];
  initialStage?: PipelineStage;
};

export type CrmUpdateContactParams = {
  contactId: string;
  name?: string;
  company?: string;
  role?: string;
  email?: string;
  linkedinUrl?: string;
  score?: number;
  tags?: string[];
};

export type CrmListPipelineParams = {
  stage?: PipelineStage;
  tags?: string[];
  minScore?: number;
  limit?: number;
};

export type CrmMoveStageParams = {
  contactId: string;
  toStage: PipelineStage;
  note?: string;
};

export type CrmAddNoteParams = {
  contactId: string;
  note: string;
  noteType?: "call" | "email" | "meeting" | "proposal" | "general";
};

export type CrmSearchParams = {
  query: string;
  limit?: number;
};

export type CrmDigestParams = {
  stage?: PipelineStage;
  daysBack?: number;
  includeScores?: boolean;
};

export function submitCrmAddContact(
  ctx: OpenClawPluginToolContext | undefined,
  params: CrmAddContactParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "crm.add_contact",
    input: {
      name: params.name,
      company: params.company,
      role: params.role,
      email: params.email,
      linkedin_url: params.linkedinUrl,
      source: params.source,
      tags: params.tags,
      initial_stage: params.initialStage,
    }
  });
}

export function submitCrmUpdateContact(
  ctx: OpenClawPluginToolContext | undefined,
  params: CrmUpdateContactParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "crm.update_contact",
    input: {
      contact_id: params.contactId,
      name: params.name,
      company: params.company,
      role: params.role,
      email: params.email,
      linkedin_url: params.linkedinUrl,
      score: params.score,
      tags: params.tags,
    }
  });
}

export function submitCrmListPipeline(
  ctx: OpenClawPluginToolContext | undefined,
  params: CrmListPipelineParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "crm.list_pipeline",
    input: {
      stage: params.stage,
      tags: params.tags,
      min_score: params.minScore,
      limit: params.limit,
    }
  });
}

export function submitCrmMoveStage(
  ctx: OpenClawPluginToolContext | undefined,
  params: CrmMoveStageParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "crm.move_stage",
    input: {
      contact_id: params.contactId,
      to_stage: params.toStage,
      note: params.note,
    }
  });
}

export function submitCrmAddNote(
  ctx: OpenClawPluginToolContext | undefined,
  params: CrmAddNoteParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "crm.add_note",
    input: {
      contact_id: params.contactId,
      note: params.note,
      note_type: params.noteType,
    }
  });
}

export function submitCrmSearch(
  ctx: OpenClawPluginToolContext | undefined,
  params: CrmSearchParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "crm.search",
    input: {
      query: params.query,
      limit: params.limit,
    }
  });
}

export function submitCrmDigest(
  ctx: OpenClawPluginToolContext | undefined,
  params: CrmDigestParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "crm.digest",
    input: {
      stage: params.stage,
      days_back: params.daysBack,
      include_scores: params.includeScores,
    }
  });
}
