import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  EMAIL_TOOL_NAMES,
  EMAIL_COMMAND_NAMES,
  safeJsonParse,
  submitEmailSearch,
  submitEmailRead,
  submitEmailDraft,
  submitEmailSend,
  submitEmailLabel,
  submitEmailListThreads,
  toCommandReply,
  toToolResult,
  type ToolResponse
} from "@jarvis/shared";

type EmailCommandArgs = {
  operation: "search" | "read" | "draft" | "send" | "label" | "list_threads";
  query?: string;
  message_id?: string;
  draft_id?: string;
  to?: string[];
  subject?: string;
  body?: string;
  cc?: string[];
  reply_to_message_id?: string;
  action?: "add" | "remove";
  labels?: string[];
  max_results?: number;
  page_token?: string;
  include_raw?: boolean;
};

type InboxCommandArgs = {
  query?: string;
  max_results?: number;
};

function createEmailTool(
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

export function createEmailTools(
  ctx: OpenClawPluginToolContext,
): AnyAgentTool[] {
  return [
    createEmailTool(
      ctx,
      "email_search",
      "Email Search",
      "Search inbox using Gmail query syntax (from:, subject:, label:, free text).",
      Type.Object({
        query: Type.String({ minLength: 1, description: "Gmail search syntax query string." }),
        max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum number of messages to return. Default 20." })),
        page_token: Type.Optional(Type.String({ minLength: 1, description: "Pagination token from a previous search." }))
      }),
      (toolCtx, params: { query: string; max_results?: number; page_token?: string }) =>
        submitEmailSearch(toolCtx, { query: params.query, maxResults: params.max_results, pageToken: params.page_token })
    ),
    createEmailTool(
      ctx,
      "email_read",
      "Email Read",
      "Read a specific email message by ID, returning full body, headers, and attachments.",
      Type.Object({
        message_id: Type.String({ minLength: 1, description: "The message ID to read." }),
        include_raw: Type.Optional(Type.Boolean({ description: "Include raw MIME source if true." }))
      }),
      (toolCtx, params: { message_id: string; include_raw?: boolean }) =>
        submitEmailRead(toolCtx, { messageId: params.message_id, includeRaw: params.include_raw })
    ),
    createEmailTool(
      ctx,
      "email_draft",
      "Email Draft",
      "Create a new draft email in Gmail without sending it.",
      Type.Object({
        to: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Recipient email addresses." }),
        subject: Type.String({ minLength: 1, description: "Email subject line." }),
        body: Type.String({ minLength: 1, description: "Plain-text email body." }),
        cc: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "CC recipients." })),
        reply_to_message_id: Type.Optional(Type.String({ minLength: 1, description: "Message ID this draft is a reply to." }))
      }),
      (toolCtx, params: { to: string[]; subject: string; body: string; cc?: string[]; reply_to_message_id?: string }) =>
        submitEmailDraft(toolCtx, {
          to: params.to,
          subject: params.subject,
          body: params.body,
          cc: params.cc,
          replyToMessageId: params.reply_to_message_id
        })
    ),
    createEmailTool(
      ctx,
      "email_send",
      "Email Send",
      "Send an existing draft or compose and send a new email. Always requires approval.",
      Type.Object({
        draft_id: Type.Optional(Type.String({ minLength: 1, description: "Draft ID to send." })),
        to: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Recipient email addresses for inline compose." })),
        subject: Type.Optional(Type.String({ minLength: 1, description: "Email subject for inline compose." })),
        body: Type.Optional(Type.String({ minLength: 1, description: "Email body for inline compose." })),
        cc: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "CC recipients." })),
        reply_to_message_id: Type.Optional(Type.String({ minLength: 1, description: "Message ID this email replies to." }))
      }),
      (toolCtx, params: { draft_id?: string; to?: string[]; subject?: string; body?: string; cc?: string[]; reply_to_message_id?: string }) =>
        submitEmailSend(toolCtx, {
          draftId: params.draft_id,
          to: params.to,
          subject: params.subject,
          body: params.body,
          cc: params.cc,
          replyToMessageId: params.reply_to_message_id
        })
    ),
    createEmailTool(
      ctx,
      "email_label",
      "Email Label",
      "Apply or remove Gmail labels from a message.",
      Type.Object({
        message_id: Type.String({ minLength: 1, description: "Message ID to apply labels to." }),
        action: Type.Union([Type.Literal("add"), Type.Literal("remove")], { description: "Whether to add or remove the labels." }),
        labels: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Label names to add or remove." })
      }),
      (toolCtx, params: { message_id: string; action: "add" | "remove"; labels: string[] }) =>
        submitEmailLabel(toolCtx, {
          messageId: params.message_id,
          action: params.action,
          labels: params.labels
        })
    ),
    createEmailTool(
      ctx,
      "email_list_threads",
      "Email List Threads",
      "List email threads, optionally filtered by a query string.",
      Type.Object({
        query: Type.Optional(Type.String({ minLength: 1, description: "Optional filter query for threads." })),
        max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum number of threads to return. Default 20." }))
      }),
      (toolCtx, params: { query?: string; max_results?: number }) =>
        submitEmailListThreads(toolCtx, { query: params.query, maxResults: params.max_results })
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

export function createEmailCommand() {
  return {
    name: "email",
    description: "Manage email: search, read, draft, send, label, list_threads. Pass JSON args with operation field.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<EmailCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("email");
      }

      const toolCtx = toToolContext(ctx);

      switch (args.operation) {
        case "search": {
          if (!args.query) {
            return toCommandReply("Missing required field: query", true);
          }
          const response = submitEmailSearch(toolCtx, {
            query: args.query,
            maxResults: args.max_results,
            pageToken: args.page_token
          });
          return toCommandReply(formatJobReply(response));
        }
        case "read": {
          if (!args.message_id) {
            return toCommandReply("Missing required field: message_id", true);
          }
          const response = submitEmailRead(toolCtx, {
            messageId: args.message_id,
            includeRaw: args.include_raw
          });
          return toCommandReply(formatJobReply(response));
        }
        case "draft": {
          if (!args.to || !args.subject || !args.body) {
            return toCommandReply("Missing required fields: to, subject, body", true);
          }
          const response = submitEmailDraft(toolCtx, {
            to: args.to,
            subject: args.subject,
            body: args.body,
            cc: args.cc,
            replyToMessageId: args.reply_to_message_id
          });
          return toCommandReply(formatJobReply(response));
        }
        case "send": {
          if (!args.draft_id && (!args.to || !args.subject || !args.body)) {
            return toCommandReply("Send requires either draft_id or (to + subject + body).", true);
          }
          const response = submitEmailSend(toolCtx, {
            draftId: args.draft_id,
            to: args.to,
            subject: args.subject,
            body: args.body,
            cc: args.cc,
            replyToMessageId: args.reply_to_message_id
          });
          return toCommandReply(formatJobReply(response));
        }
        case "label": {
          if (!args.message_id || !args.action || !args.labels) {
            return toCommandReply("Missing required fields: message_id, action, labels", true);
          }
          const response = submitEmailLabel(toolCtx, {
            messageId: args.message_id,
            action: args.action,
            labels: args.labels
          });
          return toCommandReply(formatJobReply(response));
        }
        case "list_threads": {
          const response = submitEmailListThreads(toolCtx, {
            query: args.query,
            maxResults: args.max_results
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /email operation: ${String((args as EmailCommandArgs).operation)}. Valid operations: search, read, draft, send, label, list_threads.`,
            true
          );
      }
    }
  };
}

export function createInboxCommand() {
  return {
    name: "inbox",
    description: "Quickly list inbox threads with an optional search query.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<InboxCommandArgs>(ctx) ?? {};
      const toolCtx = toToolContext(ctx);
      const response = submitEmailListThreads(toolCtx, {
        query: args.query,
        maxResults: args.max_results
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisEmailToolNames = [...EMAIL_TOOL_NAMES];
export const jarvisEmailCommandNames = [...EMAIL_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-email",
  name: "Jarvis Email",
  description: "Email management plugin for searching, reading, drafting, sending, labelling, and threading Gmail messages",
  register(api) {
    api.registerTool((ctx) => createEmailTools(ctx));
    api.registerCommand(createEmailCommand());
    api.registerCommand(createInboxCommand());
  }
});
