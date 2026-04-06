import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type EmailSearchParams = {
  query: string;
  maxResults?: number;
  pageToken?: string;
};

export type EmailReadParams = {
  messageId: string;
  includeRaw?: boolean;
};

export type EmailDraftParams = {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  replyToMessageId?: string;
};

export type EmailSendParams = {
  draftId?: string;
  to?: string[];
  subject?: string;
  body?: string;
  cc?: string[];
  replyToMessageId?: string;
};

export type EmailLabelParams = {
  messageId: string;
  action: "add" | "remove";
  labels: string[];
};

export type EmailListThreadsParams = {
  query?: string;
  maxResults?: number;
};

export function submitEmailSearch(
  ctx: OpenClawPluginToolContext | undefined,
  params: EmailSearchParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "email.search",
    input: {
      query: params.query,
      max_results: params.maxResults,
      page_token: params.pageToken,
    }
  });
}

export function submitEmailRead(
  ctx: OpenClawPluginToolContext | undefined,
  params: EmailReadParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "email.read",
    input: {
      message_id: params.messageId,
      include_raw: params.includeRaw,
    }
  });
}

export function submitEmailDraft(
  ctx: OpenClawPluginToolContext | undefined,
  params: EmailDraftParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "email.draft",
    input: {
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      reply_to_message_id: params.replyToMessageId,
    }
  });
}

export function submitEmailSend(
  ctx: OpenClawPluginToolContext | undefined,
  params: EmailSendParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "email.send",
    input: {
      draft_id: params.draftId,
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      reply_to_message_id: params.replyToMessageId,
    }
  });
}

export function submitEmailLabel(
  ctx: OpenClawPluginToolContext | undefined,
  params: EmailLabelParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "email.label",
    input: {
      message_id: params.messageId,
      action: params.action,
      labels: params.labels,
    }
  });
}

export function submitEmailListThreads(
  ctx: OpenClawPluginToolContext | undefined,
  params: EmailListThreadsParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "email.list_threads",
    input: {
      query: params.query,
      max_results: params.maxResults,
    }
  });
}
