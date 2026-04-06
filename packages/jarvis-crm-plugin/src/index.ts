import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  CRM_TOOL_NAMES,
  CRM_COMMAND_NAMES,
  getJarvisState,
  safeJsonParse,
  submitCrmAddContact,
  submitCrmUpdateContact,
  submitCrmListPipeline,
  submitCrmMoveStage,
  submitCrmAddNote,
  submitCrmSearch,
  submitCrmDigest,
  toCommandReply,
  toToolResult,
  type ToolResponse
} from "@jarvis/shared";
import type {
  PipelineStage
} from "@jarvis/crm-worker";

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const pipelineStageSchema = asLiteralUnion([
  "prospect",
  "qualified",
  "contacted",
  "meeting",
  "proposal",
  "negotiation",
  "won",
  "lost",
  "parked"
] as const);

const noteTypeSchema = asLiteralUnion([
  "call",
  "email",
  "meeting",
  "observation",
  "proposal",
  "general"
] as const);

const searchFieldSchema = asLiteralUnion([
  "name",
  "company",
  "notes",
  "tags"
] as const);

function createCrmTool(
  ctx: OpenClawPluginToolContext,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  submit: (ctx: OpenClawPluginToolContext | undefined, params: any) => ToolResponse,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(submit(ctx, params))
  };
}

export function createCrmTools(
  ctx: OpenClawPluginToolContext,
): AnyAgentTool[] {
  return [
    createCrmTool(
      ctx,
      "crm_add_contact",
      "CRM Add Contact",
      "Add a new contact to the CRM pipeline.",
      Type.Object({
        name: Type.String({ minLength: 1, description: "Full name of the contact." }),
        company: Type.String({ minLength: 1, description: "Company name." }),
        role: Type.Optional(Type.String({ description: "Job role or title." })),
        email: Type.Optional(Type.String({ description: "Email address." })),
        linkedin_url: Type.Optional(Type.String({ description: "LinkedIn profile URL." })),
        source: Type.Optional(Type.String({ description: "Contact source: linkedin_scrape, web_intel, referral, or direct." })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for categorization." })),
        notes: Type.Optional(Type.String({ description: "Initial notes about the contact." })),
        stage: Type.Optional(pipelineStageSchema)
      }),
      (toolCtx, params) => submitCrmAddContact(toolCtx, params)
    ),
    createCrmTool(
      ctx,
      "crm_update_contact",
      "CRM Update Contact",
      "Update fields on an existing CRM contact.",
      Type.Object({
        contact_id: Type.String({ minLength: 1, description: "ID of the contact to update." }),
        name: Type.Optional(Type.String()),
        company: Type.Optional(Type.String()),
        role: Type.Optional(Type.String()),
        email: Type.Optional(Type.String()),
        tags: Type.Optional(Type.Array(Type.String())),
        score: Type.Optional(Type.Integer({ minimum: 0, maximum: 100, description: "Engagement score." })),
        last_contact_at: Type.Optional(Type.String({ description: "ISO 8601 datetime of last contact." }))
      }),
      (toolCtx, params) => submitCrmUpdateContact(toolCtx, params)
    ),
    createCrmTool(
      ctx,
      "crm_list_pipeline",
      "CRM List Pipeline",
      "List contacts in the CRM pipeline, optionally filtered by stage, tags, or minimum score.",
      Type.Object({
        stage: Type.Optional(pipelineStageSchema),
        tags: Type.Optional(Type.Array(Type.String())),
        min_score: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
        limit: Type.Optional(Type.Integer({ minimum: 1 }))
      }),
      (toolCtx, params) => submitCrmListPipeline(toolCtx, params)
    ),
    createCrmTool(
      ctx,
      "crm_move_stage",
      "CRM Move Stage",
      "Move a contact to a different pipeline stage.",
      Type.Object({
        contact_id: Type.String({ minLength: 1 }),
        new_stage: pipelineStageSchema,
        reason: Type.Optional(Type.String({ description: "Reason for the stage move." }))
      }),
      (toolCtx, params) => submitCrmMoveStage(toolCtx, params)
    ),
    createCrmTool(
      ctx,
      "crm_add_note",
      "CRM Add Note",
      "Add an interaction note to a CRM contact.",
      Type.Object({
        contact_id: Type.String({ minLength: 1 }),
        content: Type.String({ minLength: 1, description: "Note content." }),
        note_type: Type.Optional(noteTypeSchema)
      }),
      (toolCtx, params) => submitCrmAddNote(toolCtx, params)
    ),
    createCrmTool(
      ctx,
      "crm_search",
      "CRM Search",
      "Full-text search across the CRM for contacts matching a query.",
      Type.Object({
        query: Type.String({ minLength: 1, description: "Search query string." }),
        fields: Type.Optional(Type.Array(searchFieldSchema, { description: "Fields to search in." })),
        stage: Type.Optional(pipelineStageSchema)
      }),
      (toolCtx, params) => submitCrmSearch(toolCtx, params)
    ),
    createCrmTool(
      ctx,
      "crm_digest",
      "CRM Digest",
      "Generate a summary digest of the CRM pipeline including hot leads and stale contacts.",
      Type.Object({
        include_parked: Type.Optional(Type.Boolean({ description: "Include parked contacts in the digest." })),
        days_since_contact: Type.Optional(Type.Integer({
          minimum: 1,
          description: "Flag contacts not touched in this many days as stale."
        }))
      }),
      (toolCtx, params) => submitCrmDigest(toolCtx, params)
    )
  ];
}

function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) {
    parts.push(`job=${response.job_id}`);
  }
  if (response.approval_id) {
    parts.push(`approval=${response.approval_id}`);
  }
  return parts.join(" | ");
}

function parseJsonArgs<T>(ctx: PluginCommandContext): T | null {
  return safeJsonParse<T>(ctx.args);
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

type CrmCommandArgs = {
  operation: "add" | "update" | "list" | "move" | "note" | "search" | "digest";
  [key: string]: unknown;
};

export function createCrmCommand() {
  return {
    name: "crm",
    description: "Manage CRM pipeline contacts (add, update, list, move, note, search, digest) with JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<CrmCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("crm");
      }

      const toolCtx = toToolContext(ctx);

      switch (args.operation) {
        case "add": {
          const response = submitCrmAddContact(toolCtx, args as any);
          return toCommandReply(formatJobReply(response));
        }
        case "update": {
          const response = submitCrmUpdateContact(toolCtx, args as any);
          return toCommandReply(formatJobReply(response));
        }
        case "list": {
          const response = submitCrmListPipeline(toolCtx, args as any);
          return toCommandReply(formatJobReply(response));
        }
        case "move": {
          const response = submitCrmMoveStage(toolCtx, args as any);
          return toCommandReply(formatJobReply(response));
        }
        case "note": {
          const response = submitCrmAddNote(toolCtx, args as any);
          return toCommandReply(formatJobReply(response));
        }
        case "search": {
          const response = submitCrmSearch(toolCtx, args as any);
          return toCommandReply(formatJobReply(response));
        }
        case "digest": {
          const response = submitCrmDigest(toolCtx, args as any);
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /crm operation: ${String((args as CrmCommandArgs).operation)}. Valid: add, update, list, move, note, search, digest.`,
            true
          );
      }
    }
  };
}

export function createPipelineCommand() {
  return {
    name: "pipeline",
    description: "View the CRM pipeline. Optionally pass JSON with { stage, min_score, tags, limit }.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<Record<string, unknown>>(ctx) ?? {};
      const toolCtx = toToolContext(ctx);
      const response = submitCrmListPipeline(toolCtx, args as any);
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisCrmToolNames = [...CRM_TOOL_NAMES];
export const jarvisCrmCommandNames = [...CRM_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-crm",
  name: "Jarvis CRM",
  description: "CRM pipeline management plugin for managing contacts, pipeline stages, notes, and deal tracking",
  register(api) {
    api.registerTool((ctx) => createCrmTools(ctx));
    api.registerCommand(createCrmCommand());
    api.registerCommand(createPipelineCommand());
  }
});
